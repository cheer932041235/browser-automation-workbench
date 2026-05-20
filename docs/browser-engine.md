# Browser Engine

Browser Engine is the local CDP execution layer.

It exposes browser capabilities through a stable HTTP API and a small CLI wrapper. It is useful when the task is about operating the page directly: clicking, typing, reading page text, watching network requests, or downloading files.

## Start

```bash
npm run engine:start
```

Direct server start:

```bash
node packages/browser-engine/server.mjs --browser-port 59888
```

CLI shortcut:

```bash
npm run engine:cli -- help
```

## Main Files

```text
packages/browser-engine/
├── start.mjs          dependency and browser-port check
├── server.mjs         HTTP API router
├── core.mjs           CDP connection and command/session layer
├── tabs.mjs           tab lifecycle management
├── interact.mjs       click/type/fill/scroll/upload/drag
├── page.mjs           text/elements/forms/links/table/screenshot/pdf
├── network.mjs        request monitor/response/cookies/storage/downloads
├── frames.mjs         iframe operations
├── stealth.mjs        lightweight anti-detection helpers
├── wait.mjs           load/network/element/text/stable waiters
├── detect.mjs         page obstacle detection and smart open
├── dialog.mjs         dialog handling
├── accessibility.mjs  accessibility snapshot and action resolution
├── autoshot.mjs       automatic screenshot history
├── navigation.mjs     navigation event tracking
├── profiles.mjs       site-specific profile store
└── be.mjs             CLI shortcut client
```

## API Groups

### System

- `GET /health`
- `GET /help`

### Tabs

- `GET /tabs`
- `GET|POST /tabs/new?url=`
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
- `POST /click?target=`
- `POST /clickByText?target=`
- `POST /clickAt?target=`
- `POST /clickXY?target=`
- `POST /doubleClick?target=`
- `POST /rightClick?target=`
- `POST /type?target=`
- `POST /insertText?target=`
- `POST /fill?target=`
- `POST /fillForm?target=`
- `POST /pressKey?target=`
- `POST /hotkey?target=`
- `POST /hover?target=`
- `POST /scroll?target=`
- `POST /select?target=`
- `POST /checkbox?target=`
- `POST /upload?target=`
- `POST /drag?target=`
- `POST /actionability?target=`
- `POST /safeClick?target=`

### Page Analysis

- `POST /page/elements?target=`
- `POST /page/text?target=`
- `POST /page/forms?target=`
- `POST /page/links?target=`
- `POST /page/table?target=`
- `POST /screenshot?target=`
- `POST /pdf?target=`

### Network and Storage

- `GET /network/monitor?target=`
- `GET /network/stop?target=`
- `POST /network/requests`
- `GET /network/response?target=&requestId=`
- `POST /network/intercept?target=`
- `GET|POST|DELETE /cookies?target=`
- `GET|POST|DELETE /storage?target=&type=`
- `POST /session/export?target=`
- `POST /session/import?target=`
- `GET /downloads?target=&enable=1`

### Advanced

- Frames: `/frames/*`
- Shadow DOM: `/shadow/*`
- Console: `/console/*`
- Dialog: `/dialog/*`
- Accessibility: `/accessibility/*`
- Autoshot: `/autoshot/*`
- Navigation: `/nav/*`
- Site Profiles: `/profiles/*`
- Batch: `/batch/*`
- Pipeline: `/pipeline`

## When to Use Browser Engine Directly

Use it directly when you need:

- One-off browser operations
- Page exploration
- Screenshot/PDF capture
- Network response inspection
- Form filling or file uploading
- Debugging selectors
- Building a new site profile

Use Browser Intelligence instead when you need a durable trace, a review report, or structured extraction.
