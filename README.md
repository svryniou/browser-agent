# browser-agent

Automate browser sessions from plain-English instructions and record them as video.

Write what you want the browser to do in a `.txt` file. The agent sends each instruction to Claude, which interprets it in the context of the live page and returns precise Playwright actions. The entire session is recorded as a `.webm` video.

---

## How It Works

```
instructions.txt
      │
      ▼
┌─────────────┐       ┌──────────────────────────────────────────┐
│   parser    │ ────► │                 executor                  │
│ (parser.ts) │       │              (executor.ts)                │
└─────────────┘       │                                          │
                       │  for each step:                          │
                       │  ┌──────────────────────────────────┐   │
                       │  │  context.ts                      │   │
                       │  │  DOM traversal → PageContext      │   │
                       │  └───────────────┬──────────────────┘   │
                       │                  ▼                       │
                       │  ┌──────────────────────────────────┐   │
                       │  │  ai.ts                           │   │
                       │  │  PageContext + instruction        │   │
                       │  │  ────────────► Claude API         │   │
                       │  │  ◄──────────── JSON actions       │   │
                       │  └───────────────┬──────────────────┘   │
                       │                  ▼                       │
                       │  ┌──────────────────────────────────┐   │
                       │  │  finder.ts                       │   │
                       │  │  CSS → role → text → placeholder │   │
                       │  │  → label (fallback cascade)       │   │
                       │  └───────────────┬──────────────────┘   │
                       │                  ▼                       │
                       │  ┌──────────────────────────────────┐   │
                       │  │  Playwright browser              │   │
                       │  │  click / fill / scroll / goto…   │   │
                       │  └──────────────────────────────────┘   │
                       └──────────────────────────────────────────┘
                                          │
                                          ▼
                              ┌───────────────────┐
                              │    recorder.ts     │
                              │  session-*.webm    │
                              └───────────────────┘
```

---

## Quick Start

**1. Install dependencies**
```bash
npm install
```

**2. Install Playwright browsers**
```bash
npx playwright install chromium
```

**3. Set your Anthropic API key**
```bash
cp .env.example .env
# Edit .env and add: ANTHROPIC_API_KEY=sk-ant-...
```

**4. Build the project**
```bash
npm run build
```

**5. Run your first session**
```bash
node dist/index.js run sample-instructions/hackernews.txt --headed
```

---

## CLI Reference

### `run <file>` — Execute instructions

```
node dist/index.js run <instructions.txt> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <dir>` | `./output` | Output directory for recordings and screenshots |
| `--headed` | headless | Show the browser window |
| `--slow-mo <ms>` | `0` | Slow down each action |
| `--timeout <ms>` | `10000` | Element-finding timeout per action |
| `--resolution <WxH>` | `1280x720` | Viewport and recording resolution |
| `--no-record` | — | Disable video recording |
| `-v, --verbose` | — | Log full AI request/response payloads |
| `--step-pause <ms>` | `500` | Pause between steps |
| `--start-step <n>` | `1` | Skip steps before N |
| `--stop-on-error` | — | Halt on first failed step |
| `--user-agent <string>` | default | Custom user agent |
| `--locale <string>` | `en-US` | Browser locale |

### `validate <file>` — Preview planned actions

Parses the instructions, launches a browser for page context, and asks Claude what it would do — without actually doing it.

```
node dist/index.js validate sample-instructions/google-search.txt
```

### `list-actions` — Print all action types

```
node dist/index.js list-actions
```

---

## Writing Good Instructions

### Be specific about elements

```
# Vague — may match multiple elements
Click the link

# Better
Click on the "Sign in" link in the top-right corner

# Best
Click the "Sign in" button in the navigation bar
```

### Add wait steps for dynamic content

```
1. Click the "Load more" button
2. Wait 2 seconds for the content to appear
3. Scroll down to see the new items
```

### Reference elements by visible text

Claude sees all visible element text. Using the exact label or button text works reliably:

```
Click the "Add to cart" button
Type "San Francisco" into the city field
Select "United States" from the country dropdown
```

