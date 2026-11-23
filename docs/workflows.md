# Workflows

## Isolated project browsing

Follow the CLI example in the [README](../README.md#cli给指定项目创建会话). Start a session, open the intended URL, list pages and use the returned pageId. Request human handoff when the site needs login or verification.

## Resumable form task

After opening a local or authorized application page, send this plan to browser_task_create, replacing the absolute project path, exact URL, page ID and selectors with observed values:

```json
{
  "id":"form-demo",
  "sessionId":"demo",
  "project":"/absolute/path/to/project",
  "pageId":"<observed-page-id>",
  "url":"https://app.example.org/form",
  "steps":[
    {"id":"fill-title","action":"fill","selector":"#title","value":"Example"},
    {"id":"save","action":"click","selector":"#save","check":{"selector":"#status","text":"Saved"}}
  ]
}
```

Run with browser_task_run:{taskId:"form-demo"}. Read saved state with browser_task_get. Following an interruption, observe the page and postcondition before resolving the existing step; do not create a replacement plan that repeats completed submissions.

## Screenshot and responsive check

browser_page_screenshot requires an explicit absolute filePath. browser_page_check accepts widths, height and optional screenshotDir. Review the actual image when visual correctness matters; a returned file path alone is not a visual check.

## Record, review, extract

```powershell
npm run engine:check
npm run engine:start -- --browser edge
npm run bi -- record start demo-task --url https://example.org/
npm run bi -- record mark "Page inspected"
npm run bi -- record stop
npm run bi -- review demo-task
npm run bi -- extract demo-task
```

Recorded page and network artifacts stay under logs/browser-intelligence/. Use a site and account you are authorized to inspect. The resulting API brief is development evidence, not permission to publish captured credentials or user data.
