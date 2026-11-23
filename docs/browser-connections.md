# Existing browser connections

The default browser is Edge. `engine:start` and `launch-edge.ps1` attach to an existing browser; neither launches nor terminates it. Discovery reads only that browser's `DevToolsActivePort`, including its WebSocket path. There is no common-port scan or connection preflight that opens and closes a second debugger session.

```powershell
npm run engine:check
npm run engine:start -- --browser edge
npm run engine:cli -- --browser edge health
npm run engine:cli -- --browser edge tabs
npm run engine:cli -- --browser chrome tabs
```

One HTTP service maintains separate Edge and Chrome connections and tab managers (`engine:start` runs in background by default; pass `--foreground` to keep it attached to the terminal). `npm run engine:check` (`be.mjs preflight`) checks the local `DevToolsActivePort` and `:3456` `/health` status without probing extra ports, and `POST /reconnect` (`be.mjs reconnect`) refreshes a dropped CDP connection using the current `DevToolsActivePort`. `/health` reports the browser, user data directory, connection state, `endpoint` preflight info, and actual port. A selected browser that is unavailable stays unavailable; it does not switch to another application.

The selected default browser may use `--user-data-dir <directory>`. Legacy `--browser-port` must match that profile's port; it cannot override browser identity. Edge may require its own remote-debugging approval before the first connection completes. The engine waits up to five minutes for that approval without launching another browser. After a browser disconnects, the next operation reconnects to the same browser profile.

## Keep the current page

```powershell
npm run engine:cli -- open https://www.goofish.com/
npm run engine:cli -- text <targetId>
npm run engine:cli -- nav <targetId> <url>
```

`open` / `/tabs/open` returns an exact URL match, or the site's only existing tab, without navigating it. Multiple matching site tabs require selecting a target from `tabs`; the engine will not guess or create another. `new` explicitly creates a tab. Browser tab IDs remain usable across engine restarts while the browser keeps those tabs open.

Engine shutdown and idle periods leave tabs open. `close` and `closeAll` are explicit actions. No default browser-profile copying or browser restart is used.

## Verification

`npm run check` checks both packages. `npm test` includes connection selection, missing-profile behavior, existing-tab reuse, search-page preservation, and the intelligence package's tests. Live Edge attachment and reconnection must also be checked against the current user's browser; tests do not substitute for browser authorization.
