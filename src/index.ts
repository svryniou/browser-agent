#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { parseInstructionsFile } from './parser';
import { buildConfig } from './config';
import { runSession } from './executor';
import { AIClient } from './ai';
import { extractPageContext } from './context';
import { logger } from './logger';
import { chromium } from 'playwright';
import * as path from 'path';

const SUPPORTED_ACTIONS = [
  'goto          — Navigate to a URL',
  'click         — Click an element',
  'fill          — Clear a field and type text (for forms)',
  'type          — Type text keystroke-by-keystroke (triggers JS handlers)',
  'press         — Press a keyboard key or combination',
  'scroll        — Scroll the page up or down',
  'wait          — Wait for a fixed number of seconds',
  'waitForSelector — Wait for a CSS selector to match an element',
  'hover         — Hover over an element',
  'select        — Select an option in a <select> element',
  'screenshot    — Take a screenshot with a label',
  'goBack        — Navigate back in history',
  'goForward     — Navigate forward in history',
  'reload        — Reload the current page',
  'waitForNavigation — Wait for page navigation to complete',
  'evaluate      — Execute a JavaScript expression in the page',
  'unknown       — Returned by AI when it cannot determine what to do',
];

const program = new Command();

program
  .name('browser-agent')
  .description('Automate browser sessions from plain-English instructions')
  .version('1.0.0');

program
  .command('run <file>')
  .description('Execute browser instructions from a .txt file')
  .option('-o, --output <dir>', 'Output directory for recordings and screenshots', './output')
  .option('--headed', 'Show the browser window (default: headless)', false)
  .option('--slow-mo <ms>', 'Slow down each action in milliseconds', '0')
  .option('--timeout <ms>', 'Element finding timeout per action', '10000')
  .option('--resolution <WxH>', 'Viewport and recording resolution', '1280x720')
  .option('--no-record', 'Disable video recording')
  .option('-v, --verbose', 'Log full Claude API request/response payloads', false)
  .option('--step-pause <ms>', 'Pause between steps in ms', '500')
  .option('--start-step <n>', 'Start execution from step N', '1')
  .option('--stop-on-error', 'Stop execution on first failure', false)
  .option('--user-agent <string>', 'Custom user agent string')
  .option('--locale <string>', 'Browser locale', 'en-US')
  .action(async (file: string, options) => {
    try {
      const steps = parseInstructionsFile(file);
      const config = buildConfig({
        instructionsFile: path.resolve(file),
        output: options.output,
        headed: options.headed,
        slowMo: options.slowMo,
        timeout: options.timeout,
        resolution: options.resolution,
        record: options.record,
        verbose: options.verbose,
        stepPause: options.stepPause,
        startStep: options.startStep,
        stopOnError: options.stopOnError,
        userAgent: options.userAgent,
        locale: options.locale,
        command: 'run',
      });

      const result = await runSession(steps, config);
      process.exit(result.failedSteps > 0 ? 1 : 0);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('validate <file>')
  .description('Parse instructions and preview Claude-planned actions without executing them')
  .option('-v, --verbose', 'Show full page context sent to Claude', false)
  .option('--timeout <ms>', 'Element finding timeout', '10000')
  .option('--resolution <WxH>', 'Viewport resolution', '1280x720')
  .action(async (file: string, options) => {
    // Check API key
    if (!process.env.ANTHROPIC_API_KEY) {
      logger.error('ANTHROPIC_API_KEY is not set. Run "browser-agent run" for setup instructions.');
      process.exit(1);
    }

    try {
      const steps = parseInstructionsFile(file);
      logger.info(`Validating ${steps.length} steps from ${file}`);
      logger.info('Launching browser to capture page context...');

      const config = buildConfig({
        instructionsFile: path.resolve(file),
        headed: false,
        timeout: options.timeout,
        resolution: options.resolution,
        record: false,
        verbose: options.verbose,
        command: 'validate',
      });

      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: config.resolution,
      });
      const page = await context.newPage();

      // Navigate to a blank page to start
      await page.goto('about:blank');

      const aiClient = new AIClient();

      logger.divider();

      for (const step of steps) {
        logger.step(step.stepNumber, steps.length, step.instruction);
        const pageContext = await extractPageContext(page);

        try {
          const aiResult = await aiClient.interpretInstruction(
            step.instruction,
            pageContext,
            [],
            options.verbose
          );

          for (const action of aiResult.actions) {
            logger.actionIntermediate(`planned: ${JSON.stringify(action)}`);
          }
          logger.action(`Step ${step.stepNumber} planned (${aiResult.actions.length} action(s))`, true);
        } catch (err) {
          logger.action(`Step ${step.stepNumber} — AI error`, false);
          logger.error(err instanceof Error ? err.message : String(err));
        }
      }

      await context.close();
      await browser.close();

      const totalUsage = aiClient.getTotalUsage();
      logger.divider();
      logger.info('Validation complete');
      logger.summary([{
        label: 'Tokens:',
        value: `${totalUsage.promptTokens.toLocaleString()} prompt / ${totalUsage.completionTokens.toLocaleString()} completion`,
        color: 'white',
      }]);
      logger.divider();
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('list-actions')
  .description('Print all supported action types')
  .action(() => {
    console.log('\nSupported action types:\n');
    for (const a of SUPPORTED_ACTIONS) {
      console.log('  ' + a);
    }
    console.log();
  });

program.parse(process.argv);
