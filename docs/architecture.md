# Architecture

Browser Automation Workbench uses a two-layer architecture.

```text
User / Agent
   │
   ├── Browser Intelligence CLI
   │      ├── record: capture a human browsing session
   │      ├── review: analyze traces and recommend automation strategy
   │      └── extract: extract structured content from traces
   │
   └── Browser Engine HTTP API
          ├── CDP connection
          ├── tab lifecycle
          ├── interaction primitives
          ├── page analysis
          ├── network observation
          └── task/session utilities

Real Edge / Chrome Browser
```

## Layer 1: Browser Engine

Browser Engine is the execution layer. It connects to the user's daily Edge/Chrome instance through Chrome DevTools Protocol (CDP). It exposes browser capabilities as a local HTTP API.

Responsibilities:

- Discover and connect to the browser debugging port
- Manage tabs and browser targets
- Execute JavaScript in pages and frames
- Perform UI interactions such as click, type, scroll, upload, drag, and shortcut keys
- Extract page text, links, forms, tables, screenshots, and PDF output
- Observe network requests and fetch response bodies
- Manage cookies, localStorage, sessionStorage, and downloads
- Persist task state for multi-step workflows

Non-responsibilities:

- It does not decide what content is important
- It does not own domain-specific extraction logic
- It does not bypass account security, CAPTCHA, or platform risk controls

## Layer 2: Browser Intelligence

Browser Intelligence is the workflow and analysis layer. It uses Browser Engine as the execution backend and turns browsing sessions into durable artifacts.

Responsibilities:

- Record a browsing task into trace files
- Capture page text, network metadata, screenshots, navigation history, and notes
- Review traces to identify API candidates, stable selectors, and automation strategy
- Extract structured content from saved traces
- Produce human-readable reports and machine-readable JSON

Non-responsibilities:

- It is not a general crawler
- It is not designed for unattended monitoring
- It does not own low-level CDP protocol implementation

## Data Flow

```text
record start
  → Browser Engine opens/attaches tab
  → network monitor + navigation tracker + autoshot enabled
  → user browses normally
  → record mark adds semantic notes
  → record stop captures final page state

review
  → reads trace.jsonl + pages.json + network.json
  → classifies requests
  → identifies API candidates and selectors
  → writes review.md

extract
  → reads pages.json + network.json
  → detects platform
  → parses text/network data
  → enriches posts/items
  → writes posts.json + extract.md
```

## Runtime Output

Runtime output is intentionally kept outside package source files:

```text
logs/browser-intelligence/traces/<taskId>/
├── trace.jsonl
├── notes.md
├── pages.json
├── network.json
├── summary.md
├── review.md
├── posts.json
├── extract.md
└── screenshots/
```

`logs/` is ignored by Git.

## Extension Points

Future browser automation features should usually fit into one of these extension points:

- **Engine endpoint**: add a new browser primitive or CDP capability
- **Site profile**: add reusable site-specific selectors and known patterns
- **Recorder event**: capture a new type of trace evidence
- **Reviewer analyzer**: add a new heuristic for API/selector/workflow analysis
- **Extractor parser**: add a new platform/content parser
- **Task template**: add reusable workflow instructions for a recurring use case

## Design Principle

Do not prematurely make every site a product feature. First record and analyze real browsing sessions. Promote repeated patterns into profiles, extractors, or engine endpoints only after they prove useful.
