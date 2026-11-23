# Getting started

The shortest supported installation path is the [Windows desktop quick start](../README.md#快速开始windows-独立浏览器).

Requirements: Node.js 22+, PowerShell for the Windows x64 Electron installer. Core code has no npm package dependencies. Existing-browser attachment requires Edge or Chrome with remote debugging enabled. Full macOS/Linux desktop use has not been validated.

Use [managed sessions](managed-workbench.md) for isolated project profiles and resumable tasks, or [daily browser attachment](browser-connections.md) to inspect an explicitly selected existing browser. Both run locally; downloading the optional Electron runtime and opening websites use the network.

Run commands from the repository root. Runtime state belongs in runtime/, test files in work/, and local results in outputs/; all are ignored by Git. No particular Windows drive letter is required.
