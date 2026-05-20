# GitHub Publishing Guide

This document records the recommended publishing steps for the repository.

## Recommended Repository

Name:

```text
browser-automation-workbench
```

Description:

```text
Local-first browser automation workbench powered by CDP: execution engine, workflow recorder, trace reviewer, and content extractor.
```

Visibility recommendation:

- Start as **private** if real traces or personal workflow details remain in the repository.
- Publish as **public** only after verifying that `logs/`, screenshots, cookies, and private notes are not committed.

## Pre-publish Checklist

Run from repository root:

```powershell
npm run check
npm test
```

Check ignored files:

```powershell
git status --ignored
```

Confirm no private runtime data:

```text
logs/
packages/browser-engine/.tasks/
packages/browser-engine/.site-profiles/
```

Confirm no secrets:

```text
API keys
cookies
localStorage/sessionStorage dumps
screenshots from private pages
real trace outputs
```

## Create GitHub Repository

GitHub CLI requires proxy in this environment:

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7897"
$env:HTTP_PROXY="http://127.0.0.1:7897"
```

Create private repo:

```powershell
gh repo create browser-automation-workbench --private --description "Local-first browser automation workbench powered by CDP: execution engine, workflow recorder, trace reviewer, and content extractor."
```

Or public repo:

```powershell
gh repo create browser-automation-workbench --public --description "Local-first browser automation workbench powered by CDP: execution engine, workflow recorder, trace reviewer, and content extractor."
```

## Initialize and Push

```powershell
git init
git config --local http.proxy http://127.0.0.1:7897
git config --local https.proxy http://127.0.0.1:7897
git add -A
git commit -m "Initial browser automation workbench"
git branch -M main
git remote add origin https://github.com/cheer932041235/browser-automation-workbench.git
git push -u origin main
```

## Suggested Initial Release

After first push:

```powershell
gh release create v0.1.0 --repo cheer932041235/browser-automation-workbench --title "v0.1.0" --notes "Initial monorepo release with Browser Engine and Browser Intelligence."
```

## Maintenance Rules

- Keep runtime outputs out of Git.
- Add new browser capabilities under `packages/browser-engine`.
- Add workflow/trace/extraction features under `packages/browser-intelligence`.
- Document every new recurring workflow under `docs/` or `examples/`.
- Prefer synthetic fixtures in tests.
