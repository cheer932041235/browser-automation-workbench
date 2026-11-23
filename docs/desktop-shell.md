# Standalone desktop shell

The optional shell uses Electron WebContentsView to display project pages in an independent window. It provides tabs, address/navigation controls, background execution, offscreen screenshots and a user handoff window. It does not copy the daily browser's profile.

## Install and open on Windows x64

```powershell
./scripts/install-desktop-runtime.ps1
npm run workbench:open
```

The installer downloads official Electron 45.2.1 into runtime/desktop-runtime/, retains its bundled licences and creates the local shortcut. It does not install a system browser. To choose another runtime version, pass -Version; use a fresh runtime directory when changing an existing installation.

Use engine:desktop and browser:chrome when creating a session: this selects bundled Chromium, not the installed Google Chrome profile. Create project/allowedUrls bindings before opening a site. User login and site authorization happen inside that session.

## Lifecycle

Normal task execution keeps the window hidden. Human handoff explicitly displays it. Returning to background preserves the process and page; closing the title-bar window hides it. Closing the session stops its own process. Inactive tabs are throttled; the active page remains rendered for background work and screenshots.

Remote pages run without Node integration or the workbench IPC bridge. Window controls use a separate local control endpoint. Profiles, downloads, logs and crash data remain in the configured session directories.

## Verification and scope

npm run test:desktop uses local fixture pages and a separate test profile. It additionally needs Python 3 for Windows window-state inspection; set WORKBENCH_PYTHON if python is not on PATH. The browser itself does not need Python.

Windows x64 is the verified desktop installation path. Cross-platform desktop packaging, browser sync and extension-store support are outside the current delivered interface. The optional hub mode accepts an external application registry and launcher; its Python executable can be set with --workbench-python or WORKBENCH_PYTHON.
