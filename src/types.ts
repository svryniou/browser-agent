// ─── Instruction Parsing ────────────────────────────────────────────────────

export interface ParsedStep {
  stepNumber: number;
  instruction: string;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface Config {
  instructionsFile: string;
  outputDir: string;
  headed: boolean;
  slowMo: number;
  timeout: number;
  resolution: { width: number; height: number };
  record: boolean;
  verbose: boolean;
  stepPause: number;
  startStep: number;
  stopOnError: boolean;
  userAgent: string | undefined;
  locale: string;
  command: 'run' | 'validate' | 'list-actions';
}

// ─── Page Context ────────────────────────────────────────────────────────────

export interface ElementInfo {
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
}

export interface PageContext {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  elements: ElementInfo[];
  textSnapshot: string;
}

// ─── AI Actions ──────────────────────────────────────────────────────────────

export type Action =
  | { action: 'goto'; url: string }
  | { action: 'click'; selector: string; description?: string }
  | { action: 'fill'; selector: string; value: string; description?: string }
  | { action: 'type'; selector: string; value: string; description?: string }
  | { action: 'press'; key: string }
  | { action: 'scroll'; direction: 'down' | 'up'; pixels: number }
  | { action: 'wait'; seconds: number }
  | { action: 'waitForSelector'; selector: string; state: 'visible' | 'hidden' | 'attached' | 'detached' }
  | { action: 'hover'; selector: string; description?: string }
  | { action: 'select'; selector: string; value: string; description?: string }
  | { action: 'screenshot'; name: string }
  | { action: 'goBack' }
  | { action: 'goForward' }
  | { action: 'reload' }
  | { action: 'waitForNavigation' }
  | { action: 'evaluate'; expression: string }
  | { action: 'unknown'; reason: string };

export interface AIResponse {
  actions: Action[];
  rawResponse: string;
}

// ─── Token Usage ─────────────────────────────────────────────────────────────

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SessionTokenUsage {
  perStep: TokenUsage[];
  total: TokenUsage;
}

// ─── Step Results ────────────────────────────────────────────────────────────

export interface ActionResult {
  action: Action;
  success: boolean;
  durationMs: number;
  error?: string;
  screenshotPath?: string;
}

export interface StepResult {
  stepNumber: number;
  instruction: string;
  actions: ActionResult[];
  success: boolean;
  retries: number;
  tokenUsage: TokenUsage;
  durationMs: number;
}

// ─── Session Results ─────────────────────────────────────────────────────────

export interface SessionResult {
  steps: StepResult[];
  videoPath: string | null;
  videoSizeBytes: number | null;
  screenshotCount: number;
  tokenUsage: SessionTokenUsage;
  durationMs: number;
  succeededSteps: number;
  failedSteps: number;
}

// ─── Step History (for rolling context) ─────────────────────────────────────

export interface StepSummary {
  stepNumber: number;
  instruction: string;
  actionsSummary: string;
  success: boolean;
}
