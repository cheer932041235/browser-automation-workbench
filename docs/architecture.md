# Architecture

Browser Automation Workbench uses a layered local-first architecture tailored for both managed cross-project sessions and direct daily-browser automation.

```text
User / Codex / Project CLI
   │
   ├── Managed Workbench (:3460 + stdio MCP)
   │      ├── SessionManager (runtime/sessions.json, project-local profiles & idle sleep)
   │      ├── WorkflowRunner & TaskManager (runtime/tasks/*.json, resumable steps)
   │      ├── Compact Management UI (packages/browser-engine/web)
   │      └── Backends:
   │            ├── Desktop Shell (packages/browser-desktop: Electron WebContentsView)
   │            ├── Managed Native Chrome/Edge (isolated local profile)
   │            └── Scoped Attached Daily Chrome/Edge
   │
   └── Browser Intelligence (:3456 Engine + CLI)
          ├── Browser Intelligence CLI (record → review → extract / API discovery)
          └── Browser Engine HTTP API & CLI (be.mjs, :3456)
                 └── Direct DevToolsActivePort → Daily Edge / Chrome
```

## Layer 1: Desktop Shell (`packages/browser-desktop`)

The standalone Electron `WebContentsView` shell (`我的浏览器`) provides isolated, window-controlled Chromium views without touching the user's daily Edge/Chrome profiles:

- Hidden-by-default execution with `show_human` / `resume_background` transitions
- Native window framing, tab strip, URL bar, navigation buttons, and right-aligned "return to background" action
- Active-tab unthrottled / inactive-tab background throttling (`setBackgroundThrottling`)
- Synchronized tab cleanup on external CDP closes, `will-prevent-unload` guard, 12s bounded `loadURL`, and hidden-view offscreen capture (`/capture`) for `browser_page_screenshot` and `browser_page_check`
- Remote pages remain sandboxed with `contextIsolation: true` and receive zero Node/workbench bridges

## Layer 2: Browser Engine & Managed Workbench (`packages/browser-engine`)

Browser Engine runs both the direct daily-browser CDP execution server (`:3456`) and the managed session workbench (`:3460` + stdio MCP):

### Direct CDP Execution Server (`server.mjs`, `:3456`)

- Discovers and attaches to the user's daily Edge/Chrome via `DevToolsActivePort` (`npm run engine:check` / `POST /reconnect`)
- Manages tabs, frames, Shadow DOM, UI interactions, waiting primitives, dialog auto-handling, accessibility snapshots, and scripted pipelines
- Isolates console logging, network observation, navigation tracking, and wait listeners by `targetId` (non-destructive `offTarget` teardown)
- Extracts page text, structured elements, forms (redacting password/OTP fields), links, tables, screenshots (`work/screenshots/`), and PDFs
- Includes `DemoRecorder` (`demo-recorder.mjs`) for screencast + FFmpeg viewport recordings

### Managed Workbench (`workbench.mjs`, `:3460` & `workbench-client.mjs --mcp`)

- Owns `SessionManager` (`runtime/sessions.json`, per-session `idleTimeoutMinutes` hibernation, real-time `includeMetrics` tab count & RSS memory sampling, dead-PID reconciliation)
- Owns `WorkflowRunner` + `TaskManager` (`runtime/tasks/*.json`) with pre-step ownership verification, postcondition checks (`check`), sensitive fill redaction (`sensitive: true` + runtime `values`), explicit `browser_task_rebind`, and local SSE completion events (`GET /events`)
- Exposes high-level inspection tools (`browser_page_check` at `1440px`/`390px` viewports, `browser_page_screenshot`, `browser_frames`, `browser_frame_read`, `browser_downloads`)

Non-responsibilities of Layer 2:

- Does not decide business relevance of page content
- Does not bypass CAPTCHA, account security, or anti-bot controls

## Layer 3: Browser Intelligence (`packages/browser-intelligence`)

Browser Intelligence uses `:3456` Browser Engine as the execution backend and turns manual browsing sessions into durable analysis artifacts:

- Capture page text, DOM hints, screenshots, navigation history, and network metadata (`record`)
- Classify requests, locate stable selectors, identify API candidates, and recommend API-first / UI-first / hybrid automation strategies (`review`)
- Extract structured post/content datasets from traces (`extract`)

Non-responsibilities of Layer 3:

- Not an unattended high-frequency crawler
- Does not own low-level CDP session or desktop shell management

## Data Flow & Storage Layout

### Intelligence Trace Flow

```text
record start → open/attach tab → network monitor + nav tracker + autoshot
  → user browses & marks steps → record stop (automatically disables monitors)
  → review (reads trace.jsonl + pages.json + network.json → review.md)
  → secondary development (API adapter / site profile / pipeline) or extract (posts.json + extract.md)
```

### Runtime & Artifact Directories (All Git-Ignored)

```text
runtime/                        # Persistent managed workbench state (local)
├── desktop-runtime/            # Unpacked official Electron runtime
├── sessions.json               # Session registry
├── profiles/<sessionId>/       # Isolated browser profile & site storage
├── downloads/<sessionId>/      # Session download directory
├── temp/<sessionId>/           # Launch/temp data
├── tasks/<taskId>.json         # Resumable workflow task records
└── logs/workbench.log          # Managed workbench service log

work/                           # Ephemeral scratch, previews & default screenshots (clean after task)
outputs/                        # Formal acceptance reports & result JSONs
logs/browser-intelligence/      # Recorded traces (trace.jsonl, network.json, review.md, extract.md)
```

## Design Principle

- **Pick the right channel**: Use `:3460` + `engine=desktop` for isolated multi-project workflows and MCP tools; use `:3456` + `bi` for direct daily-browser exploration and API discovery.
- **Promote patterns incrementally**: Record and inspect real sessions first; promote repeated workflows into site profiles, pipelines, extractors, or backend API adapters only after stability is verified.
- **Keep project roots clean**: Persistent profiles live in `runtime/`, acceptance records in `outputs/`, and transient screenshots/previews in `work/` so nothing leaks into source directories or Git.
