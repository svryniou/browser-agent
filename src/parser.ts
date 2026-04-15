import * as fs from 'fs';
import * as path from 'path';
import { ParsedStep } from './types';

/**
 * Read and parse a .txt instructions file.
 *
 * Format:
 *   - Lines starting with # are comments and ignored
 *   - Blank lines are ignored
 *   - Steps are either "N. instruction" or "N) instruction" or just plain text
 *   - If no numbering is present, steps are auto-numbered in order
 */
export function parseInstructionsFile(filePath: string): ParsedStep[] {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Instructions file not found: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  return parseInstructionsText(content);
}

export function parseInstructionsText(content: string): ParsedStep[] {
  const lines = content.split(/\r?\n/);
  const steps: ParsedStep[] = [];
  let autoNumber = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip blank lines and comments
    if (!line || line.startsWith('#')) continue;

    // Match "N. instruction" or "N) instruction" or "N: instruction"
    const numbered = line.match(/^(\d+)[.):\s]\s*(.+)$/);
    if (numbered) {
      const stepNumber = parseInt(numbered[1], 10);
      const instruction = numbered[2].trim();
      if (instruction) {
        steps.push({ stepNumber, instruction });
        autoNumber = stepNumber + 1;
      }
    } else {
      // Plain line — auto-number it
      steps.push({ stepNumber: autoNumber++, instruction: line });
    }
  }

  if (steps.length === 0) {
    throw new Error('No instructions found in file. Make sure the file has at least one non-comment line.');
  }

  // Sort by step number to handle out-of-order files
  steps.sort((a, b) => a.stepNumber - b.stepNumber);

  return steps;
}
