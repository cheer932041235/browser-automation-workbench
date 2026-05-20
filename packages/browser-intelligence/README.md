# Browser Intelligence

Browser Intelligence is the workflow and analysis layer of Browser Automation Workbench.

It turns one browser session into reusable artifacts:

```text
record → review → extract
```

## Positioning

Browser Intelligence is not a crawler. It is a human-in-the-loop browser workflow recorder and analyzer.

It relies on Browser Engine for real browser operations and focuses on:

- Capturing browsing evidence
- Reviewing automation strategy
- Extracting structured content
- Producing reports that can be reused later

## Commands

```bash
node scripts/bi.mjs help
node scripts/bi.mjs health
node scripts/bi.mjs paths
node scripts/bi.mjs capabilities
```

### Record

```bash
node scripts/bi.mjs record start <taskId> --url <url>
node scripts/bi.mjs record start <taskId> --target <targetId>
node scripts/bi.mjs record mark <note>
node scripts/bi.mjs record status
node scripts/bi.mjs record stop
```

### Review

```bash
node scripts/bi.mjs review <taskId>
node scripts/bi.mjs review list
```

### Extract

```bash
node scripts/bi.mjs extract <taskId>
```

## Outputs

Default output root:

```text
logs/browser-intelligence/
```

Trace structure:

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

## Current Capabilities

- CLI foundation
- Browser Engine health and tab proxy
- Recorder: start, mark, status, stop
- Reviewer: timeline, navigation, network classification, API candidates, selectors, recommendation
- Extractor: generic extraction and XHS validation parser
- Multi-post extraction for feed/search style pages
- Content quality score, category, timeliness, and location relevance enrichment

## Tests

```bash
npm test
npm run check
```

Current baseline:

```text
76 pass / 0 fail / 19 suites
```

## Environment Variables

```text
BROWSER_ENGINE_URL  Browser Engine HTTP API, default http://127.0.0.1:3456
BROWSER_ENGINE_DIR  Browser Engine source directory, default ../../packages/browser-engine
BI_LOGS_DIR         Runtime output directory, default ../../logs/browser-intelligence
```

## Extension Points

- Add platform extractors when a content structure repeats
- Add reviewer heuristics when trace analysis reveals stable new patterns
- Add task templates for repeated workflows
- Add site profiles in Browser Engine for repeated selector/API knowledge