### Use ordinals to disambiguate

```
Click on the first result
Click the third article in the list
```

### Separate compound actions

```
# Let the agent handle multi-step flows in one instruction:
Search for "climate change" in the search box

# Or break them apart for reliability:
1. Click on the search box
2. Type "climate change"
3. Press Enter
```

### Example: Google search

```
1. Go to https://www.google.com
2. Type "playwright browser automation" in the search box
3. Press Enter
4. Wait 2 seconds for results
5. Scroll down to see more results
6. Click the first result
```

### Example: Form filling

```
1. Go to https://example.com/contact
2. Type "Alice" in the first name field
3. Type "Smith" in the last name field
4. Type "alice@example.com" in the email field
5. Type "Hello, I have a question" in the message field
6. Click the Submit button
7. Wait 3 seconds for confirmation
```

---

## How AI Interpretation Works

For each instruction step:

1. **Page context is gathered** — `context.ts` traverses the DOM and extracts all interactive elements (tag, text, role, aria-label, placeholder, selector, bounding box) plus a 2000-character text snapshot of visible content.

2. **Claude receives the context** — The current URL, title, viewport, element list, page text, and the last 3 step summaries (rolling history) are included so Claude understands the flow.

3. **Claude returns JSON actions** — One or more actions from the supported set (goto, click, fill, type, press, scroll, wait, etc.).

4. **Actions are executed** — `finder.ts` resolves each target element with a 5-strategy fallback cascade (CSS → role → text → placeholder → label).

5. **Retry on failure** — If an action fails, a screenshot is taken, fresh page context is gathered, and Claude is asked again with the error message. Up to 2 retries per step.

---

## Configuration

### Environment variables (`.env`)

```
ANTHROPIC_API_KEY=sk-ant-...

# Optional defaults (CLI flags override these):
BROWSER_AGENT_OUTPUT=./output
BROWSER_AGENT_RESOLUTION=1280x720
BROWSER_AGENT_TIMEOUT=10000
BROWSER_AGENT_SLOW_MO=0
BROWSER_AGENT_STEP_PAUSE=500
```

### Combining env and CLI

CLI flags always take priority over environment variables, which take priority over built-in defaults.

---

## Troubleshooting

### `ANTHROPIC_API_KEY is not set`
Copy `.env.example` to `.env` and add your key. Or set it in your shell:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Element not found after retries
- Add a `Wait 2 seconds` step before the action to let dynamic content load.
- Use `--headed` to watch the browser and see what's happening.
- Use `--verbose` to see what Claude is trying to click.
- Be more specific in your instruction: describe the element's visible text.

### Video file is empty or missing
- Make sure you don't use `--no-record`.
- On headless Linux, install Xvfb: `apt-get install xvfb` and run with `xvfb-run`.
- Check that the output directory is writable.

### Claude returns invalid JSON
This is rare. The agent will retry once automatically. If it keeps happening, use `--verbose` to inspect the raw response.

### Browser fails to launch
Run `npx playwright install chromium` to download the browser binary.

### Timeout errors on slow pages
Increase the timeout: `--timeout 30000` (30 seconds).

---

## Limitations and Known Issues

- **Dynamic SPAs**: Pages that load content asynchronously may need explicit `Wait N seconds` steps.
- **CAPTCHAs**: Not handled — automation will likely fail on CAPTCHA-protected pages.
- **File uploads**: Not supported in this version.
- **Multiple tabs**: The agent operates in a single tab. Opening new tabs is not supported.
- **Authentication**: There's no session persistence between runs. Use `goto` to navigate to a login page and fill credentials as part of your instructions.
- **iframe content**: Elements inside cross-origin iframes are not accessible to the DOM traversal.
- **Video quality**: `.webm` output quality depends on Playwright's built-in recorder. Resolution can be configured with `--resolution`.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and add tests
4. Run tests: `npm test`
5. Run type-check: `npm run lint`
6. Submit a pull request

---

## License

MIT
