import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Browser, BrowserContext, Locator, Page } from 'playwright';
import { chromium } from 'playwright';
import {
  Action, ActionResult, Config, ParsedStep,
  SessionResult, SessionTokenUsage, StepResult, StepSummary, TokenUsage
} from './types';
import { AIClient, estimateCost } from './ai';
import { extractPageContext } from './context';
import { findElement } from './finder';
import { createRecordingContext, createContext, finalizeRecording, formatFileSize } from './recorder';
import { logger } from './logger';

const MAX_RETRIES = 1;       // One retry max — keeps failing steps under ~8 s
const ROLLING_HISTORY_SIZE = 3;

// ─── Mouse position tracking ─────────────────────────────────────────────────
// We drive all cursor movement from Node.js via page.mouse.move() in a timed
// loop. Tracking the position here lets us always animate FROM the last known
// coordinate rather than from Playwright's default (0,0).
let mouseX = 0;
let mouseY = 0;

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Smoothly moves Playwright's mouse (and the cursor overlay) from the current
 * tracked position to (tx, ty) using a timed step loop at ~60 fps.
 * Steps are scaled by distance so short hops are quick and long sweeps are
 * proportionally longer — matching natural human mouse speed (~15 px/step).
 */
async function moveMouse(page: Page, tx: number, ty: number): Promise<void> {
  const sx = mouseX;
  const sy = mouseY;
  const dist = Math.hypot(tx - sx, ty - sy);
  if (dist < 2) return;
  const steps = Math.max(5, Math.min(12, Math.round(dist / 25)));
  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    await page.mouse.move(
      Math.round(sx + (tx - sx) * t),
      Math.round(sy + (ty - sy) * t),
    );
    await new Promise(r => setTimeout(r, 10)); // fast but still eased
  }
  mouseX = tx;
  mouseY = ty;
}
// ─────────────────────────────────────────────────────────────────────────────

