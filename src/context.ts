import { Page } from 'playwright';
import { ElementInfo, PageContext } from './types';

/**
 * Extracts all visible interactive elements from the page via in-browser DOM traversal.
 * Returns a PageContext object for use in AI prompts.
 */
export async function extractPageContext(page: Page): Promise<PageContext> {
  const url = page.url();
  const title = await page.title();
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  // Extract elements via in-page evaluation
  const elements = await page.evaluate((): Array<{
    tag: string;
    text: string;
    role: string;
    ariaLabel: string;
    placeholder: string;
    name: string;
    id: string;
    href: string;
    selector: string;
    boundingBox: { x: number; y: number; width: number; height: number } | null;
    visible: boolean;
    enabled: boolean;
  }> => {
    const INTERACTIVE_TAGS = new Set([
      'a', 'button', 'input', 'select', 'textarea', 'label',
      'form', 'details', 'summary', '[role]', 'nav', 'header',
    ]);

    const INTERACTIVE_ROLES = new Set([
      'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
      'listbox', 'menuitem', 'tab', 'treeitem', 'option', 'search',
      'searchbox', 'slider', 'spinbutton', 'switch',
    ]);

    function getCssSelector(el: Element): string {
      if (el.id) {
        return `#${CSS.escape(el.id)}`;
      }

      const parts: string[] = [];
      let current: Element | null = el;

      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
          selector = `#${CSS.escape(current.id)}`;
          parts.unshift(selector);
          break;
        }

        const classes = Array.from(current.classList)
          .filter(c => c.length > 0 && !c.match(/^\d/))
          .slice(0, 2)
          .map(c => `.${CSS.escape(c)}`)
          .join('');
        if (classes) selector += classes;

        // Add nth-of-type if there are siblings with same tag
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            s => s.tagName === current!.tagName
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }

        parts.unshift(selector);
        current = current.parentElement;

        if (parts.length >= 4) break;
      }

      return parts.join(' > ');
    }

    function getImplicitRole(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const type = (el as HTMLInputElement).type?.toLowerCase();
      const roleMap: Record<string, string> = {
        a: 'link',
        button: 'button',
        form: 'form',
        h1: 'heading', h2: 'heading', h3: 'heading',
        h4: 'heading', h5: 'heading', h6: 'heading',
        header: 'banner',
        nav: 'navigation',
        main: 'main',
        footer: 'contentinfo',
        select: 'combobox',
        textarea: 'textbox',
        img: 'img',
        table: 'table',
        ul: 'list',
        ol: 'list',
        li: 'listitem',
      };
      if (tag === 'input') {
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
        if (type === 'search') return 'searchbox';
        return 'textbox';
      }
      return roleMap[tag] || '';
    }

    function isVisible(el: Element): boolean {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function isEnabled(el: Element): boolean {
      return !(el as HTMLInputElement).disabled;
    }

    const candidates = Array.from(document.querySelectorAll(
      'a, button, input, select, textarea, [role], [onclick], [tabindex]'
    ));

    // Also include any element that appears interactive
    const allElements = Array.from(document.querySelectorAll('*')).filter(el => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      return (
        INTERACTIVE_TAGS.has(tag) ||
        INTERACTIVE_ROLES.has(role) ||
        el.hasAttribute('onclick') ||
        (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1')
      );
    });

    const seen = new Set<Element>();
    const merged = [...candidates, ...allElements].filter(el => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });

    const results = [];

    for (const el of merged) {
      if (!isVisible(el)) continue;

      const rect = el.getBoundingClientRect();
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      const role = el.getAttribute('role') || getImplicitRole(el);
      const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '';
      const placeholder = (el as HTMLInputElement).placeholder || '';
      const name = (el as HTMLInputElement).name || '';
      const id = el.id || '';
      const href = (el as HTMLAnchorElement).href || '';

      results.push({
        tag: el.tagName.toLowerCase(),
        text,
        role,
        ariaLabel,
        placeholder,
        name,
        id,
        href,
        selector: getCssSelector(el),
        boundingBox: rect.width > 0 && rect.height > 0
          ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          : null,
        visible: true,
        enabled: isEnabled(el),
      });
    }

    return results;
  });

  // Score and limit elements to ~200 most relevant
  const scored = elements.map(el => {
    let score = 0;
    if (['button', 'a', 'input', 'select', 'textarea'].includes(el.tag)) score += 3;
    if (el.text.length > 0) score += 2;
    if (el.role) score += 1;
    if (el.ariaLabel) score += 2;
    if (el.id) score += 1;
    if (el.enabled) score += 2;
    if (el.boundingBox) {
      // Prefer elements in the viewport top half
      if (el.boundingBox.y < 600) score += 1;
    }
    return { el, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const limited: ElementInfo[] = scored.slice(0, 200).map(s => s.el as ElementInfo);

  // Get text snapshot of visible content
  const textSnapshot = await page.evaluate(() => {
    function getVisibleText(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent?.trim() || '';
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node as Element;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return '';
      return Array.from(el.childNodes).map(getVisibleText).filter(Boolean).join(' ');
    }
    return getVisibleText(document.body).replace(/\s+/g, ' ').trim();
  });

  return {
    url,
    title,
    viewport,
    elements: limited,
    textSnapshot: textSnapshot.slice(0, 2000),
  };
}

/**
 * Format page context for inclusion in Claude prompt.
 */
export function formatContextForPrompt(ctx: PageContext): string {
  const elementLines = ctx.elements.map(el => {
    const parts = [
      `<${el.tag}>`,
      el.role ? `role=${el.role}` : '',
      el.text ? `text="${el.text}"` : '',
      el.ariaLabel ? `aria-label="${el.ariaLabel}"` : '',
      el.placeholder ? `placeholder="${el.placeholder}"` : '',
      el.name ? `name="${el.name}"` : '',
      el.id ? `id="${el.id}"` : '',
      el.href ? `href="${el.href.slice(0, 80)}"` : '',
      el.boundingBox ? `bbox=(${el.boundingBox.x},${el.boundingBox.y},${el.boundingBox.width}x${el.boundingBox.height})` : '',
      `selector="${el.selector}"`,
      !el.enabled ? '[disabled]' : '',
    ].filter(Boolean);
    return parts.join(' ');
  }).join('\n');

  return `URL: ${ctx.url}
Title: ${ctx.title}
Viewport: ${ctx.viewport.width}x${ctx.viewport.height}

=== INTERACTIVE ELEMENTS (${ctx.elements.length}) ===
${elementLines}

=== PAGE TEXT SNAPSHOT ===
${ctx.textSnapshot}`;
}
