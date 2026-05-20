# Workflows

This document describes common workflows for Browser Automation Workbench.

## Workflow 1: One-off Page Operation

Use Browser Engine directly.

```bash
npm run engine:start
npm run engine:cli -- new https://example.com
npm run engine:cli -- tabs
npm run engine:cli -- text <targetId>
npm run engine:cli -- shot <targetId> screenshots/example.png
npm run engine:cli -- close <targetId>
```

Best for:

- Quick page inspection
- Screenshot capture
- Small form operations
- Debugging a selector

## Workflow 2: Human-in-the-loop Browsing Record

Use Browser Intelligence Recorder.

```bash
npm run bi -- record start research-demo --url https://example.com
npm run bi -- record mark "Found target page"
npm run bi -- record mark "Clicked useful section"
npm run bi -- record stop
npm run bi -- review research-demo
```

Best for:

- Browsing tasks that require judgment
- Sites with login state
- Exploratory research
- Turning manual browsing into reusable evidence

## Workflow 3: Record → Review → Extract

```bash
npm run bi -- record start content-demo --url https://example.com
# browse normally
npm run bi -- record stop
npm run bi -- review content-demo
npm run bi -- extract content-demo
```

Best for:

- Content-heavy pages
- Feeds and search pages
- Pages where structured output is useful
- Building a future extractor

## Workflow 4: Build a New Site Profile

1. Open the target site with Browser Engine.
2. Use `/page/elements`, `/page/forms`, `/page/links`, and screenshots to inspect structure.
3. Use manual browsing plus `record mark` to capture important state transitions.
4. Run `review` to identify stable selectors and API endpoints.
5. Promote stable findings into a site profile only after repeated use.

Recommended evidence:

- Page URL patterns
- Stable text anchors
- Stable selectors
- API endpoint patterns
- Required wait conditions
- Login/permission boundaries
- Known popups or dialogs

## Workflow 5: API-first Automation Discovery

This is the workflow that turns a visible frontend operation into backend/API development evidence.

The browser click path is not the final product. It is a controlled probe:

```text
click/search/navigate in browser
  → capture network requests and page state
  → identify candidate backend interfaces
  → validate and wrap the stable interface in secondary development
```

1. Start recording.
2. Enable network monitoring through Recorder or Engine.
3. Perform the user action once manually.
4. Stop recording.
5. Run `review`.
6. Check API candidates in `review.md` and `network.json`.
7. If API response body is required, use Engine's `/network/response` while the target page is still alive.

Use API-first only when it is stable, authenticated by existing browser session, and safer than brittle UI clicks.

The output of this workflow is usually not a finished automation feature. It is a development brief for the next layer:

- Confirm the request method, URL, parameters, headers, and response schema.
- Decide how authentication should be handled without exposing credentials.
- Implement a backend adapter, CLI script, extractor, site profile, or Browser Engine pipeline.
- Add tests with synthetic fixtures before treating the integration as reusable.

## Workflow 6: UI-first Automation

Use UI-first when:

- API is unavailable or heavily obfuscated
- The page requires user gestures
- The workflow is short
- Human judgment remains in the loop

Typical sequence:

```text
new tab → wait for page → detect obstacle → click/search/type → wait network/text → extract text/screenshot
```

## Workflow 7: Hybrid Automation

Use hybrid when:

- UI is needed to reach a valid page state
- API calls become visible after user interaction
- Content is partly rendered and partly delivered through network responses
- The user must first perform judgment or confirmation, then developers can wrap the discovered interface

Typical sequence:

```text
UI navigate/search → network monitor → response extraction → page text fallback
```

## Workflow 8: Content Intelligence Session

This is the preferred pattern for research and knowledge work.

```text
User browses normally
  → Recorder captures trace
  → User marks important moments
  → Reviewer summarizes what happened
  → Extractor produces structured content
  → User decides what to keep
```

This avoids the false goal of fully unattended crawling and preserves the value of human judgment.

## Anti-patterns

Avoid these unless there is a strong reason:

- Polling social feeds every few minutes
- Trying to bypass CAPTCHA or account security
- Running browser automation unattended for long periods
- Adding site-specific features after only one example
- Treating screenshots as the only source of truth when DOM/network data is available
