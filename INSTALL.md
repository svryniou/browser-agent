# Installation Guide

## Prerequisites

- **Node.js** >= 18.0.0 — [nodejs.org/en/download](https://nodejs.org/en/download)
- **npm** >= 8 (included with Node.js)
- An **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)

Verify your Node version:
```bash
node --version   # Should print v18.x.x or higher
npm --version    # Should print 8.x.x or higher
```

---

## Step-by-Step Installation from Source

**1. Clone or download the repository**
```bash
git clone https://github.com/yourname/browser-agent.git
cd browser-agent
```

Or download and extract a zip archive, then `cd` into the directory.

**2. Install Node dependencies**
```bash
npm install
```

This installs all production and development dependencies including Playwright, the Anthropic SDK, Commander.js, and Chalk.

**3. Install Playwright browsers**

Playwright ships without browser binaries — download them separately:
```bash
npx playwright install chromium
```

To also install Firefox and WebKit (optional):
```bash
npx playwright install
```

**4. Set up your Anthropic API key**

```bash
cp .env.example .env
```

Open `.env` in your editor and replace the placeholder:
```
ANTHROPIC_API_KEY=sk-ant-your-real-key-here
```

Or set it as an environment variable in your shell profile (`.bashrc`, `.zshrc`, etc.):
```bash
export ANTHROPIC_API_KEY=sk-ant-your-real-key-here
```

**5. Build the TypeScript project**
```bash
npm run build
```

This compiles `src/` into `dist/`.

**6. Verify the installation**
```bash
node dist/index.js --version
# Should print: 1.0.0

node dist/index.js list-actions
# Should print all supported action types
```

**7. Run a test session**
```bash
node dist/index.js run sample-instructions/hackernews.txt --headed
```

You should see the browser open and navigate through Hacker News, then find a `.webm` video in `./output/`.

---

## Platform-Specific Notes

### macOS

Playwright works out of the box on macOS. If you run into security warnings about Chromium:

```bash
xattr -d com.apple.quarantine "$(npx playwright install --dry-run chromium 2>&1 | grep -o '/.*chromium.*')" 2>/dev/null || true
```

Or: System Preferences → Security & Privacy → allow the app.

### Linux

For headful mode, you need a display. On desktop Linux this works automatically.

**Required system libraries** (Ubuntu/Debian):
```bash
sudo apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
```

Or use Playwright's helper:
```bash
sudo npx playwright install-deps chromium
```

### Linux (headless servers without display)

Use `xvfb-run` for headed mode on servers:
```bash
sudo apt-get install xvfb
xvfb-run node dist/index.js run instructions.txt --headed
```

For fully headless mode (no `--headed` flag), no Xvfb is needed.

### Windows (native)

Run commands in PowerShell or Command Prompt. The tool works on Windows natively. If you use Git Bash and encounter issues with paths, use PowerShell instead.

### Windows (WSL)

Install Node.js inside your WSL distribution:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

For headed browser mode in WSL2, install a VcXsrv or use WSLg (available in Windows 11). For headless mode, no display server is needed.

---

## Running in Docker

Create a `Dockerfile` in the project root:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.50.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Set your API key at runtime: docker run -e ANTHROPIC_API_KEY=... ...
ENV ANTHROPIC_API_KEY=""

ENTRYPOINT ["node", "dist/index.js"]
```

Build and run:
```bash
docker build -t browser-agent .

docker run --rm \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v "$(pwd)/output:/app/output" \
  -v "$(pwd)/my-instructions.txt:/app/instructions.txt" \
  browser-agent run /app/instructions.txt --output /app/output
```

The `mcr.microsoft.com/playwright` image includes all required browser dependencies and Chromium.

---

## Troubleshooting Installation

### Playwright browser download fails

**Check connectivity:**
```bash
curl -I https://playwright.azureedge.net
```

**Behind a proxy:** Set the proxy for npm:
```bash
npm config set https-proxy http://proxy.company.com:8080
```

**Manual download:** Playwright stores browsers in `~/.cache/ms-playwright/`. If the download is slow, you can retry:
```bash
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
```

### Permission errors during `npm install`

Never use `sudo npm install`. Instead, fix npm's global directory:
```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
```

Or use a Node version manager like [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) which installs Node in your home directory without permission issues.

### API key not working

- Verify the key starts with `sk-ant-`
- Check that you have API credits at [console.anthropic.com](https://console.anthropic.com)
- Make sure there are no trailing spaces in your `.env` file
- If you exported the variable in your shell, restart your terminal or run `source ~/.bashrc`

### `tsc: command not found` during build

TypeScript is installed locally (not globally). Use:
```bash
npx tsc
# or
npm run build  # uses the local tsc via package.json scripts
```

### Headless mode on servers — no video output

If the video file is 0 bytes or missing:
- Verify you're not passing `--no-record`
- Check that the output directory is writable: `ls -la output/`
- Check that there's enough disk space: `df -h`
- On Linux without a GPU, some video encoding may fail silently — try running with `--headed` and Xvfb to confirm the rest works

### `Error: Cannot find module` after build

Run `npm run build` again. If it still fails, check that `tsconfig.json` has `"outDir": "./dist"` and `"rootDir": "./src"`.

---

## Uninstallation

```bash
# Remove Playwright browser binaries
npx playwright uninstall chromium

# Remove the project
cd ..
rm -rf browser-agent

# Remove the npm global cache entry (optional)
npm cache clean --force
```
