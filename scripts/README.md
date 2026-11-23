# Scripts

Repository-level launch, desktop runtime, and real-browser acceptance scripts. Test artifacts use `work/` during execution (and should be cleaned afterward); durable acceptance conclusions live under `outputs/`.

## Root npm Scripts (`package.json`)

| Script | Target / Action |
| --- | --- |
| `npm run workbench:open` / `desktop:open` | Ensure `:3460` workbench is running and open the standalone desktop shell (`scripts/open-desktop.mjs`) |
| `npm run workbench:start` | Start or reuse the `:3460` Managed Workbench HTTP/SSE background daemon (`scripts/start-workbench.mjs`) |
| `npm run workbench:mcp` | Run stdio MCP server backed by `:3460` (`packages/browser-engine/workbench-client.mjs --mcp`) |
| `npm run workbench:cli` | Send JSON payloads via stdin to invoke `:3460` workbench tools |
| `npm run engine:check` | Preflight local Edge `DevToolsActivePort` & `:3456` health without probing extra ports |
| `npm run engine:start` | Start `:3456` direct daily-browser CDP engine (background by default; pass `-- --foreground` to stay attached) |
| `npm run engine:server` | Run `:3456` engine HTTP server directly in foreground |
| `npm run engine:cli` | Invoke Browser Engine CLI shortcuts (`packages/browser-engine/be.mjs`) |
| `npm run bi` | Invoke Browser Intelligence CLI (`packages/browser-intelligence/scripts/bi.mjs`) |
| `npm run check` | Syntax-check `browser-engine`, `browser-intelligence`, `browser-desktop`, and all `scripts/*.mjs` |
| `npm test` | Run offline unit suites (Engine 36 tests + Intelligence 78 tests) |
| `npm run test:desktop` | Run 7 standalone desktop shell integration checks (`scripts/verify-desktop.mjs`) |
| `npm run test:browser` | Run engine, profile isolation, workbench MCP/CLI, and restart-recovery checks |
| `npm run test:background` | Run background-execution, human handoff, and login persistence checks (`scripts/verify-background.mjs`) |
| `npm run test:appearance` | Verify managed Chrome sign-in disabling, profile naming, and green theme (`scripts/verify-managed-appearance.mjs`) |

## Script Inventory

- `install-desktop-runtime.ps1`: Downloads/unpacks official Electron Windows x64 runtime into `runtime/desktop-runtime/` and creates root `我的浏览器.lnk` pointing to `打开我的浏览器.vbs`.
- `install-agent-skill.ps1`: Copies the public skill into the selected skill directory and records the local repository location. Does not configure MCP or change other skills.
- `capture-docs.mjs` / `npm run docs:screenshots`: Runs local demo tasks in two disposable desktop sessions and writes the management screenshot to `docs/images/`. Requires the installed Electron runtime; `--show` keeps the window open for a native window capture until Enter is pressed. The script removes its disposable profiles under `work/docs-screenshots/` on exit.
- `start-workbench.mjs` / `open-desktop.mjs`: Starts `:3460` cleanly or opens the default `browser-home` desktop window.
- `verify-engine.mjs`: Checks real page, cross-site iframe, and network isolation on controlled pages.
- `verify-sessions.mjs`: Verifies dual-profile storage (`Cookie`, `localStorage`, `IndexedDB`) and download directory isolation.
- `verify-workbench.mjs`: Exercises real CLI/stdio MCP flows, uploads, error rejections, and responsive `1280px`/`390px` UI rendering.
- `verify-restart.mjs`: Stops an actual workbench service process mid-workflow and verifies safe postcondition recovery.
- `verify-background.mjs`: Verifies zero-window execution, rejection of focus requests in background mode, and login retention after `show_human` → `resume_background`.
- `verify-managed-appearance.mjs`: Reads isolated Chrome Preferences/Local State to verify theme and disabled browser sign-in/sync.
- `verify-desktop.mjs`: Exercises the standalone Electron `WebContentsView` shell (`main.cjs`), window toggling, tab recovery, and restart resume.
- `verify-existing.mjs`: Read-only check of one already-open, authorized page: `node scripts/verify-existing.mjs <edge|chrome> <exact-page-url>`. Uses the `:3456` daily-browser service.
