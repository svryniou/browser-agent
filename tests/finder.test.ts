import { describe, it, expect, vi } from 'vitest';
import { findElement } from '../src/finder';
import type { Page, Locator } from 'playwright';

/**
 * makeLocator creates a mock Locator where:
 * - .first() returns itself (so page.locator(sel).first() works)
 * - .waitFor() resolves if found=true, rejects if found=false
 */
function makeLocator(found: boolean): Locator {
  const locator: Partial<Locator> & { first: ReturnType<typeof vi.fn> } = {
    waitFor: found
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error('Timeout')),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    first: vi.fn(),
    selectOption: vi.fn().mockResolvedValue([]),
    hover: vi.fn().mockResolvedValue(undefined),
    pressSequentially: vi.fn().mockResolvedValue(undefined),
  };
  // .first() returns itself so chaining page.locator(sel).first() works
  locator.first = vi.fn().mockReturnValue(locator as unknown as Locator);
  return locator as unknown as Locator;
}

function makePage(overrides: Partial<{
  locator: (sel: string) => Locator;
  getByRole: (role: string, opts?: object) => Locator;
  getByText: (text: string, opts?: object) => Locator;
  getByPlaceholder: (text: string, opts?: object) => Locator;
  getByLabel: (text: string, opts?: object) => Locator;
  waitForSelector: (sel: string, opts?: object) => Promise<void>;
}> = {}): Page {
  return {
    locator: overrides.locator ?? vi.fn().mockReturnValue(makeLocator(false)),
    getByRole: overrides.getByRole ?? vi.fn().mockReturnValue(makeLocator(false)),
    getByText: overrides.getByText ?? vi.fn().mockReturnValue(makeLocator(false)),
    getByPlaceholder: overrides.getByPlaceholder ?? vi.fn().mockReturnValue(makeLocator(false)),
    getByLabel: overrides.getByLabel ?? vi.fn().mockReturnValue(makeLocator(false)),
    waitForSelector: overrides.waitForSelector ?? vi.fn().mockRejectedValue(new Error('Timeout')),
  } as unknown as Page;
}

describe('findElement', () => {
  it('succeeds with CSS selector on first try', async () => {
    const foundLocator = makeLocator(true);
    const page = makePage({
      locator: vi.fn().mockReturnValue(foundLocator),
    });

    const result = await findElement(page, '#my-button', 'submit button', 5000);
    expect(result.strategy).toBe('css');
    // result.locator is foundLocator.first() which returns foundLocator itself
    expect(result.locator).toBe(foundLocator);
  });

  it('falls through to role-based when CSS fails', async () => {
    const foundLocator = makeLocator(true);
    const page = makePage({
      locator: vi.fn().mockReturnValue(makeLocator(false)),
      getByRole: vi.fn().mockReturnValue(foundLocator),
    });

    const result = await findElement(page, '.nonexistent', 'button', 5000);
    expect(result.strategy).toMatch(/^role:/);
  });

  it('falls through to text match when role fails', async () => {
    const foundLocator = makeLocator(true);
    const page = makePage({
      locator: vi.fn().mockReturnValue(makeLocator(false)),
      getByRole: vi.fn().mockReturnValue(makeLocator(false)),
      getByText: vi.fn().mockReturnValue(foundLocator),
    });

    const result = await findElement(page, '.nonexistent', 'Submit button here', 5000);
    expect(result.strategy).toBe('text');
  });

  it('falls through to placeholder when text fails', async () => {
    const foundLocator = makeLocator(true);
    const page = makePage({
      locator: vi.fn().mockReturnValue(makeLocator(false)),
      getByRole: vi.fn().mockReturnValue(makeLocator(false)),
      getByText: vi.fn().mockReturnValue(makeLocator(false)),
      getByPlaceholder: vi.fn().mockReturnValue(foundLocator),
    });

    const result = await findElement(page, 'input[name=q]', 'search query input', 5000);
    expect(result.strategy).toBe('placeholder');
  });

  it('falls through to label when placeholder fails', async () => {
    const foundLocator = makeLocator(true);
    const page = makePage({
      locator: vi.fn().mockReturnValue(makeLocator(false)),
      getByRole: vi.fn().mockReturnValue(makeLocator(false)),
      getByText: vi.fn().mockReturnValue(makeLocator(false)),
      getByPlaceholder: vi.fn().mockReturnValue(makeLocator(false)),
      getByLabel: vi.fn().mockReturnValue(foundLocator),
    });

    const result = await findElement(page, 'input#email', 'email address', 5000);
    expect(result.strategy).toBe('label');
  });

  it('throws when all strategies fail', async () => {
    const page = makePage({
      locator: vi.fn().mockReturnValue(makeLocator(false)),
      getByRole: vi.fn().mockReturnValue(makeLocator(false)),
      getByText: vi.fn().mockReturnValue(makeLocator(false)),
      getByPlaceholder: vi.fn().mockReturnValue(makeLocator(false)),
      getByLabel: vi.fn().mockReturnValue(makeLocator(false)),
      waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout')),
    });

    await expect(findElement(page, '.nonexistent', 'ghost element', 100)).rejects.toThrow(
      'Element not found after trying all strategies'
    );
  });

  it('works without a description', async () => {
    const foundLocator = makeLocator(true);
    const page = makePage({
      locator: vi.fn().mockReturnValue(foundLocator),
    });

    const result = await findElement(page, '#btn', undefined, 5000);
    expect(result.strategy).toBe('css');
  });
});
