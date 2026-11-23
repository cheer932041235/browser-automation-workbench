---
name: browser-workbench
description: Use Browser Automation Workbench for independent browser sessions, explicit Edge/Chrome attachment, saved browser tasks, human handoff, screenshots, and layout checks. Applies when this workbench is selected or an existing workbench task needs continuation.
---

# Browser Workbench

Read `workbench.json` next to this file for `repoRoot`, written by the repository's `scripts/install-agent-skill.ps1`. Install the skill before using this copied entry. The repository is the maintained source; rerun the installer after updating it.

Use the `browser_*` MCP tools when the client has the workbench MCP configured. Otherwise pass a JSON object through stdin to:

```text
node <repoRoot>/packages/browser-engine/workbench-client.mjs <tool-name>
```

Use an absolute executable argument and structured JSON input. Do not embed task values in shell expressions. Both interfaces use the same saved sessions and tasks. Tool discovery does not start the browser service; actual calls start it on demand.

## Choose and resume a session

- Respect the user's selected browser and page. This skill does not change their default browser or select itself instead of another configured tool.
- Start with `browser_sessions` and `browser_tasks`. Reuse the calling project's session and inspect an existing task with `browser_task_get` before acting.
- For an independent browser, call `browser_session_create` with a readable `id`, `engine:"desktop"` (requires the Windows runtime), the calling project's absolute `project`, and intended `allowedUrls`. Then call `browser_session_start`.
- For an explicitly selected existing Edge/Chrome page, use `browser_session_attach` with `browser`, `project`, and `allowedUrls`. This requires remote debugging in that browser. It shares that browser's login; it does not copy a profile.
- Use `browser_pages` or `browser_page_open` to obtain the exact page ID. Read the current page before choosing selectors. Never reuse a page ID from another session.
- For account-specific work, verify the visible account. Bind a configured `identity` selector/value when repeatable verification is needed. Read `<repoRoot>/docs/managed-workbench.md` for these arguments.

## Observe and execute

`browser_page_read` returns current URL, text and interactive elements. Use `browser_frames` and `browser_frame_read` for iframe content. Choose selectors from the current observation.

For clicks, typing, uploads and downloads, create an executable plan with `browser_task_create`, then run it with `browser_task_run`. Bind it to the calling project, session, URL and page. A minimal task arguments object is:

```json
{
  "id": "save-note",
  "name": "Save the requested note",
  "sessionId": "notes",
  "project": "/absolute/path/to/calling-project",
  "pageId": "page-id-from-browser-pages",
  "url": "https://app.example.org/notes",
  "steps": [
    {"action": "fill", "selector": "#note", "value": "Requested text"},
    {"action": "click", "selector": "#save", "check": {"selector": "#status", "text": "Saved"}}
  ]
}
```

Replace example selectors and paths with observed values. Read `<repoRoot>/docs/workflows.md` for navigation, iframe and upload examples. Task planning does not grant permission to submit, publish or send anything beyond the user's request.

After interruption, inspect saved progress and the live result. An uncertain submission must not be replayed. Use an observable `check` postcondition; provide `resolution` and concrete `evidence` only after inspecting the result. `browser_task_rebind` reconnects the task to a verified live page without resetting completed steps.

## Human action and screenshots

- Login/CAPTCHA: `browser_session_request_human` records the reason and URL; `browser_session_show_human` displays the dedicated window. Wait for the user, then `browser_session_resume_background` continues the same profile. Use a `human` task step when it belongs in a saved plan.
- `browser_page_screenshot` requires an explicit `filePath` in the calling project's `work/` or `outputs/`. Inspect the actual image before reporting its content.
- `browser_page_check` checks overflow and broken images across supplied widths; it is a focused layout check, not a full visual review.
- When finished, close only the session owned by this task. `browser_session_close` preserves its local login state and saved URLs; attached sessions disconnect without closing the daily browser.

Keep profiles, task values, downloads and real recordings local. The repository's `runtime/`, `work/` and `outputs/` are ignored by Git. For recording/API analysis, read `<repoRoot>/docs/api-discovery.md`; those operations use the separate Browser Intelligence CLI.
