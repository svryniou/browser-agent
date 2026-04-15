import * as fs from 'fs';
import * as path from 'path';
import { Browser, BrowserContext } from 'playwright';
import { logger } from './logger';
import { CURSOR_INIT_SCRIPT } from './cursor';

export interface RecorderContext {
  context: BrowserContext;
  tempDir: string;
}

/**
 * Creates a browser context with video recording enabled.
 * Returns both the context and the temp directory where the video will be written.
 */
export async function createRecordingContext(
  browser: Browser,
  options: {
    width: number;
    height: number;
    tempDir: string;
    slowMo?: number;
    userAgent?: string;
    locale?: string;
  }
): Promise<RecorderContext> {
  fs.mkdirSync(options.tempDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    recordVideo: {
      dir: options.tempDir,
      size: { width: options.width, height: options.height },
    },
    userAgent: options.userAgent,
    locale: options.locale ?? 'en-US',
  });

  // Inject the cursor overlay into every page (including after navigations)
  await context.addInitScript(CURSOR_INIT_SCRIPT);

  return { context, tempDir: options.tempDir };
}

/**
 * Creates a browser context WITHOUT video recording.
 */
export async function createContext(
  browser: Browser,
  options: {
    width: number;
    height: number;
    userAgent?: string;
    locale?: string;
  }
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    userAgent: options.userAgent,
    locale: options.locale ?? 'en-US',
  });
  await context.addInitScript(CURSOR_INIT_SCRIPT);
  return context;
}

/**
 * After the context is closed, find the recorded .webm file in tempDir
 * and move it to outputDir with the canonical filename.
 *
 * Playwright writes the video file only after context.close() completes.
 */
export async function finalizeRecording(
  tempDir: string,
  outputDir: string
): Promise<{ videoPath: string; sizeBytes: number } | null> {
  fs.mkdirSync(outputDir, { recursive: true });

  // Give Playwright a moment to flush the file
  await new Promise(r => setTimeout(r, 500));

  const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.webm'));
  if (files.length === 0) {
    logger.warn('No .webm file found in temp recording directory');
    return null;
  }

  // Take the most recently modified webm (there should only be one)
  const webmFile = files
    .map(f => ({ name: f, mtime: fs.statSync(path.join(tempDir, f)).mtime }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0].name;

  const srcPath = path.join(tempDir, webmFile);
  const destFilename = `session-${formatDate(new Date())}.webm`;
  const destPath = path.join(outputDir, destFilename);

  fs.copyFileSync(srcPath, destPath);
  fs.unlinkSync(srcPath);

  // Clean up temp dir if empty
  try {
    fs.rmdirSync(tempDir);
  } catch {
    // Ignore if not empty (e.g., there were other files)
  }

  const { size } = fs.statSync(destPath);
  return { videoPath: path.resolve(destPath), sizeBytes: size };
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
