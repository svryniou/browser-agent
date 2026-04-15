import { describe, it, expect } from 'vitest';
import { parseInstructionsText } from '../src/parser';

describe('parseInstructionsText', () => {
  it('parses numbered steps with periods', () => {
    const text = `1. Go to https://example.com\n2. Click the button\n3. Wait 2 seconds`;
    const steps = parseInstructionsText(text);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toEqual({ stepNumber: 1, instruction: 'Go to https://example.com' });
    expect(steps[1]).toEqual({ stepNumber: 2, instruction: 'Click the button' });
    expect(steps[2]).toEqual({ stepNumber: 3, instruction: 'Wait 2 seconds' });
  });

  it('parses numbered steps with parentheses', () => {
    const text = `1) First step\n2) Second step`;
    const steps = parseInstructionsText(text);
    expect(steps).toHaveLength(2);
    expect(steps[0].stepNumber).toBe(1);
    expect(steps[1].stepNumber).toBe(2);
  });

  it('parses numbered steps with colons', () => {
    const text = `1: Step one\n2: Step two`;
    const steps = parseInstructionsText(text);
    expect(steps).toHaveLength(2);
    expect(steps[0].instruction).toBe('Step one');
  });

  it('skips blank lines', () => {
    const text = `1. Step one\n\n\n2. Step two\n\n3. Step three`;
    const steps = parseInstructionsText(text);
    expect(steps).toHaveLength(3);
  });

  it('skips comment lines starting with #', () => {
    const text = `# This is a comment\n1. Go to https://example.com\n# Another comment\n2. Click something`;
    const steps = parseInstructionsText(text);
    expect(steps).toHaveLength(2);
    expect(steps[0].stepNumber).toBe(1);
    expect(steps[1].stepNumber).toBe(2);
  });

  it('auto-numbers unnumbered lines', () => {
    const text = `Go to https://example.com\nClick the button\nWait 2 seconds`;
    const steps = parseInstructionsText(text);
    expect(steps).toHaveLength(3);
    expect(steps[0].stepNumber).toBe(1);
    expect(steps[1].stepNumber).toBe(2);
    expect(steps[2].stepNumber).toBe(3);
  });

  it('handles mixed numbered and unnumbered lines', () => {
    const text = `1. Go to https://example.com\nDo something\n3. Third step`;
    const steps = parseInstructionsText(text);
    expect(steps).toHaveLength(3);
    expect(steps[0].stepNumber).toBe(1);
    // Auto-numbered after step 1 gets number 2
    expect(steps[1].stepNumber).toBe(2);
    expect(steps[2].stepNumber).toBe(3);
  });

  it('sorts steps by step number', () => {
    const text = `3. Third\n1. First\n2. Second`;
    const steps = parseInstructionsText(text);
    expect(steps[0].stepNumber).toBe(1);
    expect(steps[1].stepNumber).toBe(2);
    expect(steps[2].stepNumber).toBe(3);
  });

  it('throws on empty input', () => {
    expect(() => parseInstructionsText('')).toThrow('No instructions found');
  });

  it('throws on all-comment input', () => {
    expect(() => parseInstructionsText('# only a comment\n# another comment')).toThrow('No instructions found');
  });

  it('handles Windows-style CRLF line endings', () => {
    const text = `1. First step\r\n2. Second step\r\n3. Third step`;
    const steps = parseInstructionsText(text);
    expect(steps).toHaveLength(3);
  });

  it('trims whitespace from instructions', () => {
    const text = `1.   Go to https://example.com   `;
    const steps = parseInstructionsText(text);
    expect(steps[0].instruction).toBe('Go to https://example.com');
  });

  it('handles large step numbers', () => {
    const text = `10. Tenth step\n20. Twentieth step`;
    const steps = parseInstructionsText(text);
    expect(steps).toHaveLength(2);
    expect(steps[0].stepNumber).toBe(10);
    expect(steps[1].stepNumber).toBe(20);
  });
});
