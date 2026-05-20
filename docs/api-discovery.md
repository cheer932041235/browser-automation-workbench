# UI Recording to API Discovery

Browser Automation Workbench is not only about replaying browser clicks.

A recorded click flow is often a discovery process for a deeper automation interface:

```text
User completes the task in the browser
  → Recorder captures the UI path and network traffic
  → Reviewer identifies API candidates, parameters, selectors, and state transitions
  → Developer validates the backend interface
  → Developer builds a reusable adapter, script, service endpoint, or extractor
```

## Core Idea

Many web tasks look like frontend interactions:

```text
click search → type keyword → click result → open detail page → download/export/extract
```

But behind those frontend actions, the browser usually calls backend interfaces:

```text
POST /api/search
GET /api/items/{id}
POST /graphql
GET /export?taskId=...
```

The purpose of recording is to preserve enough evidence to answer:

- Which backend endpoint was called?
- Which request method, headers, query parameters, and body were used?
- Which browser state made the request valid?
- Which response fields matter?
- Which UI steps are only navigation, and which steps are real business actions?
- Can the workflow be converted into direct API calls?
- Which parts still need browser UI because of authentication, user gestures, CAPTCHA, or dynamic page state?

## What the Workbench Provides

The workbench provides discovery evidence, not a finished product integration by itself.

It helps collect:

- UI path: navigation, visible elements, screenshots, and semantic marks
- Network metadata: API-like requests, methods, status codes, MIME types, and URLs
- Page context: final text, elements, links, forms, and structured content
- Strategy recommendation: API-first, UI-first, hybrid, or needs more data

This turns a manual browser operation into a developer-readable research artifact.

## What Still Requires Secondary Development

After a recording session, a developer usually still needs to do secondary development.

Typical tasks:

1. Validate the candidate API endpoint with controlled test calls.
2. Identify required authentication context without exposing secrets.
3. Confirm stable request parameters and response schema.
4. Handle pagination, retries, errors, rate limits, and expired sessions.
5. Decide whether the final implementation should be:
   - a backend adapter
   - a local CLI script
   - a Browser Engine pipeline
   - a Browser Intelligence extractor
   - a site profile
   - a documented manual-assisted workflow
6. Add tests with synthetic fixtures.
7. Document the safety boundary and user confirmation points.

## UI-first vs API-first vs Hybrid

### UI-first

Use when:

- No stable API candidate is visible
- The site requires user gestures
- The task is short and low-frequency
- Human judgment is central to the workflow

### API-first

Use when:

- A stable API endpoint is visible
- Request parameters are understandable
- Authentication can be handled safely by the user's local session or explicit configuration
- Direct calls are safer and more reliable than brittle UI replay

### Hybrid

Use when:

- Browser UI is needed to enter a valid state
- API calls become visible only after navigation or login
- Some content comes from DOM, while important data comes from network responses

Typical hybrid pattern:

```text
browser UI reaches valid state → network observation discovers API → developer wraps stable API calls
```

## Example Development Path

```text
1. User manually runs the task once in the browser.
2. Recorder captures trace, page state, screenshots, and network metadata.
3. User adds marks for important decisions.
4. Reviewer identifies API candidates and selectors.
5. Developer inspects request/response details.
6. Developer writes an adapter or extractor.
7. Adapter is tested with synthetic fixtures.
8. Repeated patterns are promoted into site profiles or task templates.
```

## Non-goals

The workbench does not automatically promise to:

- Generate production-ready backend integrations from one trace
- Bypass authentication or CAPTCHA
- Convert every UI interaction into an API call
- Run unattended scraping or monitoring
- Store private response bodies or credentials in the repository

## Design Implication

Recorder should be understood as an observation and evidence layer.

The real long-term value is not the saved click sequence itself, but the ability to turn successful human browsing into:

- reproducible knowledge
- stable backend/API understanding
- safer automation strategies
- reusable extraction or integration modules
