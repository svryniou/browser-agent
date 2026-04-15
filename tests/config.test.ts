import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildConfig, parseResolution } from '../src/config';

describe('parseResolution', () => {
  it('parses WxH format', () => {
    expect(parseResolution('1280x720')).toEqual({ width: 1280, height: 720 });
    expect(parseResolution('1920x1080')).toEqual({ width: 1920, height: 1080 });
    expect(parseResolution('800x600')).toEqual({ width: 800, height: 600 });
  });

  it('parses case-insensitive separator', () => {
    expect(parseResolution('1280X720')).toEqual({ width: 1280, height: 720 });
  });

  it('throws on invalid format', () => {
    expect(() => parseResolution('1280-720')).toThrow('Invalid resolution format');
    expect(() => parseResolution('1280')).toThrow('Invalid resolution format');
    expect(() => parseResolution('abc')).toThrow('Invalid resolution format');
    expect(() => parseResolution('')).toThrow('Invalid resolution format');
  });
});

describe('buildConfig', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.BROWSER_AGENT_OUTPUT = process.env.BROWSER_AGENT_OUTPUT;
    savedEnv.BROWSER_AGENT_RESOLUTION = process.env.BROWSER_AGENT_RESOLUTION;
    savedEnv.BROWSER_AGENT_TIMEOUT = process.env.BROWSER_AGENT_TIMEOUT;
    savedEnv.BROWSER_AGENT_SLOW_MO = process.env.BROWSER_AGENT_SLOW_MO;
    savedEnv.BROWSER_AGENT_STEP_PAUSE = process.env.BROWSER_AGENT_STEP_PAUSE;

    delete process.env.BROWSER_AGENT_OUTPUT;
    delete process.env.BROWSER_AGENT_RESOLUTION;
    delete process.env.BROWSER_AGENT_TIMEOUT;
    delete process.env.BROWSER_AGENT_SLOW_MO;
    delete process.env.BROWSER_AGENT_STEP_PAUSE;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('uses default values when no options provided', () => {
    const config = buildConfig({
      instructionsFile: 'test.txt',
      command: 'run',
    });
    expect(config.outputDir).toBe('./output');
    expect(config.headed).toBe(false);
    expect(config.slowMo).toBe(0);
    expect(config.timeout).toBe(10000);
    expect(config.resolution).toEqual({ width: 1280, height: 720 });
    expect(config.record).toBe(true);
    expect(config.verbose).toBe(false);
    expect(config.stepPause).toBe(500);
    expect(config.startStep).toBe(1);
    expect(config.stopOnError).toBe(false);
    expect(config.locale).toBe('en-US');
  });

  it('overrides defaults with provided options', () => {
    const config = buildConfig({
      instructionsFile: 'test.txt',
      output: '/tmp/output',
      headed: true,
      slowMo: '200',
      timeout: '5000',
      resolution: '1920x1080',
      record: false,
      verbose: true,
      stepPause: '1000',
      startStep: '3',
      stopOnError: true,
      userAgent: 'MyAgent/1.0',
      locale: 'fr-FR',
      command: 'run',
    });

    expect(config.outputDir).toBe('/tmp/output');
    expect(config.headed).toBe(true);
    expect(config.slowMo).toBe(200);
    expect(config.timeout).toBe(5000);
    expect(config.resolution).toEqual({ width: 1920, height: 1080 });
    expect(config.record).toBe(false);
    expect(config.verbose).toBe(true);
    expect(config.stepPause).toBe(1000);
    expect(config.startStep).toBe(3);
    expect(config.stopOnError).toBe(true);
    expect(config.userAgent).toBe('MyAgent/1.0');
    expect(config.locale).toBe('fr-FR');
  });

  it('reads defaults from environment variables', () => {
    process.env.BROWSER_AGENT_OUTPUT = '/env/output';
    process.env.BROWSER_AGENT_RESOLUTION = '800x600';
    process.env.BROWSER_AGENT_TIMEOUT = '3000';
    process.env.BROWSER_AGENT_SLOW_MO = '100';
    process.env.BROWSER_AGENT_STEP_PAUSE = '750';

    const config = buildConfig({
      instructionsFile: 'test.txt',
      command: 'run',
    });

    expect(config.outputDir).toBe('/env/output');
    expect(config.resolution).toEqual({ width: 800, height: 600 });
    expect(config.timeout).toBe(3000);
    expect(config.slowMo).toBe(100);
    expect(config.stepPause).toBe(750);
  });

  it('CLI options take priority over environment variables', () => {
    process.env.BROWSER_AGENT_RESOLUTION = '800x600';

    const config = buildConfig({
      instructionsFile: 'test.txt',
      resolution: '1920x1080',
      command: 'run',
    });

    expect(config.resolution).toEqual({ width: 1920, height: 1080 });
  });

  it('stores instructionsFile and command', () => {
    const config = buildConfig({
      instructionsFile: '/path/to/instructions.txt',
      command: 'validate',
    });
    expect(config.instructionsFile).toBe('/path/to/instructions.txt');
    expect(config.command).toBe('validate');
  });
});
