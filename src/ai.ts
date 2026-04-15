import Anthropic from '@anthropic-ai/sdk';
import { Action, AIResponse, PageContext, StepSummary, TokenUsage } from './types';
import { formatContextForPrompt } from './context';
import { logger } from './logger';

const SYSTEM_PROMPT = `OUTPUT RULE: Respond with ONLY raw JSON — no markdown fences, no explanation text, no preamble, no trailing commentary. A single character of non-JSON text will break the system.

You are a browser automation assistant. You receive a natural language
instruction and the current page state (URL, title, visible elements).
Return a JSON response describing exactly what Playwright should do.

Return either a single action object or an array of action objects if
the instruction implies multiple sub-steps (e.g., "search for X" =
click search box + type X + press Enter).

Action schemas:

{ "action": "goto", "url": "<absolute URL>" }

{ "action": "click", "selector": "<CSS selector>", "description": "<what we're clicking>" }

{ "action": "fill", "selector": "<CSS selector>", "value": "<text to type>", "description": "<what field>" }

{ "action": "type", "selector": "<CSS selector>", "value": "<text to type>", "description": "<what field>" }

{ "action": "press", "key": "Enter | Tab | Escape | ArrowDown | ArrowUp | Backspace | Space | F5 | Control+a | ..." }

{ "action": "scroll", "direction": "down | up", "pixels": <number> }

{ "action": "wait", "seconds": <number> }

{ "action": "waitForSelector", "selector": "<CSS selector>", "state": "visible | hidden | attached | detached" }

{ "action": "hover", "selector": "<CSS selector>", "description": "<what>" }

{ "action": "select", "selector": "<CSS selector>", "value": "<option value>", "description": "<what>" }

{ "action": "screenshot", "name": "<label>" }

{ "action": "goBack" }
{ "action": "goForward" }
{ "action": "reload" }

{ "action": "waitForNavigation" }

{ "action": "evaluate", "expression": "<JS expression>" }

Rules:
- Prefer the most specific CSS selector that uniquely identifies the target
- If the user says "first", "second", etc., use :nth-of-type or similar
- If the instruction is vague ("something interesting"), pick the best
  match from the available elements and explain your choice in description
- For search flows: use "type" (not "fill") + press Enter, to trigger
  search suggestions and JS handlers
- HOVER RULE: For hover actions, always target the most specific leaf element
  that has the matching text/label — an <a>, <button>, or element with
  role="button"/"link"/"menuitem". NEVER use a parent container (<nav>, <ul>,
  <div>, <section>, <header>) for hover. Example: to hover "Solutions" in a
  nav bar, pick the <a> or <button> whose text is "Solutions", not the <nav>.
- DESCRIPTION RULE: In the description field, name only the element itself
  (e.g. "Solutions link") — never include verbs like "Hovering over" or
  prepositions like "over", "to", "on". This is used to locate the element.
- SCREENSHOT RULE: NEVER use the screenshot action as an intermediate step or
  to verify a condition. Only use screenshot if the instruction explicitly says
  "take a screenshot" or "screenshot". For conditional instructions like
  "if X appears, do Y": check the page elements list directly — if X is present
  in the elements, perform Y immediately without taking a screenshot first.
- If you genuinely cannot determine what to do, return:
  { "action": "unknown", "reason": "<why>" }`;

