# Managed browser sessions

Managed Workbench runs at http://127.0.0.1:3460 and exposes the same operations through HTTP, CLI and stdio MCP. The management page is optional; automation can work without leaving it open.

## Start and call

```powershell
npm run workbench:start
'{}' | node packages/browser-engine/workbench-client.mjs browser_sessions
'{"includeMetrics":true}' | node packages/browser-engine/workbench-client.mjs browser_sessions
```

The CLI reads JSON from stdin and returns JSON to stdout. It starts the local service on demand. MCP initialize/tools-list return local definitions without requiring the backend; tool calls start it when needed. See the [root README](../README.md) for client configuration.

## Session modes

- desktop: the optional Windows Electron shell, separate project Profile, hidden by default. Install the runtime first.
- native: installed Chrome or Edge with an independent profile; Windows executable defaults are provided.
- attached: explicitly scoped reuse of a running daily Edge/Chrome. Closing the session disconnects the client and leaves the browser open.

Create IDs with lowercase letters, digits and hyphens. Set project to the calling project's absolute directory and allowedUrls to its intended website scope. Page actions use the exact pageId returned by browser_pages/browser_page_open. The root README includes executable creation and open commands.

## Human handoff

browser_session_request_human records a reason and URL without displaying a window. browser_session_show_human displays that dedicated session. After login, verification or approval, browser_session_resume_background checks the configured visible identity and resumes the same profile in background mode. A visible website login remains subject to the site's expiry rules.

## Tasks

browser_task_create binds steps to a session, project, URL and page. Supported actions are open, read, fill, click, upload, download and human. Provide check:{selector,text} to describe an observable postcondition, and nextUrl when an action navigates.

browser_task_run follows saved order. If a mutating action was interrupted, inspect its actual result before confirming completion or retrying. browser_task_rebind explicitly binds the reopened page. It does not reset prior completed steps. See [workflows](workflows.md) for a task example.

## Screenshots and layout

browser_page_screenshot requires sessionId, pageId and an explicit filePath. Optional fullPage, width, height, selector, format and quality control the capture. The supplied filePath should be in the calling project's work/ or outputs/ directory.

browser_page_check checks horizontal overflow and broken images at widths [1440,390] by default. Optional screenshotDir saves per-viewport images. It restores emulation after the check. Hidden desktop captures use the shell's offscreen capture path.

## Local storage and lifecycle

runtime/sessions.json stores session metadata; runtime/profiles/<session-id>/ contains website data; runtime/tasks/ stores saved business steps; runtime/downloads/<session-id>/ holds downloads. WORKBENCH_DATA_ROOT can set the service's data root. The optional Electron runtime remains under runtime/desktop-runtime/ in the repository.

Idle managed background sessions save page URLs and close their browser after 30 minutes by default. idleTimeoutMinutes overrides this per session; 0 disables idle closure. Active tasks, downloads and human windows are not idle-closed. Idle sessions can resume automatically; explicitly closed sessions require an explicit start.

Profiles, task values and page recordings can contain private data. Keep runtime/, work/, outputs/ and real recordings out of public commits.
