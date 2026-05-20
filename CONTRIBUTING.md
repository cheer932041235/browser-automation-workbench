# Contributing

Browser Automation Workbench is a local-first monorepo for browser automation tools.

## Project Boundaries

The repository has two main layers:

- `packages/browser-engine`: low-level CDP execution layer
- `packages/browser-intelligence`: workflow, recording, review, and extraction layer

Add new code to the layer that owns the responsibility.

## Development Setup

Requirements:

- Node.js 22+
- Chrome or Edge with remote debugging enabled for real browser runs

Run checks:

```bash
npm run check
npm test
```

## Before Opening a Pull Request

Please verify:

- `npm run check` passes
- `npm test` passes
- No real browser traces are committed
- No screenshots from private pages are committed
- No cookies, tokens, passwords, or storage dumps are committed
- New recurring workflows are documented under `docs/` or `examples/`

## Coding Guidelines

- Keep Browser Engine focused on browser execution primitives.
- Keep Browser Intelligence focused on trace workflows and structured analysis.
- Prefer small, composable commands over large hidden automation flows.
- Use synthetic fixtures for tests.
- Avoid site-specific code unless a repeated workflow justifies it.

## Documentation Guidelines

When adding capabilities, update the nearest relevant document:

- Engine APIs: `docs/browser-engine.md`
- Intelligence workflows: `docs/browser-intelligence.md`
- End-to-end usage: `docs/workflows.md`
- Safety boundaries: `docs/safety.md`
- Examples: `examples/`

## Safety Rules

Do not contribute code that aims to bypass CAPTCHA, harvest credentials, evade platform abuse controls, or run unattended account operations.