export class AIClient {
  private client: Anthropic;
  private totalPromptTokens = 0;
  private totalCompletionTokens = 0;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('\n❌  ANTHROPIC_API_KEY is not set.\n');
      console.error('To fix this:');
      console.error('  1. Copy .env.example to .env');
      console.error('  2. Add your Anthropic API key: ANTHROPIC_API_KEY=sk-ant-...');
      console.error('  3. Run: source .env  (or set the variable in your shell)\n');
      process.exit(1);
    }
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Interpret a natural language instruction into Playwright actions,
   * given the current page context and rolling step history.
   */
  async interpretInstruction(
    instruction: string,
    pageContext: PageContext,
    stepHistory: StepSummary[],
    verbose: boolean = false,
    errorContext?: { previousError: string; attempt: number }
  ): Promise<AIResponse & { usage: TokenUsage }> {
    const contextStr = formatContextForPrompt(pageContext);
    const historyStr = this.formatHistory(stepHistory);

    let userContent = '';

    if (historyStr) {
      userContent += `=== PREVIOUS STEPS ===\n${historyStr}\n\n`;
    }

    userContent += `=== CURRENT PAGE ===\n${contextStr}\n\n`;

    if (errorContext) {
      userContent += `=== RETRY CONTEXT ===\n`;
      userContent += `This is attempt ${errorContext.attempt} after a failure.\n`;
      userContent += `Previous error: ${errorContext.previousError}\n`;
      userContent += `Please try a different approach or selector.\n\n`;
    }

    userContent += `=== INSTRUCTION ===\n${instruction}`;

    if (verbose) {
      logger.verbose('--- AI REQUEST ---');
      logger.verbose(`Instruction: ${instruction}`);
      logger.verbose(`History entries: ${stepHistory.length}`);
    }

    // Two-tier retry strategy:
    //  1) API errors: exponential backoff (network, rate-limit, etc.)
    //  2) JSON parse errors: immediate single retry using assistant-prefill
    //     technique — send the assistant's turn starting with '{', which forces
    //     Haiku to continue with a valid JSON object instead of English prose.
    //     This stays entirely within the AI call and avoids the expensive
    //     step-level retry (screenshot + page re-extraction).
    let lastError: Error | null = null;
    let jsonRetried = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      const usePrefill = jsonRetried && attempt > 0;

      if (attempt > 0 && !usePrefill) {
        // API error backoff
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(r => setTimeout(r, delay));
        logger.retry(attempt, `API error: ${lastError?.message}`);
      }

      try {
        const messages: Anthropic.MessageParam[] = [
          { role: 'user', content: userContent },
        ];
        // Prefill forces the model to open with '{' → must produce a JSON object.
        if (usePrefill) messages.push({ role: 'assistant', content: '{' });

        const response = await this.client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages,
        });

        const rawText = response.content[0].type === 'text'
          ? response.content[0].text
          : '';
        // Re-attach the prefill character so the parser sees complete JSON.
        const rawResponse = usePrefill ? '{' + rawText : rawText;

        if (verbose) {
          logger.verbose('--- AI RESPONSE ---');
          logger.verbose(rawResponse);
        }

        const usage: TokenUsage = {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        };

        this.totalPromptTokens += usage.promptTokens;
        this.totalCompletionTokens += usage.completionTokens;

        logger.actionIntermediate(
          `tokens: ${usage.promptTokens} prompt / ${usage.completionTokens} completion`
        );

        try {
          const actions = parseActionsFromJSON(rawResponse);
          return { actions, rawResponse, usage };
        } catch (parseErr) {
          // First JSON failure: retry immediately with prefill, no backoff.
          if (!jsonRetried) {
            jsonRetried = true;
            lastError = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
            continue;
          }
          // Second JSON failure (with prefill): escalate to step-level retry.
          throw parseErr;
        }

      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // JSON_PARSE_ERROR that slipped through (e.g. second prefill failure) —
        // let the step-level retry handle it, don't do more API retries.
        if (lastError.message.startsWith('JSON_PARSE_ERROR:')) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error('AI request failed after 3 attempts');
  }

  getTotalUsage(): TokenUsage {
    return {
      promptTokens: this.totalPromptTokens,
      completionTokens: this.totalCompletionTokens,
      totalTokens: this.totalPromptTokens + this.totalCompletionTokens,
    };
  }

  private formatHistory(history: StepSummary[]): string {
    if (history.length === 0) return '';
    return history
      .map(s => `Step ${s.stepNumber}: "${s.instruction}" → ${s.actionsSummary} [${s.success ? 'OK' : 'FAILED'}]`)
      .join('\n');
  }
}

/**
 * Parse Claude's JSON response into an array of Action objects.
 * Handles both single objects and arrays.
 * Retries once if the JSON is invalid (strips possible markdown fences).
 */
export function parseActionsFromJSON(raw: string): Action[] {
  let text = raw.trim();

  // Strip markdown fences if Claude added them despite instructions.
  // Also remove any explanatory text that appears after the closing fence.
  text = text.replace(/^```(?:json)?\s*/i, ''); // remove leading fence
  text = text.replace(/```[\s\S]*$/, '');        // remove closing fence + anything after
  text = text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Try stripping leading/trailing non-JSON characters
    const match = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (match) {
      try {
        parsed = JSON.parse(match[1]);
      } catch {
        throw new Error(`JSON_PARSE_ERROR: Could not parse AI response as JSON: ${text.slice(0, 200)}`);
      }
    } else {
      throw new Error(`JSON_PARSE_ERROR: Could not parse AI response as JSON: ${text.slice(0, 200)}`);
    }
  }

  if (Array.isArray(parsed)) {
    return parsed as Action[];
  } else if (parsed && typeof parsed === 'object') {
    return [parsed as Action];
  } else {
    throw new Error(`JSON_PARSE_ERROR: AI response is not an object or array: ${text.slice(0, 200)}`);
  }
}

/**
 * Compute estimated cost for display.
 * Using claude-sonnet-4-6 pricing: $3/M input, $15/M output (approximate).
 */
export function estimateCost(usage: TokenUsage): string {
  const inputCost = (usage.promptTokens / 1_000_000) * 3.0;
  const outputCost = (usage.completionTokens / 1_000_000) * 15.0;
  const total = inputCost + outputCost;
  return `$${total.toFixed(4)}`;
}
