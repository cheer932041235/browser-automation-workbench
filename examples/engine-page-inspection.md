# Example: Direct Browser Engine Page Inspection

Use this when you need quick browser control without recording a full task.

## Start Engine

```bash
npm run engine:start
```

## Open a Page

```bash
npm run engine:cli -- new https://example.com
```

Copy the returned target id.

## Inspect Page

```bash
npm run engine:cli -- info <targetId>
npm run engine:cli -- text <targetId>
npm run engine:cli -- elements <targetId>
npm run engine:cli -- links <targetId>
npm run engine:cli -- forms <targetId>
```

## Interact

```bash
npm run engine:cli -- click <targetId> "button.submit"
npm run engine:cli -- fill <targetId> "input[name=q]" "browser automation"
npm run engine:cli -- key <targetId> Enter
npm run engine:cli -- scroll <targetId> bottom
```

## Capture

```bash
npm run engine:cli -- shot <targetId> screenshots/page.png
```

## Close

```bash
npm run engine:cli -- close <targetId>
```
