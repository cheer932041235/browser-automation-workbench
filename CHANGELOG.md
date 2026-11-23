# Changelog

## 0.6.0 — 2026-11-23

- Ship an installable browser-workbench agent skill with local repository discovery, plus illustrated setup documentation and a reproducible local screenshot demo.
- Fix textarea filling on both the main page and iframe; verify native setters against actual input and textarea elements.
- Accept PowerShell UTF-8 BOM input during stdio MCP initialization as well as CLI calls.
- Add the standalone Windows Electron browser shell, hidden execution, tab management and human handoff.
- Add managed sessions, scoped daily-browser attachment, saved task steps, upload/download tracking and postcondition-based recovery.
- Add page screenshots, multi-viewport overflow/broken-image checks, idle session closure and resource metrics.
- Improve Edge/Chrome connection discovery through DevToolsActivePort and explicit reconnect.
- Keep MCP tool discovery independent of the backend; actual calls start the local service on demand.
- Improve per-page event isolation and redact sensitive form values from task output.
- Keep Browser Intelligence record/review/extract artifacts local to the project.
- Remove the fixed E-drive requirement and machine-specific Python defaults; replace personal live-page examples with explicit parameters or synthetic fixtures.
