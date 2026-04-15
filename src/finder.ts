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
  // Keep each strategy attempt short so the cascade (role × keyword combos)
  // doesn't stall when an element is absent. 300 ms gives slow-rendering pages
  // a fair chance without letting a bad selector block for seconds.
  const shortTimeout = Math.min(timeout, 300);

  // Strategy 1: Direct CSS selector
  try {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'attached', timeout: shortTimeout });
    logger.actionIntermediate(`located via CSS selector: ${selector}`);
    return { locator, strategy: 'css' };
  } catch {
    // Fall through
  }

  // Strategy 2: Role-based using description keywords.
  // Limit to the top 4 keywords and the 4 most common interactive roles to
  // cap the worst-case combinatorial cost at 16 attempts (≈ 1-2 s typical).
  if (description) {
    const keywords = extractKeywords(description).slice(0, 4);
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
  }

  // Strategy 2b: Broader role types (forms, combos) — same keyword limit
  if (description) {
    const keywords = extractKeywords(description).slice(0, 4);
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
  }

  // Strategy 3: Text match
  if (description) {
    const keywords = extractKeywords(description).slice(0, 4);
    for (const keyword of keywords) {
      if (keyword.length < 2) continue;
      try {
        const locator = page.getByText(keyword, { exact: false }).first();
        await locator.waitFor({ state: 'attached', timeout: shortTimeout });
        logger.actionIntermediate(`located via text: "${keyword}"`);
        return { locator, strategy: 'text' };
      } catch {
        // Fall through
      }
    }
  }

  // Strategy 4: Placeholder (for inputs)
  if (description) {
    const keywords = extractKeywords(description).slice(0, 4);
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
  }

  // Strategy 5: Label (for form fields)
  if (description) {
    const keywords = extractKeywords(description).slice(0, 4);
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

  // Final attempt: one last wait capped to the configured action timeout
  try {
    const finalTimeout = Math.min(timeout, 3000);
    await page.waitForSelector(selector, { timeout: finalTimeout, state: 'attached' });
    const locator = page.locator(selector).first();
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

  // Remove filler words and extract meaningful terms
  const stopWords = new Set([
    'the', 'a', 'an', 'on', 'in', 'at', 'to', 'for', 'of',
    'and', 'or', 'is', 'are', 'was', 'be', 'by', 'it', 'that',
    'this', 'with', 'click', 'button', 'link', 'field', 'input',
    'element', 'box', 'text', 'type', 'enter', 'what',
  ]);

  const words = text
    .toLowerCase()
    .replace(/['"]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

  // Return full text first, then individual keywords
  const unique = [...new Set([text, ...words])];
  return unique;
}
