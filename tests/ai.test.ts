import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseActionsFromJSON, estimateCost } from '../src/ai';
import type { TokenUsage } from '../src/types';

describe('parseActionsFromJSON', () => {
  it('parses a single action object', () => {
    const json = JSON.stringify({ action: 'goto', url: 'https://example.com' });
    const actions = parseActionsFromJSON(json);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ action: 'goto', url: 'https://example.com' });
  });

  it('parses an array of actions', () => {
    const json = JSON.stringify([
      { action: 'click', selector: '#btn', description: 'submit button' },
      { action: 'wait', seconds: 2 },
    ]);
    const actions = parseActionsFromJSON(json);
    expect(actions).toHaveLength(2);
    expect(actions[0].action).toBe('click');
    expect(actions[1].action).toBe('wait');
  });

  it('strips markdown code fences', () => {
    const json = '```json\n{"action":"goto","url":"https://example.com"}\n```';
    const actions = parseActionsFromJSON(json);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('goto');
  });

  it('strips plain code fences', () => {
    const json = '```\n{"action":"wait","seconds":3}\n```';
    const actions = parseActionsFromJSON(json);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('wait');
  });

  it('throws JSON_PARSE_ERROR on truly invalid JSON', () => {
    expect(() => parseActionsFromJSON('not json at all')).toThrow('JSON_PARSE_ERROR');
  });

  it('extracts JSON from surrounding text', () => {
    const json = 'Sure, here is the action: {"action":"press","key":"Enter"} done.';
    const actions = parseActionsFromJSON(json);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('press');
  });

  it('handles all action types in array', () => {
    const actions = [
      { action: 'goto', url: 'https://example.com' },
      { action: 'click', selector: '#btn' },
      { action: 'fill', selector: '#input', value: 'hello' },
      { action: 'type', selector: '#search', value: 'query' },
      { action: 'press', key: 'Enter' },
      { action: 'scroll', direction: 'down', pixels: 300 },
      { action: 'wait', seconds: 2 },
      { action: 'goBack' },
      { action: 'goForward' },
      { action: 'reload' },
      { action: 'screenshot', name: 'test' },
      { action: 'unknown', reason: 'unclear' },
    ];
    const parsed = parseActionsFromJSON(JSON.stringify(actions));
    expect(parsed).toHaveLength(12);
  });

  it('handles whitespace around JSON', () => {
    const json = '  \n  {"action":"reload"}  \n  ';
    const actions = parseActionsFromJSON(json);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('reload');
  });
});

describe('estimateCost', () => {
  it('returns a dollar-formatted string', () => {
    const usage: TokenUsage = {
      promptTokens: 10000,
      completionTokens: 1000,
      totalTokens: 11000,
    };
    const cost = estimateCost(usage);
    expect(cost).toMatch(/^\$\d+\.\d{4}$/);
  });

  it('calculates input cost correctly', () => {
    const usage: TokenUsage = {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
    };
    const cost = estimateCost(usage);
    // 1M input tokens at $3/M = $3.0000
    expect(cost).toBe('$3.0000');
  });

  it('calculates output cost correctly', () => {
    const usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 1_000_000,
      totalTokens: 1_000_000,
    };
    const cost = estimateCost(usage);
    // 1M output tokens at $15/M = $15.0000
    expect(cost).toBe('$15.0000');
  });

  it('returns zero cost for zero tokens', () => {
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const cost = estimateCost(usage);
    expect(cost).toBe('$0.0000');
  });
});

describe('AIClient', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    vi.restoreAllMocks();
  });

  it('exits process when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    });

    const { AIClient } = await import('../src/ai');
    expect(() => new AIClient()).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('initializes when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    const { AIClient } = await import('../src/ai');
    expect(() => new AIClient()).not.toThrow();
  });

  it('getTotalUsage returns zero initially', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    const { AIClient } = await import('../src/ai');
    const client = new AIClient();
    const usage = client.getTotalUsage();
    expect(usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});
