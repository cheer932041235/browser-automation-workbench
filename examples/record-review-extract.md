# Example: Record → Review → Extract

Use this when you want to turn a manual browsing session into durable artifacts.

This workflow is also useful for API discovery. The recorded browser clicks are evidence for understanding what backend interfaces were triggered and what secondary development may be needed.

## Start Engine

```bash
npm run engine:start
```

## Start Recording

```bash
npm run bi -- record start demo-task --url https://example.com
```

## Browse Normally

Use the browser manually or through Browser Engine commands.

Add semantic marks:

```bash
npm run bi -- record mark "Opened target page"
npm run bi -- record mark "Found useful list"
npm run bi -- record mark "Clicked first detail page"
```

## Stop Recording

```bash
npm run bi -- record stop
```

## Review

```bash
npm run bi -- review demo-task
```

Open:

```text
logs/browser-intelligence/traces/demo-task/review.md
```

Use the review to decide whether the workflow should become:

- API-first backend adapter
- UI-first Browser Engine pipeline
- Hybrid browser + API workflow
- Browser Intelligence extractor
- Site profile
- Manual-assisted task template

If API candidates are found, create an API discovery brief:

```text
examples/api-discovery-brief.md
```

## Extract

```bash
npm run bi -- extract demo-task
```

Open:

```text
logs/browser-intelligence/traces/demo-task/extract.md
logs/browser-intelligence/traces/demo-task/posts.json
```

## Promote Later

If this task repeats often, consider adding:

- Site profile
- Extractor parser
- Backend/API adapter
- Browser Engine pipeline
- Task template
- Example documentation
