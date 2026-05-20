# Safety and Boundaries

Browser Automation Workbench is powerful because it connects to a real browser session. That also means it must be used with clear boundaries.

## Core Safety Model

- Local-first execution
- User-owned browser session
- Human-in-the-loop decisions
- No credential extraction
- No CAPTCHA bypass
- No hidden background surveillance
- No aggressive unattended scraping

## Login State

Browser Engine connects to the user's daily browser and therefore may inherit existing login state.

Rules:

- Do not read passwords, tokens, cookies, 2FA codes, or secret fields unless the user explicitly asks for a benign diagnostic and the data is not exposed in the response.
- Do not export browser sessions for sharing.
- Do not commit cookies, storage dumps, screenshots of private pages, or trace files containing sensitive data.
- Keep `logs/` ignored by Git.

## Platform Risk

Some platforms detect automation strictly.

Use these principles:

- Prefer user-visible actions over dense programmatic loops on sensitive sites.
- Avoid high-frequency polling.
- Avoid mass opening tabs.
- Avoid repeated identical actions.
- Stop when login wall, CAPTCHA, or security challenge appears.
- Treat platform anti-abuse mechanisms as boundaries, not obstacles to bypass.

## Human-in-the-loop Rule

This project is for assisted browsing, not autonomous account operation.

Good usage:

- User opens or confirms a page.
- Tool records and extracts.
- User reviews results.
- Tool performs bounded, reversible operations.

Bad usage:

- Tool runs for hours without supervision.
- Tool sends messages, likes, follows, purchases, or changes account settings without explicit confirmation.
- Tool monitors personal feeds continuously.

## Data Handling

Runtime traces may include private page text, URLs, screenshots, and request metadata.

Therefore:

- Do not commit `logs/`.
- Review generated reports before sharing.
- Use synthetic fixtures for public tests.
- Sanitize examples.
- Store secrets outside the repository.

## Network Responses

Network response bodies can contain sensitive data.

Rules:

- Capture response bodies only when needed.
- Prefer metadata for review reports.
- Redact private fields before saving long-term artifacts.
- Do not upload trace folders to public repositories.

## GitHub Repository Policy

Safe to publish:

- Source code
- Documentation
- Synthetic examples
- Test fixtures with fake data

Do not publish:

- Real trace outputs
- Real screenshots of logged-in sites
- Cookies or storage exports
- API keys
- Personal browsing history

## Design Implication

The workbench should optimize for:

- Repeatable local workflows
- Clear output boundaries
- Explicit user confirmation
- Recoverable task state
- Manual review before action

It should not optimize for stealth crawling or unattended monitoring.
