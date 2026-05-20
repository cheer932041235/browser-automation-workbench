# Example: API Discovery Brief

This template is used after recording and reviewing a browser workflow.

The goal is not to preserve the click sequence forever. The goal is to decide whether the visible frontend operation can become a safer backend/API integration.

## Task

- Task name:
- Site:
- User goal:
- Recorded trace:

## Frontend Path

```text
1. Open page
2. Search / click / navigate
3. Reach result state
4. Confirm output
```

## Candidate Backend Interfaces

| Method | URL / Pattern | Status | Purpose | Confidence |
|---|---|---:|---|---:|
| | | | | |

## Request Evidence

- Query parameters:
- Request body:
- Important headers:
- Required cookies/session state:
- Triggering UI action:

## Response Evidence

- Response type:
- Important fields:
- Pagination fields:
- Error fields:
- Example item schema:

## Authentication and Safety

- Login required:
- Uses existing browser session:
- Needs explicit user configuration:
- Sensitive fields to avoid storing:
- User confirmation required before action:

## Strategy Decision

- [ ] API-first
- [ ] UI-first
- [ ] Hybrid
- [ ] Keep manual-assisted
- [ ] Needs more traces

## Secondary Development Plan

1. Validate endpoint with a controlled local call.
2. Replace real private data with synthetic fixtures.
3. Implement adapter / CLI / extractor / site profile.
4. Add tests.
5. Document usage and safety limits.

## Notes