export async function runSession(steps: ParsedStep[], config: Config): Promise<SessionResult> {
  const aiClient = new AIClient();
  let browser: Browser | null = null;
  let browserContext: BrowserContext | null = null;

  const outputDir = path.resolve(config.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const tempDir = path.join(os.tmpdir(), `browser-agent-${Date.now()}`);

  const startTime = Date.now();
  const stepResults: StepResult[] = [];
  const stepHistory: StepSummary[] = [];
  let screenshotCount = 0;

  logger.info(`Starting session with ${steps.length} steps`);
  if (config.record) {
    logger.info(`Recording: ON (${config.resolution.width}x${config.resolution.height})`);
  } else {
    logger.info('Recording: OFF');
  }

  // Handle SIGINT/SIGTERM for graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn(`\nReceived ${signal} — saving recording and exiting...`);
    await gracefulClose(browserContext, browser);
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    browser = await chromium.launch({
      headless: !config.headed,
      slowMo: config.slowMo,
    });

    if (config.record) {
      const recCtx = await createRecordingContext(browser, {
        width: config.resolution.width,
        height: config.resolution.height,
        tempDir,
        userAgent: config.userAgent,
        locale: config.locale,
      });
      browserContext = recCtx.context;
    } else {
      browserContext = await createContext(browser, {
        width: config.resolution.width,
        height: config.resolution.height,
        userAgent: config.userAgent,
        locale: config.locale,
      });
    }

    const page = await browserContext.newPage();

    // Place the cursor overlay at the viewport centre immediately so it appears
    // at a sensible starting position on the first frame of the recording.
    mouseX = Math.round(config.resolution.width / 2);
    mouseY = Math.round(config.resolution.height / 2);
    await page.mouse.move(mouseX, mouseY);

    // Mutable page reference — updated when new tabs would open
    const pageRef = { current: page };

    // ─── Single-tab strategy for continuous recording ────────────────────────
    // When a link opens a new tab (target="_blank" / window.open), we close
    // the new tab and navigate the current tab to the same URL. This keeps
    // recording in a single continuous .webm file.
    browserContext.on('page', async (newPage: Page) => {
      try {
        // Wait for the new tab to navigate away from about:blank
        if (newPage.url() === 'about:blank') {
          await newPage.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
        }
        const url = newPage.url();
        const isReal = url
          && url !== 'about:blank'
          && !url.startsWith('chrome://')
          && !url.startsWith('devtools://');

        if (isReal) {
          logger.info(`New tab (${url}) — redirecting to current tab for continuous recording`);
          await newPage.close().catch(() => {});
          // Navigate in its own try/catch so a goto failure never assigns
          // the already-closed newPage to pageRef.current.
          try {
            await pageRef.current.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          } catch (gotoErr) {
            logger.warn(`Could not redirect new tab to current tab: ${gotoErr instanceof Error ? gotoErr.message : String(gotoErr)}`);
            // pageRef.current keeps pointing to the original (still-open) page.
          }
        } else {
          // Can't determine URL — fall back to using the new tab (it's still open).
          logger.info('New tab detected — switching focus');
          pageRef.current = newPage;
        }
      } catch (err) {
        logger.warn(`New tab handling: ${err instanceof Error ? err.message : String(err)}`);
        // Only switch to newPage if it is still alive. If we already called
        // newPage.close() above and the error came from goto(), newPage is closed
        // and assigning it would break all subsequent page operations.
        try { await newPage.title(); pageRef.current = newPage; } catch { /* keep current page */ }
      }
    });
    // ────────────────────────────────────────────────────────────────────────

    const stepsToRun = steps.filter(s => s.stepNumber >= config.startStep);
    const totalSteps = steps.length;

    for (const step of stepsToRun) {
      if (shuttingDown) break;

      // Recover if page was somehow closed
      if (!await isPageAlive(pageRef.current)) {
        const pages = browserContext.pages();
        if (pages.length > 0) {
          pageRef.current = pages[pages.length - 1];
          logger.warn('Page was closed — recovered to another open tab');
        }
      }

      logger.step(step.stepNumber, totalSteps, step.instruction);

      const stepResult = await executeStep(
        step,
        pageRef.current,
        aiClient,
        stepHistory,
        config,
        outputDir,
        screenshotCount
      );

      screenshotCount += stepResult.actions.filter(a => a.screenshotPath).length;
      stepResults.push(stepResult);

      const actionsSummary = stepResult.actions.map(a => describeAction(a.action)).join(', ');
      stepHistory.push({
        stepNumber: step.stepNumber,
        instruction: step.instruction,
        actionsSummary,
        success: stepResult.success,
      });
      if (stepHistory.length > ROLLING_HISTORY_SIZE) stepHistory.shift();

      if (config.stepPause > 0 && step !== stepsToRun[stepsToRun.length - 1]) {
        await new Promise(r => setTimeout(r, config.stepPause));
      }

      if (!stepResult.success && config.stopOnError) {
        logger.error(`Stopping on error at step ${step.stepNumber} (--stop-on-error)`);
        break;
      }
    }
  } catch (err) {
    logger.error(`Session crashed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await gracefulClose(browserContext, browser);
  }

  // Finalize recording
  let videoPath: string | null = null;
  let videoSizeBytes: number | null = null;
  if (config.record) {
    const recording = await finalizeRecording(tempDir, outputDir);
    if (recording) {
      videoPath = recording.videoPath;
      videoSizeBytes = recording.sizeBytes;
    }
  }

  const totalUsage = aiClient.getTotalUsage();
  const perStep = stepResults.map(r => r.tokenUsage);
  const tokenUsage: SessionTokenUsage = { perStep, total: totalUsage };
  const succeededSteps = stepResults.filter(r => r.success).length;
  const failedSteps = stepResults.filter(r => !r.success).length;
  const sessionDuration = Date.now() - startTime;

  printSummary({ stepResults, videoPath, videoSizeBytes, screenshotCount, totalUsage, succeededSteps, failedSteps, durationMs: sessionDuration });

  return { steps: stepResults, videoPath, videoSizeBytes, screenshotCount, tokenUsage, durationMs: sessionDuration, succeededSteps, failedSteps };
}

// ─── Smooth cursor movement ──────────────────────────────────────────────────
// Before each click/hover, animate the cursor overlay from its current tracked
// position to the target element's centre using moveMouse() (timed Node.js
// loop — no rAF inside the browser context).
async function smoothMoveTo(page: Page, locator: Locator): Promise<void> {
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    const box = await locator.boundingBox();
    if (!box) return;
    await moveMouse(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  } catch {
    // Non-fatal — skip smooth movement if page is navigating or element is gone
  }
}
// ─────────────────────────────────────────────────────────────────────────────

async function executeStep(
  step: ParsedStep,
  page: Page,
  aiClient: AIClient,
  stepHistory: StepSummary[],
  config: Config,
  outputDir: string,
  screenshotOffset: number
): Promise<StepResult> {
  const stepStart = Date.now();
  let retries = 0;
  let lastError = '';
  let stepTokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let actionResults: ActionResult[] = [];

  while (retries <= MAX_RETRIES) {
    try {
      const pageContext = await extractPageContext(page);
      const aiResult = await aiClient.interpretInstruction(
        step.instruction,
        pageContext,
        stepHistory,
        config.verbose,
        retries > 0 ? { previousError: lastError, attempt: retries } : undefined
      );

      stepTokenUsage = {
        promptTokens: stepTokenUsage.promptTokens + aiResult.usage.promptTokens,
        completionTokens: stepTokenUsage.completionTokens + aiResult.usage.completionTokens,
        totalTokens: stepTokenUsage.totalTokens + aiResult.usage.totalTokens,
      };

      const results = await executeActions(
        aiResult.actions,
        page,
        config,
        outputDir,
        screenshotOffset + actionResults.filter(a => a.screenshotPath).length
      );

      actionResults = [...actionResults, ...results];

      if (results.every(r => r.success)) {
        return {
          stepNumber: step.stepNumber,
          instruction: step.instruction,
          actions: actionResults,
          success: true,
          retries,
          tokenUsage: stepTokenUsage,
          durationMs: Date.now() - stepStart,
        };
      }

      const failed = results.find(r => !r.success);
      lastError = failed?.error ?? 'Unknown error';

      if (retries < MAX_RETRIES) {
        const screenshotPath = path.join(outputDir, `retry-step${step.stepNumber}-attempt${retries + 1}.png`);
        try {
          await page.screenshot({ path: screenshotPath, fullPage: false });
          logger.retry(retries + 1, `Error: ${lastError}. Screenshot saved.`);
        } catch {
          logger.retry(retries + 1, `Error: ${lastError}`);
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (retries < MAX_RETRIES) {
        const screenshotPath = path.join(outputDir, `error-step${step.stepNumber}-attempt${retries + 1}.png`);
        try {
          await page.screenshot({ path: screenshotPath, fullPage: false });
          logger.retry(retries + 1, `Error: ${lastError}. Screenshot saved.`);
        } catch {
          logger.retry(retries + 1, `Error: ${lastError}`);
        }
      }
    }

    retries++;
  }

  logger.error(`Step ${step.stepNumber} failed after ${MAX_RETRIES} retries: ${lastError}`);

  return {
    stepNumber: step.stepNumber,
    instruction: step.instruction,
    actions: actionResults,
    success: false,
    retries,
    tokenUsage: stepTokenUsage,
    durationMs: Date.now() - stepStart,
  };
}

async function executeActions(
  actions: Action[],
  page: Page,
  config: Config,
  outputDir: string,
  screenshotOffset: number
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  for (const action of actions) {
    const start = Date.now();
    try {
      await executeAction(action, page, config, outputDir, screenshotOffset + results.length);
      const durationMs = Date.now() - start;
      results.push({ action, success: true, durationMs });
      logger.action(describeAction(action), true, durationMs);
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);
      results.push({ action, success: false, durationMs, error });
      logger.action(describeAction(action), false, durationMs);
      logger.error(`  ${error}`);
      break; // Stop remaining actions in this step; trigger retry
    }
  }

  return results;
}

async function executeAction(
  action: Action,
  page: Page,
  config: Config,
  outputDir: string,
  screenshotIndex: number
): Promise<void> {
  switch (action.action) {
    case 'goto': {
      logger.actionIntermediate(`goto ${action.url}`);
      await page.goto(action.url, { timeout: config.timeout, waitUntil: 'domcontentloaded' });
      break;
    }

    case 'click': {
      const desc = action.description || action.selector;
      logger.actionIntermediate(`click "${desc}" [${action.selector}]`);
      const { locator } = await findElement(page, action.selector, action.description || '', config.timeout);
      await smoothMoveTo(page, locator);
      await locator.click({ timeout: config.timeout });
      // Wait for any navigation the click may have triggered (same-tab or via
      // the new-tab redirect handler). Resolves immediately when page is stable.
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      break;
    }

    case 'fill': {
      const desc = action.description || action.selector;
      logger.actionIntermediate(`fill "${desc}" with "${action.value}"`);
      const { locator } = await findElement(page, action.selector, action.description || '', config.timeout);
      await smoothMoveTo(page, locator);
      await locator.fill(action.value, { timeout: config.timeout });
      break;
    }

    case 'type': {
      const desc = action.description || action.selector;
      logger.actionIntermediate(`type "${action.value}" into "${desc}"`);
      const { locator } = await findElement(page, action.selector, action.description || '', config.timeout);
      await smoothMoveTo(page, locator);
      await locator.pressSequentially(action.value, { delay: 50 });
      break;
    }

    case 'press': {
      logger.actionIntermediate(`press ${action.key}`);
      await page.keyboard.press(action.key);
      break;
    }

    case 'scroll': {
      const deltaY = action.direction === 'down' ? action.pixels : -action.pixels;
      logger.actionIntermediate(`scroll ${action.direction} ${action.pixels}px`);
      // Smoothly move cursor to centre of viewport before scrolling
      const vp = page.viewportSize() ?? { width: 1280, height: 720 };
      await moveMouse(page, Math.round(vp.width / 2), Math.round(vp.height / 2));
      await page.mouse.wheel(0, deltaY);
      await new Promise(r => setTimeout(r, 100));
      break;
    }

    case 'wait': {
      logger.actionIntermediate(`wait ${action.seconds}s`);
      await new Promise(r => setTimeout(r, action.seconds * 1000));
      break;
    }

    case 'waitForSelector': {
      logger.actionIntermediate(`waitForSelector ${action.selector} (${action.state})`);
      await page.waitForSelector(action.selector, { state: action.state, timeout: config.timeout });
      break;
    }

    case 'hover': {
      const desc = action.description || action.selector;
      logger.actionIntermediate(`hover "${desc}"`);
      // For hover, skip the AI's CSS selector and rely purely on description-based
      // matching. AI-generated nth-of-type selectors are brittle and often point to
      // the wrong nav/menu item. Text/role matching on the description is far more
      // reliable for finding the actual target element.
      const hoverSelector = action.description ? '__skip_css__' : action.selector;
      const { locator } = await findElement(page, hoverSelector, action.description || '', config.timeout);
      await smoothMoveTo(page, locator);
      await locator.hover({ timeout: config.timeout });
      // Wait for dropdown/flyout menus to open before the next step reads the page
      await new Promise(r => setTimeout(r, 600));
      break;
    }

    case 'select': {
      const desc = action.description || action.selector;
      logger.actionIntermediate(`select "${action.value}" in "${desc}"`);
      const { locator } = await findElement(page, action.selector, action.description || '', config.timeout);
      await smoothMoveTo(page, locator);
      await locator.selectOption(action.value, { timeout: config.timeout });
      break;
    }

    case 'screenshot': {
      const filename = `screenshot-${screenshotIndex + 1}-${action.name.replace(/\s+/g, '-')}.png`;
      const screenshotPath = path.join(outputDir, filename);
      logger.actionIntermediate(`screenshot → ${filename}`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      break;
    }

    case 'goBack': {
      logger.actionIntermediate('goBack');
      await page.goBack({ timeout: config.timeout, waitUntil: 'domcontentloaded' });
      break;
    }

    case 'goForward': {
      logger.actionIntermediate('goForward');
      await page.goForward({ timeout: config.timeout, waitUntil: 'domcontentloaded' });
      break;
    }

    case 'reload': {
      logger.actionIntermediate('reload');
      await page.reload({ timeout: config.timeout, waitUntil: 'domcontentloaded' });
      break;
    }

    case 'waitForNavigation': {
      logger.actionIntermediate('waitForNavigation');
      await page.waitForLoadState('domcontentloaded', { timeout: config.timeout });
      break;
    }

    case 'evaluate': {
      logger.actionIntermediate(`evaluate: ${action.expression.slice(0, 60)}`);
      await page.evaluate(action.expression);
      break;
    }

    case 'unknown': {
      throw new Error(`AI could not determine action: ${action.reason}`);
    }

    default: {
      throw new Error(`Unsupported action: ${(action as { action: string }).action}`);
    }
  }
}

function describeAction(action: Action): string {
  switch (action.action) {
    case 'goto':             return `goto ${action.url}`;
    case 'click':            return `click ${action.description || action.selector}`;
    case 'fill':             return `fill "${action.description || action.selector}" = "${action.value}"`;
    case 'type':             return `type "${action.value}" into ${action.description || action.selector}`;
    case 'press':            return `press ${action.key}`;
    case 'scroll':           return `scroll ${action.direction} ${action.pixels}px`;
    case 'wait':             return `wait ${action.seconds}s`;
    case 'waitForSelector':  return `waitForSelector ${action.selector}`;
    case 'hover':            return `hover ${action.description || action.selector}`;
    case 'select':           return `select "${action.value}"`;
    case 'screenshot':       return `screenshot "${action.name}"`;
    case 'goBack':           return 'goBack';
    case 'goForward':        return 'goForward';
    case 'reload':           return 'reload';
    case 'waitForNavigation':return 'waitForNavigation';
    case 'evaluate':         return `evaluate(${action.expression.slice(0, 40)})`;
    case 'unknown':          return `unknown: ${action.reason}`;
    default:                 return JSON.stringify(action);
  }
}

async function isPageAlive(page: Page): Promise<boolean> {
  try {
    await page.title();
    return true;
  } catch {
    return false;
  }
}

async function gracefulClose(context: BrowserContext | null, browser: Browser | null): Promise<void> {
  try { if (context) await context.close(); } catch { /* ignore */ }
  try { if (browser) await browser.close(); } catch { /* ignore */ }
}

interface SummaryData {
  stepResults: StepResult[];
  videoPath: string | null;
  videoSizeBytes: number | null;
  screenshotCount: number;
  totalUsage: TokenUsage;
  succeededSteps: number;
  failedSteps: number;
  durationMs: number;
}

function printSummary(data: SummaryData): void {
  const { stepResults, videoPath, videoSizeBytes, screenshotCount, totalUsage, succeededSteps, failedSteps } = data;

  logger.divider();
  logger.info('Session complete');

  const stepColor = failedSteps === 0 ? 'green' : 'yellow';
  logger.summary([{ label: 'Steps:', value: `${succeededSteps}/${stepResults.length} succeeded, ${failedSteps} failed`, color: stepColor }]);

  for (const failed of stepResults.filter(r => !r.success)) {
    const reason = failed.actions[failed.actions.length - 1]?.error ?? 'unknown error';
    logger.summary([{ label: 'Failed:', value: `Step ${failed.stepNumber} — ${reason}`, color: 'red' }]);
  }

  if (videoPath) {
    const sizeStr = videoSizeBytes ? ` (${formatFileSize(videoSizeBytes)})` : '';
    logger.summary([{ label: 'Video:', value: `${videoPath}${sizeStr}`, color: 'white' }]);
  }

  if (screenshotCount > 0) {
    logger.summary([{ label: 'Screens:', value: `${screenshotCount} screenshots saved`, color: 'white' }]);
  }

  const cost = estimateCost(totalUsage);
  logger.summary([{
    label: 'Tokens:',
    value: `${totalUsage.promptTokens.toLocaleString()} prompt / ${totalUsage.completionTokens.toLocaleString()} completion (${cost})`,
    color: 'white',
  }]);

  logger.divider();
}
