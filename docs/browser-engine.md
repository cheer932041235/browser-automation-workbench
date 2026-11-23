# Browser Engine

`packages/browser-engine` houses both the local CDP execution layer (`:3456`) and the Managed Workbench runtime (`:3460` + stdio MCP).

## Two Entry Modes

| Mode | Port | Primary Scripts | Use Case |
| --- | --- | --- | --- |
| **Managed Workbench + MCP** | `:3460` | `workbench.mjs`, `workbench-client.mjs`, `sessions.mjs`, `workflows.mjs` | Cross-project isolated sessions (`desktop`/`native`), scoped `attached` reuse, resumable tasks, human login handoff, `browser_page_check` / `browser_page_screenshot` |
| **Direct Daily-Browser Engine** | `:3456` | `start.mjs`, `server.mjs`, `be.mjs` | Direct Edge/Chrome CDP attachment (`DevToolsActivePort`), CLI/REST primitives, Browser Intelligence (`bi.mjs`), and `DemoRecorder` screencasts |

For full Managed Workbench & Desktop Shell usage, see [managed-workbench.md](managed-workbench.md) and [desktop-shell.md](desktop-shell.md). Below focuses on the `:3456` execution engine and core module map.

## Start (`:3456` Direct Engine)

```powershell
# Preflight Edge DevToolsActivePort & :3456 status without opening extra debugger sessions
npm run engine:check

# Start or reuse the background daemon (add -- --foreground to stay attached to terminal)
npm run engine:start -- --browser edge

# Refresh a dropped CDP WebSocket using the current DevToolsActivePort
npm run engine:cli -- reconnect

# CLI help & direct commands
npm run engine:cli -- help
```

Direct server start:

```bash
node packages/browser-engine/server.mjs --browser-port 59888
```

## Main Files

```text
packages/browser-engine/
├── workbench.mjs            :3460 HTTP/SSE server + stdio MCP handler + workbench page check/screenshot
├── workbench-client.mjs     stdio MCP bridge & CLI caller for :3460
├── sessions.mjs             session registry, idle auto-hibernation, metric sampling, PID reconciliation
├── workflows.mjs            resumable step runner, postcondition checks & sensitive fill redaction
├── browsers.mjs             DevToolsActivePort discovery, inspectBrowserEndpoint & managed browser launcher
├── desktop-control.mjs      HTTP control client for packages/browser-desktop WebContentsView shell
├── managed-appearance.mjs   managed Chrome profile name, green theme & disabled browser sign-in/sync
├── web/                     :3460 compact workbench frontend (HTML/CSS/JS)
│
├── start.mjs                dependency check, preflight & background daemon launcher for :3456
├── server.mjs               :3456 HTTP API router (+ autoReconnect & POST /reconnect)
├── be.mjs                   CLI shortcut client (preflight/reconnect/tabs/interact/page/network)
├── core.mjs                 CDP WebSocket connection & per-target event subscription (onTarget/offTarget)
├── tabs.mjs                 tab lifecycle management & event-driven load waiter
├── interact.mjs             click/type/fill/scroll/upload/drag (+ hidden desktop guard & sensitive redaction)
├── page.mjs                 text/elements/forms/links/table/screenshot/pdf (+ per-tab console capture)
├── network.mjs              request monitor/response/cookies/storage/downloads (anchored to runtime/)
├── frames.mjs               cross-process iframe enumeration & execution
├── stealth.mjs              lightweight automation-fingerprint helpers
├── wait.mjs                 target-isolated load/network/element/text/navigation/stable waiters
├── detect.mjs               page obstacle detection (login/CAPTCHA/modal) & smart open
├── dialog.mjs               target-scoped dialog auto-handling (prevents cross-tab teardown collisions)
├── accessibility.mjs        accessibility snapshot and @ref resolution
├── autoshot.mjs             automatic action screenshot history (anchored to runtime/)
├── navigation.mjs           target-scoped navigation tracking
├── profiles.mjs             domain profile storage (anchored to runtime/)
├── tasks.mjs                persistent step store (anchored to runtime/)
├── batch.mjs                parallel tab operations
├── pipeline.mjs             in-page multi-step JS compilation (+ sensitive redaction)
└── demo-recorder.mjs        CDP screencast + FFmpeg constant-fps viewport video recorder
```

## `:3456` HTTP API Groups

### System & Reconnection

- `GET /health` (includes live connection state and `endpoint` preflight info)
- `GET /help`
- `POST /reconnect` (re-reads `DevToolsActivePort` and reconnects a dropped browser WebSocket)

### Tabs

- `GET /tabs`
- `GET|POST /tabs/new?url=`
- `GET|POST /tabs/open?url=`
- `GET /tabs/close?target=`
- `GET /tabs/closeAll`
- `GET /tabs/closeGroup?group=`
- `POST /tabs/navigate?target=`
- `GET /tabs/back?target=`
- `GET /tabs/forward?target=`
- `GET /tabs/reload?target=`
- `GET /tabs/info?target=`

### Interaction

- `POST /eval?target=`
- `POST /click?target=` · `POST /clickByText?target=` · `POST /clickAt?target=` · `POST /clickXY?target=`
- `POST /doubleClick?target=` · `POST /rightClick?target=` · `POST /hover?target=` · `POST /safeClick?target=`
- `POST /type?target=` · `POST /insertText?target=` · `POST /fill?target=` · `POST /fillForm?target=`
- `POST /pressKey?target=` · `POST /hotkey?target=` · `POST /scroll?target=` · `POST /select?target=`
- `POST /checkbox?target=` · `POST /upload?target=` · `POST /drag?target=` · `POST /actionability?target=`

*(Interactive form/fill helpers redact `password` / OTP values by default unless explicitly suppressed inside internal safe pipelines.)*

### Page Analysis

- `POST /page/elements?target=`
- `POST /page/text?target=`
- `POST /page/forms?target=`
- `POST /page/links?target=`
- `POST /page/table?target=`
- `POST /screenshot?target=` (default file path for `be.mjs shot`: `work/screenshots/`)
- `POST /pdf?target=`

### Network and Storage

- `GET /network/monitor?target=` · `GET /network/stop?target=`
- `POST /network/requests` (`?target=` supported)
- `GET /network/response?target=&requestId=`
- `POST /network/intercept?target=`
- `GET|POST|DELETE /cookies?target=` · `GET|POST|DELETE /storage?target=&type=`
- `POST /session/export?target=` · `POST /session/import?target=`
- `GET /downloads?target=&enable=1`

### Advanced Modules

- Frames: `/frames/*` · Shadow DOM: `/shadow/*` · Console: `/console/*` (per-target isolated)
- Dialog: `/dialog/*` · Accessibility: `/accessibility/*` · Autoshot: `/autoshot/*`
- Navigation: `/nav/*` · Wait: `/wait/*` · Detect: `/detect/*`
- Site Profiles: `/profiles/*` · Tasks: `/tasks/*` · Batch: `/batch/*` · Pipeline: `/pipeline`

## Choosing Direct Engine vs Managed Workbench

- Use **`:3460` Managed Workbench** when you want isolated per-project profiles on E drive, background desktop shell windows (`engine=desktop`), human login/resume transitions, resumable multi-step tasks, or MCP `browser_page_check` / `browser_page_screenshot`.
- Use **`:3456` Browser Engine** when operating directly on an already-logged-in daily browser tab, recording flows with Browser Intelligence (`record → review → extract`), or rendering viewport videos with `DemoRecorder`.
