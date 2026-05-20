# Browser Intelligence

Browser Intelligence is the workflow layer on top of Browser Engine.

It records, reviews, and extracts browsing sessions. It is useful when a browser task should become a reusable asset rather than a one-off operation.

It is also an API discovery layer. A recorded frontend click path is often used to discover the backend interfaces, parameters, authentication context, and response schema needed for later secondary development.

## Commands

```bash
npm run bi -- help
npm run bi -- version
npm run bi -- paths
npm run bi -- docs
npm run bi -- capabilities
npm run bi -- health
```

## Recorder

```bash
npm run bi -- record start <taskId> --url <url>
npm run bi -- record start <taskId> --target <targetId>
npm run bi -- record mark <note>
npm run bi -- record status
npm run bi -- record stop
```

Recorder outputs:

```text
trace.jsonl       event stream
notes.md          manual marks
pages.json        final page info, text, elements, navigation, screenshots
network.json      captured network request metadata
summary.md        human-readable recording summary
screenshots/      auto screenshots
```

## Reviewer

```bash
npm run bi -- review <taskId>
npm run bi -- review list
```

Reviewer outputs:

```text
review.md
```

It analyzes:

- Timeline and duration
- Navigation path
- Network request categories
- API candidates
- Stable selectors
- Strategy recommendation: API-first, UI-first, hybrid, or manual-assisted

## API Discovery and Secondary Development

Recorder and Reviewer do not automatically turn every click flow into a finished backend integration.

Their role is to produce a development brief:

```text
frontend click path
  → captured network metadata
  → API candidates and selectors
  → strategy recommendation
  → developer validates and wraps stable behavior
```

Typical follow-up work:

- Validate candidate endpoints with controlled calls.
- Confirm request method, parameters, headers, and response schema.
- Decide how authentication should be handled safely.
- Implement a backend adapter, CLI script, extractor, site profile, or Browser Engine pipeline.
- Add synthetic tests before reusing the workflow.

This distinction is important: Browser Intelligence records evidence and recommends direction; reusable automation still requires deliberate secondary development.

## Extractor

```bash
npm run bi -- extract <taskId>
```

Extractor outputs:

```text
posts.json
extract.md
```

Current extractor capabilities:

- Platform detection: Xiaohongshu and generic pages
- XHS text parsing: title, body, author, tags, engagement, noteId, publish time
- Multi-post feed/search parsing
- API endpoint marking
- Quality score
- Content category detection
- Timeliness detection
- Hangzhou relevance scoring

XHS is a validation scenario, not the strategic center of the project. The strategic center is the reusable browser workflow pipeline.

For more details, see [UI Recording to API Discovery](api-discovery.md).

## Output Policy

By default, Browser Intelligence writes runtime data to:

```text
logs/browser-intelligence/
```

Override with:

```bash
BI_LOGS_DIR=/custom/path npm run bi -- record start demo --url https://example.com
```

## Relationship to Browser Engine

Browser Intelligence uses Browser Engine through HTTP:

```text
BROWSER_ENGINE_URL=http://127.0.0.1:3456
```

Override with:

```bash
BROWSER_ENGINE_URL=http://127.0.0.1:3457 npm run bi -- health
```

Browser Intelligence also locates Browser Engine for help messages through:

```text
BROWSER_ENGINE_DIR
```

In this monorepo, the default is:

```text
packages/browser-engine
```

## When to Add a New Extractor

Add a new extractor only when:

- The same site or content type appears repeatedly
- Generic extraction loses important fields
- A stable structure can be inferred from trace data
- The output will be reused in downstream notes, reports, or automation

Otherwise, keep the task as a recorded trace plus review report.
