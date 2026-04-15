import { Config } from './types';

export function parseResolution(resolution: string): { width: number; height: number } {
  const match = resolution.match(/^(\d+)[xX](\d+)$/);
  if (!match) {
    throw new Error(`Invalid resolution format: "${resolution}". Expected WxH (e.g. 1280x720)`);
  }
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
}

export function buildConfig(options: {
  instructionsFile: string;
  output?: string;
  headed?: boolean;
  slowMo?: string;
  timeout?: string;
  resolution?: string;
  record?: boolean;
  verbose?: boolean;
  stepPause?: string;
  startStep?: string;
  stopOnError?: boolean;
  userAgent?: string;
  locale?: string;
  command: 'run' | 'validate' | 'list-actions';
}): Config {
  const resolutionStr =
    options.resolution ||
    process.env.BROWSER_AGENT_RESOLUTION ||
    '1280x720';

  const resolution = parseResolution(resolutionStr);

  return {
    instructionsFile: options.instructionsFile,
    outputDir: options.output || process.env.BROWSER_AGENT_OUTPUT || './output',
    headed: options.headed ?? false,
    slowMo: parseInt(options.slowMo || process.env.BROWSER_AGENT_SLOW_MO || '0', 10),
    timeout: parseInt(options.timeout || process.env.BROWSER_AGENT_TIMEOUT || '5000', 10),
    resolution,
    record: options.record ?? true,
    verbose: options.verbose ?? false,
    stepPause: parseInt(options.stepPause || process.env.BROWSER_AGENT_STEP_PAUSE || '200', 10),
    startStep: parseInt(options.startStep || '1', 10),
    stopOnError: options.stopOnError ?? false,
    userAgent: options.userAgent,
    locale: options.locale || 'en-US',
    command: options.command,
  };
}
