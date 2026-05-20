# Getting Started

## Requirements

- Windows / macOS / Linux
- Node.js 22+
- Microsoft Edge or Google Chrome
- Browser remote debugging enabled

No npm dependencies are required for the current implementation.

## Enable Browser Remote Debugging

For Edge:

```text
edge://inspect/#remote-debugging
```

For Chrome:

```text
chrome://inspect/#remote-debugging
```

Enable:

```text
Allow remote debugging for this browser instance
```

Restarting the browser may be required.

## Start Browser Engine

From repository root:

```bash
npm run engine:start
```

If Browser Engine is already running, the starter prints the existing status.

Expected output:

```text
Browser Engine 启动成功
API: http://localhost:3456
浏览器: 已连接
```

## Check the Workbench

```bash
npm run bi -- health
npm run bi -- paths
npm run bi -- docs
```

## Use Browser Engine Directly

Create a tab:

```bash
npm run engine:cli -- new https://example.com
```

List tabs:

```bash
npm run engine:cli -- tabs
```

Get page text:

```bash
npm run engine:cli -- text <targetId>
```

Take a screenshot:

```bash
npm run engine:cli -- shot <targetId> screenshots/example.png
```

## Record a Browsing Session

Start recording with a new tab:

```bash
npm run bi -- record start demo-example --url https://example.com
```

Add notes during browsing:

```bash
npm run bi -- record mark "Loaded landing page"
npm run bi -- record mark "Clicked pricing link"
```

Stop recording:

```bash
npm run bi -- record stop
```

The trace is written to:

```text
logs/browser-intelligence/traces/demo-example/
```

## Review a Trace

```bash
npm run bi -- review demo-example
```

This generates:

```text
review.md
```

The review report summarizes:

- Timeline
- Navigation history
- Network requests
- API candidates
- Selectors and interaction clues
- Recommended automation strategy

At this point, the recorded browser flow becomes a development artifact. If the review finds stable API candidates, the next step is usually not to replay the same clicks forever, but to validate the backend interface and wrap it in secondary development.

Typical follow-up:

- Inspect `review.md` and `network.json`.
- Confirm request method, parameters, headers, and response schema.
- Decide whether the final implementation should be API-first, UI-first, or hybrid.
- Build a backend adapter, CLI script, extractor, site profile, or Browser Engine pipeline.

See [UI Recording to API Discovery](api-discovery.md).

## Extract Structured Content

```bash
npm run bi -- extract demo-example
```

This generates:

```text
posts.json
extract.md
```

For supported platforms, the extractor creates structured content fields. For unsupported pages, it falls back to generic text and URL extraction.

## Run Checks

```bash
npm run check
npm test
```

Current expected test status:

```text
Browser Intelligence: 76 pass / 0 fail
```
