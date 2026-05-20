# Example: Record → Review → Extract

Use this when you want to turn a manual browsing session into durable artifacts.

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
- Task template
- Example documentation
