# Security Policy

Browser Automation Workbench controls real browser sessions and may interact with logged-in pages. Treat all runtime data as sensitive by default.

## Supported Versions

This repository is currently in early development. Security fixes target the `main` branch.

## Sensitive Data

Do not commit:

- Cookies
- Access tokens or refresh tokens
- Passwords
- API keys
- Local/session storage dumps
- Screenshots of private pages
- Real trace folders containing private browsing data
- Network response bodies containing user data

Runtime outputs should stay under ignored folders such as:

```text
logs/
packages/browser-engine/.tasks/
packages/browser-engine/.site-profiles/
```

## Reporting a Vulnerability

If you find a vulnerability, please open a private report through GitHub Security Advisories if available, or contact the repository owner directly.

Please include:

- A short description
- Affected files or commands
- Minimal reproduction steps
- Potential impact
- Suggested mitigation if known

## Project Boundaries

This project does not support:

- CAPTCHA bypass
- Credential harvesting
- Unattended account operation
- High-frequency scraping or monitoring
- Platform anti-abuse evasion

Security mechanisms on websites should be treated as boundaries, not obstacles to bypass.
