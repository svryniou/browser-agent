import { Page, Locator } from 'playwright';
import { logger } from './logger';

export interface FindResult {
  locator: Locator;
  strategy: string;
}

/**
 * Resolves a target element using a cascade of strategies.
 * Returns the first locator that finds at least one element.
 */
export async function findElement(
  page: Page,
  selector: string,
  description: string = '',
  timeout: number = 10000
): Promise<FindResult> {
  // Keep each strategy attempt short so the cascade doesn't stall when an element
  // is absent. 100 ms is enough for already-rendered pages; the final fallback
  // uses a longer wait for genuinely slow elements.
  const shortTimeout = Math.min(timeout, 100);

  // Container tags that the AI sometimes generates for hover/click targets but that
  // are never the actual interactive element — prefer description-based strategies.
  const CONTAINER_TAGS = new Set(['nav', 'header', 'section', 'article', 'aside', 'main',
    'ul', 'ol', 'li', 'form', 'footer', 'figure', 'fieldset', 'details', 'summary']);

  // Strategy 1: Direct CSS selector — skip if it resolves to a container element
  // and a more precise description is available (let later strategies find a leaf).
  try {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'attached', timeout: shortTimeout });

    // If we have a description, check whether the matched element is a container.
    // If so, fall through to description-based strategies to find a leaf element.
    if (description) {
      const tag = await locator.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
      // Also treat generic `div` with no interactive role as a container.
      const role = await locator.evaluate(el => (el.getAttribute('role') || '').toLowerCase()).catch(() => '');
      const isInteractiveRole = ['button', 'link', 'menuitem', 'tab', 'option',
        'checkbox', 'radio', 'combobox', 'textbox', 'searchbox'].includes(role);
      const isContainer = CONTAINER_TAGS.has(tag) || (tag === 'div' && !isInteractiveRole);

      if (!isContainer) {
        logger.actionIntermediate(`located via CSS selector: ${selector}`);
        return { locator, strategy: 'css' };
      }
      // Container matched — fall through to description-based strategies.
      logger.actionIntermediate(`CSS hit container <${tag}> — trying description-based strategies`);
    } else {
      logger.actionIntermediate(`located via CSS selector: ${selector}`);
      return { locator, strategy: 'css' };
    }
  } catch {
    // Fall through
  }

  if (description) {
    // Extract up to 3 keywords for description-based strategies.
    // Each failed attempt costs `shortTimeout` ms, so keep the count small.
    const keywords = extractKeywords(description).slice(0, 3);

    // Strategy 2: Text match — fastest and most direct for visible text labels.
    // Try interactive elements first (a, button, role=link/menuitem) so that
    // "Innovation Management" finds the dropdown <a> before it finds the page
    // <h1> heading of the same name. Fall back to generic getByText only if no
    // interactive element matches.
    for (const keyword of keywords) {
      if (keyword.length < 2) continue;
      try {
        // Interactive elements only — avoids matching headings, paragraphs, etc.
        const safePattern = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const locator = page
          .locator('a, button, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]')
          .filter({ hasText: new RegExp(safePattern, 'i') })
          .first();
        await locator.waitFor({ state: 'attached', timeout: shortTimeout });
        logger.actionIntermediate(`located via interactive text: "${keyword}"`);
        return { locator, strategy: 'text-interactive' };
      } catch {
        // Fall through to generic text
      }
      try {
        const locator = page.getByText(keyword, { exact: false }).first();
        await locator.waitFor({ state: 'attached', timeout: shortTimeout });
        logger.actionIntermediate(`located via text: "${keyword}"`);
        return { locator, strategy: 'text' };
      } catch {
        // Try next keyword
      }
    }

    // Strategy 3: Role-based — interactive roles (button, link, menuitem, tab).
    // 3 keywords × 4 roles = 12 attempts max.
    for (const keyword of keywords) {
      for (const role of ['button', 'link', 'menuitem', 'tab'] as const) {
        try {
          const locator = page.getByRole(role, { name: keyword, exact: false }).first();
          await locator.waitFor({ state: 'attached', timeout: shortTimeout });
          logger.actionIntermediate(`located via role=${role} name="${keyword}"`);
          return { locator, strategy: `role:${role}` };
        } catch {
          // Try next
        }
      }
    }

    // Strategy 3b: Form / select roles (textbox, checkbox, combobox, option).
    for (const keyword of keywords) {
      for (const role of ['textbox', 'checkbox', 'combobox', 'option'] as const) {
        try {
          const locator = page.getByRole(role, { name: keyword, exact: false }).first();
          await locator.waitFor({ state: 'attached', timeout: shortTimeout });
          logger.actionIntermediate(`located via role=${role} name="${keyword}"`);
          return { locator, strategy: `role:${role}` };
        } catch {
          // Try next
        }
      }
    }

    // Strategy 4: Placeholder (for inputs)
    for (const keyword of keywords) {
      try {
        const locator = page.getByPlaceholder(keyword, { exact: false }).first();
        await locator.waitFor({ state: 'attached', timeout: shortTimeout });
        logger.actionIntermediate(`located via placeholder: "${keyword}"`);
        return { locator, strategy: 'placeholder' };
      } catch {
        // Fall through
      }
    }

    // Strategy 5: Label (for form fields)
    for (const keyword of keywords) {
      try {
        const locator = page.getByLabel(keyword, { exact: false }).first();
        await locator.waitFor({ state: 'attached', timeout: shortTimeout });
        logger.actionIntermediate(`located via label: "${keyword}"`);
        return { locator, strategy: 'label' };
      } catch {
        // Fall through
      }
    }
  }

  // Final attempt: one last wait then use the CSS selector as-is (even if container)
  try {
    const finalTimeout = Math.min(timeout, 3000);
    await page.waitForSelector(selector, { timeout: finalTimeout, state: 'attached' });
    const locator = page.locator(selector).first();
    logger.actionIntermediate(`falling back to CSS selector (container): ${selector}`);
    return { locator, strategy: 'css-waited' };
  } catch {
    // Fall through
  }

  throw new Error(
    `Element not found after trying all strategies.\n` +
    `  Selector: ${selector}\n` +
    `  Description: ${description}`
  );
}

function extractKeywords(text: string): string[] {
  if (!text) return [];

  // Remove filler words and extract meaningful terms.
  // Include common automation-description verbs/prepositions that are rarely
  // element names — otherwise "over" from "Hovering over Solutions" beats
  // "solutions" as a keyword match.
  const stopWords = new Set([
    'the', 'a', 'an', 'on', 'in', 'at', 'to', 'for', 'of',
    'and', 'or', 'is', 'are', 'was', 'be', 'by', 'it', 'that',
    'this', 'with', 'click', 'button', 'link', 'field', 'input',
    'element', 'box', 'text', 'type', 'enter', 'what',
    // Automation-description verbs / prepositions
    'hover', 'hovering', 'over', 'move', 'moving', 'cursor',
    'navigate', 'navigating', 'menu', 'item', 'nav', 'bar',
    'scroll', 'scrolling', 'down', 'up', 'page', 'section',
  ]);

  const words = text
    .toLowerCase()
    .replace(/['"]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

  // Sort by length descending so longer (more specific) keywords are tried first,
  // then de-duplicate while keeping full text as the very first attempt.
  words.sort((a, b) => b.length - a.length);
  const unique = [...new Set([text, ...words])];
  return unique;
}
