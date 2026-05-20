# Roadmap

Browser Automation Workbench is intended to be a long-term expandable browser automation repository.

## Current Stable Baseline

### Browser Engine

Status: usable execution layer.

Completed:

- CDP connection and auto discovery
- HTTP API server
- Tab lifecycle management
- Page interactions
- Page analysis
- Network monitoring
- Cookies and storage
- Frames, Shadow DOM, dialogs, accessibility
- Waiters, pipeline, batch operations
- Site profiles and task persistence

### Browser Intelligence

Status: v0.3.0 stable workflow layer.

Completed:

- CLI foundation
- Recorder
- Reviewer
- Extractor
- XHS validation parser
- Multi-post extraction
- Content enrichment
- 76 tests passing

## Near-term Improvements

These are useful but not urgent.

1. **Monorepo polish**
   - Add root-level smoke tests
   - Add GitHub Actions for syntax check and tests
   - Normalize English/Chinese documentation naming

2. **Engine API docs generation**
   - Generate endpoint docs from `API_HELP`
   - Add request/response examples
   - Add error shape conventions

3. **Trace viewer**
   - Small local HTML viewer for trace timeline
   - Show screenshots, navigation, marks, network calls
   - Useful for quickly reviewing recorded sessions

4. **Extractor plugin system**
   - Move platform parsers into `extractors/`
   - Add generic registry
   - Keep current XHS parser as an example implementation

5. **Site profile workflow**
   - Promote repeated selector/API findings into `.site-profiles`
   - Add profile import/export
   - Add profile confidence notes

## Medium-term Extensions

1. **Browser task templates**
   - Search-and-summarize
   - Login-required research
   - Form filling with confirmation
   - Download collection
   - Table extraction
   - Screenshot/PDF archiving

2. **Knowledge-base integration**
   - Export trace summaries to Markdown notes
   - Attach screenshots as assets
   - Link source URLs and review reports

3. **Safer action confirmation**
   - Require explicit confirmation for irreversible actions
   - Detect submit/purchase/send/delete buttons
   - Add dry-run mode for workflows

4. **Better network response capture**
   - Capture selected response bodies by URL pattern
   - Redact sensitive fields
   - Link responses to extractor inputs

5. **Cross-browser support**
   - Chrome and Edge are primary
   - Brave/Arc may be supported if CDP endpoint is compatible

## Long-term Vision

The workbench should become a reusable local browser automation lab:

```text
Explore manually → Record evidence → Review strategy → Extract structure → Promote patterns → Reuse safely
```

Potential future capabilities:

- Local trace database
- Task replay with checkpoints
- Visual selector debugging
- Domain-specific extraction packs
- Agent-friendly browser operation protocol
- Integration with local notes and research workflows

## Explicit Non-goals

- Social media botting
- CAPTCHA bypass
- Credential harvesting
- Unattended account operation
- High-frequency feed monitoring
- Cloud-hosted browser farm

## Version Direction

Suggested versioning:

- `browser-engine`: 1.x for stable local API evolution
- `browser-intelligence`: 0.x until extractor/plugin API stabilizes
- root workbench: 0.x while monorepo structure evolves
