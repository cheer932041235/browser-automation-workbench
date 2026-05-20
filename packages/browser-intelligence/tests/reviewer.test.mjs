import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Set BI_LOGS_DIR before importing reviewer
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-review-test-'));
process.env.BI_LOGS_DIR = tmpDir;

const { reviewTrace, listTraces, classifyRequest, extractApiCandidates, computeTimeline, extractSelectors, generateRecommendation } = await import('../scripts/lib/reviewer.mjs');

// Cleanup
process.on('exit', () => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('classifyRequest', () => {
  test('classifies static resources', () => {
    assert.equal(classifyRequest({ url: 'https://x.com/style.css', mimeType: 'text/css' }), 'static');
    assert.equal(classifyRequest({ url: 'https://x.com/logo.png', mimeType: 'image/png' }), 'static');
    assert.equal(classifyRequest({ url: 'https://x.com/font.woff2', mimeType: 'font/woff2' }), 'static');
  });

  test('classifies API endpoints', () => {
    assert.equal(classifyRequest({ url: 'https://x.com/api/user', mimeType: 'application/json' }), 'api');
    assert.equal(classifyRequest({ url: 'https://x.com/v1/data', mimeType: 'application/json' }), 'api');
    assert.equal(classifyRequest({ url: 'https://x.com/graphql', mimeType: 'application/json' }), 'api');
  });

  test('classifies HTML documents', () => {
    assert.equal(classifyRequest({ url: 'https://x.com/page', mimeType: 'text/html' }), 'document');
  });

  test('classifies favicon as static', () => {
    assert.equal(classifyRequest({ url: 'https://x.com/favicon.ico', mimeType: 'text/html' }), 'static');
  });
});

describe('computeTimeline', () => {
  test('computes timeline from trace events', () => {
    const trace = [
      { time: '2026-05-19T22:10:16.000Z', type: 'start', url: 'https://example.com' },
      { time: '2026-05-19T22:10:17.000Z', type: 'mark', note: 'test mark' },
      { time: '2026-05-19T22:10:20.000Z', type: 'stop', finalUrl: 'https://example.com/', finalTitle: 'Example' },
    ];
    const tl = computeTimeline(trace);
    assert.equal(tl.durationMs, 4000);
    assert.equal(tl.durationHuman, '4.0s');
    assert.equal(tl.eventCount, 3);
    assert.equal(tl.markCount, 1);
    assert.equal(tl.startUrl, 'https://example.com');
    assert.equal(tl.finalUrl, 'https://example.com/');
  });

  test('returns null for empty trace', () => {
    assert.equal(computeTimeline([]), null);
  });
});

describe('extractSelectors', () => {
  test('extracts visible elements with selectors', () => {
    const pages = { final: { elements: [
      { idx: 0, tag: 'a', text: 'Click me', selector: 'a.btn', visible: true, href: '/go' },
      { idx: 1, tag: 'div', text: 'Hidden', selector: 'div.hidden', visible: false },
    ]}};
    const result = extractSelectors(pages);
    assert.equal(result.length, 1);
    assert.equal(result[0].tag, 'a');
    assert.equal(result[0].selector, 'a.btn');
  });

  test('returns empty for null pages', () => {
    assert.deepEqual(extractSelectors(null), []);
  });
});

describe('generateRecommendation', () => {
  test('recommends api-first when APIs found, no multi-nav', () => {
    const r = generateRecommendation([{ url: '/api/x' }], [], [{ url: 'a' }], {});
    assert.equal(r.recommendation, 'api-first');
  });

  test('recommends hybrid when APIs and multi-nav', () => {
    const r = generateRecommendation([{ url: '/api/x' }], [], [{ url: 'a' }, { url: 'b' }], {});
    assert.equal(r.recommendation, 'hybrid');
  });

  test('recommends ui-automation when selectors but no APIs', () => {
    const r = generateRecommendation([], [{ selector: 'a' }], [], {});
    assert.equal(r.recommendation, 'ui-automation');
  });

  test('recommends needs-more-data when nothing', () => {
    const r = generateRecommendation([], [], [], {});
    assert.equal(r.recommendation, 'needs-more-data');
  });
});

describe('reviewTrace integration', () => {
  test('generates review.md for a synthetic trace', () => {
    // Create a fake task directory under tmpDir
    const tracesDir = path.join(tmpDir, 'traces');
    fs.mkdirSync(tracesDir, { recursive: true });
    const taskDir = path.join(tracesDir, 'test-review-task');
    fs.mkdirSync(taskDir, { recursive: true });

    // Write synthetic trace data
    const traceLines = [
      JSON.stringify({ time: '2026-05-19T10:00:00.000Z', type: 'start', url: 'https://shop.example.com', opened: { targetId: 'T1' } }),
      JSON.stringify({ time: '2026-05-19T10:00:05.000Z', type: 'mark', note: 'opened product page' }),
      JSON.stringify({ time: '2026-05-19T10:00:30.000Z', type: 'stop', finalUrl: 'https://shop.example.com/cart', finalTitle: 'Shopping Cart' }),
    ];
    fs.writeFileSync(path.join(taskDir, 'trace.jsonl'), traceLines.join('\n') + '\n');

    fs.writeFileSync(path.join(taskDir, 'network.json'), JSON.stringify([
      { id: '1', url: 'https://shop.example.com/api/cart', method: 'GET', status: 200, mimeType: 'application/json' },
      { id: '2', url: 'https://shop.example.com/style.css', method: 'GET', status: 200, mimeType: 'text/css' },
      { id: '3', url: 'https://shop.example.com/logo.png', method: 'GET', status: 200, mimeType: 'image/png' },
    ]));

    fs.writeFileSync(path.join(taskDir, 'pages.json'), JSON.stringify({
      final: {
        info: { title: 'Shopping Cart', url: 'https://shop.example.com/cart' },
        elements: [
          { idx: 0, tag: 'button', text: 'Checkout', selector: 'button.checkout', visible: true },
          { idx: 1, tag: 'a', text: 'Continue Shopping', selector: 'a.continue', visible: true, href: '/products' },
        ],
      },
      navigation: [
        { url: 'https://shop.example.com/', ts: 1779200000000 },
        { url: 'https://shop.example.com/cart', ts: 1779200030000 },
      ],
    }));

    const result = reviewTrace('test-review-task');
    assert.ok(result.reviewFile.endsWith('review.md'));
    assert.ok(fs.existsSync(result.reviewFile));
    assert.equal(result.analysis.apiCandidates.length, 1);
    assert.equal(result.analysis.selectors.length, 2);
    assert.equal(result.analysis.navigation.length, 2);
    assert.equal(result.analysis.recommendation.recommendation, 'hybrid');
    assert.ok(result.report.includes('## API Candidates'));
    assert.ok(result.report.includes('## Stable Selectors'));
    assert.ok(result.report.includes('hybrid'));
  });

  test('throws for non-existent task', () => {
    assert.throws(() => reviewTrace('non-existent-task-xyz'), /not found/);
  });
});

describe('listTraces', () => {
  test('lists traces from temp directory', () => {
    const traces = listTraces();
    assert.ok(Array.isArray(traces));
    // Should include the test-review-task we just created
    assert.ok(traces.some(t => t.taskId === 'test-review-task'));
  });
});
