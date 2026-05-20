/**
 * reviewer.mjs — Structured trace analysis & AI review report generation
 *
 * Reads Recorder output (trace.jsonl, network.json, pages.json) and produces
 * a structured review report with:
 *   - Timeline & duration
 *   - Network request classification (API vs static)
 *   - API candidates
 *   - Stable selectors from page elements
 *   - Automation recommendation (API-first vs UI automation)
 */

import fs from 'node:fs';
import path from 'node:path';
import { tracesDir } from './paths.mjs';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadTrace(taskDir) {
  const file = path.join(taskDir, 'trace.jsonl');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
  return lines.map(line => JSON.parse(line));
}

function loadNetwork(taskDir) {
  const file = path.join(taskDir, 'network.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function loadPages(taskDir) {
  const file = path.join(taskDir, 'pages.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function loadNotes(taskDir) {
  const file = path.join(taskDir, 'notes.md');
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf-8');
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

const STATIC_EXTENSIONS = new Set([
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff',
  '.woff2', '.ttf', '.eot', '.map', '.webp', '.avif',
]);

const STATIC_MIME_PREFIXES = ['image/', 'font/', 'text/css', 'application/javascript'];

function classifyRequest(req) {
  const url = req.url || '';
  const mime = (req.mimeType || '').toLowerCase();
  const ext = path.extname(new URL(url, 'http://x').pathname).toLowerCase();

  if (STATIC_EXTENSIONS.has(ext)) return 'static';
  if (STATIC_MIME_PREFIXES.some(p => mime.startsWith(p))) return 'static';
  if (mime.includes('json') || mime.includes('xml') || mime.includes('protobuf')) return 'api';
  if (mime.includes('html')) return 'document';
  if (url.includes('/api/') || url.includes('/v1/') || url.includes('/v2/') || url.includes('/graphql')) return 'api';
  return 'other';
}

function extractApiCandidates(requests) {
  return requests
    .filter(req => {
      const cls = classifyRequest(req);
      return cls === 'api';
    })
    .map(req => ({
      method: req.method || 'GET',
      url: req.url,
      status: req.status,
      mimeType: req.mimeType,
      classification: 'api',
    }));
}

function extractStaticSummary(requests) {
  const statics = requests.filter(req => classifyRequest(req) === 'static');
  const byType = {};
  for (const req of statics) {
    const ext = path.extname(new URL(req.url, 'http://x').pathname).toLowerCase() || req.mimeType || 'unknown';
    byType[ext] = (byType[ext] || 0) + 1;
  }
  return { count: statics.length, byType };
}

function extractSelectors(pages) {
  if (!pages?.final?.elements) return [];
  return pages.final.elements
    .filter(el => el.visible && el.selector)
    .map(el => ({
      tag: el.tag,
      type: el.type || '',
      text: (el.text || '').slice(0, 80),
      selector: el.selector,
      href: el.href || null,
    }));
}

function extractNavigation(pages) {
  if (!pages?.navigation) return [];
  return pages.navigation.map(nav => ({
    url: nav.url,
    time: nav.ts ? new Date(nav.ts).toISOString() : null,
    origin: nav.securityOrigin || null,
  }));
}

function computeTimeline(trace) {
  if (trace.length === 0) return null;
  const start = trace.find(e => e.type === 'start');
  const stop = trace.find(e => e.type === 'stop');
  const marks = trace.filter(e => e.type === 'mark');

  const startTime = start ? new Date(start.time) : null;
  const stopTime = stop ? new Date(stop.time) : null;
  const durationMs = startTime && stopTime ? stopTime - startTime : null;

  return {
    startTime: startTime?.toISOString() || null,
    stopTime: stopTime?.toISOString() || null,
    durationMs,
    durationHuman: durationMs !== null ? formatDuration(durationMs) : null,
    eventCount: trace.length,
    markCount: marks.length,
    marks: marks.map(m => ({ time: m.time, note: m.note })),
    startUrl: start?.url || start?.opened?.url || null,
    finalUrl: stop?.finalUrl || null,
    finalTitle: stop?.finalTitle || null,
  };
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

function generateRecommendation(apiCandidates, selectors, navigation, timeline) {
  const hasApis = apiCandidates.length > 0;
  const hasSelectors = selectors.length > 0;
  const hasMultiNav = navigation.length > 1;

  const factors = [];
  let recommendation = 'undetermined';

  if (hasApis) {
    factors.push(`Found ${apiCandidates.length} API endpoint(s) — potential for direct API calls`);
  }
  if (hasSelectors) {
    factors.push(`Found ${selectors.length} interactive element(s) with stable selectors`);
  }
  if (hasMultiNav) {
    factors.push(`Multi-page navigation detected (${navigation.length} pages) — flow involves state transitions`);
  }

  if (hasApis && !hasMultiNav) {
    recommendation = 'api-first';
    factors.push('RECOMMENDATION: API-first approach — direct API calls can replicate this flow without browser');
  } else if (hasApis && hasMultiNav) {
    recommendation = 'hybrid';
    factors.push('RECOMMENDATION: Hybrid — use APIs where possible, browser automation for navigation/auth');
  } else if (hasSelectors) {
    recommendation = 'ui-automation';
    factors.push('RECOMMENDATION: UI automation — no clear API endpoints, rely on stable selectors');
  } else {
    recommendation = 'needs-more-data';
    factors.push('RECOMMENDATION: Needs more data — insufficient trace information for a clear recommendation');
  }

  return { recommendation, factors };
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReviewReport(analysis) {
  const lines = [];
  const { timeline, apiCandidates, staticSummary, selectors, navigation, recommendation, taskId, taskDir } = analysis;

  lines.push(`# Review: ${taskId}`);
  lines.push('');

  // Timeline
  lines.push('## Timeline');
  lines.push('');
  if (timeline) {
    lines.push(`- **Start**: ${timeline.startTime || 'unknown'}`);
    lines.push(`- **Stop**: ${timeline.stopTime || 'unknown'}`);
    lines.push(`- **Duration**: ${timeline.durationHuman || 'unknown'}`);
    lines.push(`- **Events**: ${timeline.eventCount}`);
    lines.push(`- **Marks**: ${timeline.markCount}`);
    lines.push(`- **Start URL**: ${timeline.startUrl || 'unknown'}`);
    lines.push(`- **Final URL**: ${timeline.finalUrl || 'unknown'}`);
    lines.push(`- **Final Title**: ${timeline.finalTitle || 'unknown'}`);
    if (timeline.marks.length > 0) {
      lines.push('');
      lines.push('### User Marks');
      lines.push('');
      for (const mark of timeline.marks) {
        lines.push(`- \`${mark.time}\` — ${mark.note}`);
      }
    }
  } else {
    lines.push('No timeline data available.');
  }
  lines.push('');

  // Navigation Path
  lines.push('## Navigation Path');
  lines.push('');
  if (navigation.length > 0) {
    for (const nav of navigation) {
      lines.push(`1. ${nav.url}${nav.time ? ` (${nav.time})` : ''}`);
    }
  } else {
    lines.push('No navigation events captured.');
  }
  lines.push('');

  // Network Analysis
  lines.push('## Network Analysis');
  lines.push('');
  lines.push(`- **Total requests**: ${(apiCandidates.length + staticSummary.count + (analysis.otherCount || 0))}`);
  lines.push(`- **API candidates**: ${apiCandidates.length}`);
  lines.push(`- **Static resources**: ${staticSummary.count}`);
  if (Object.keys(staticSummary.byType).length > 0) {
    lines.push(`- **Static breakdown**: ${Object.entries(staticSummary.byType).map(([k, v]) => `${k}(${v})`).join(', ')}`);
  }
  lines.push('');

  // API Candidates
  if (apiCandidates.length > 0) {
    lines.push('## API Candidates');
    lines.push('');
    lines.push('| Method | URL | Status | MIME |');
    lines.push('|--------|-----|--------|------|');
    for (const api of apiCandidates) {
      const urlShort = api.url.length > 80 ? api.url.slice(0, 77) + '...' : api.url;
      lines.push(`| ${api.method} | ${urlShort} | ${api.status ?? '—'} | ${api.mimeType || '—'} |`);
    }
    lines.push('');
  }

  // Stable Selectors
  if (selectors.length > 0) {
    lines.push('## Stable Selectors');
    lines.push('');
    lines.push('| Tag | Type | Text | Selector | Href |');
    lines.push('|-----|------|------|----------|------|');
    for (const sel of selectors) {
      lines.push(`| ${sel.tag} | ${sel.type || '—'} | ${sel.text || '—'} | \`${sel.selector}\` | ${sel.href || '—'} |`);
    }
    lines.push('');
  }

  // Recommendation
  lines.push('## Automation Recommendation');
  lines.push('');
  lines.push(`**Strategy**: \`${recommendation.recommendation}\``);
  lines.push('');
  for (const factor of recommendation.factors) {
    lines.push(`- ${factor}`);
  }
  lines.push('');

  // Next Steps
  lines.push('## Suggested Next Steps');
  lines.push('');
  switch (recommendation.recommendation) {
    case 'api-first':
      lines.push('1. Capture full request/response for API candidates (headers, body, auth)');
      lines.push('2. Identify required authentication tokens or session cookies');
      lines.push('3. Build a minimal script that replicates the API calls directly');
      lines.push('4. Add error handling and retry logic');
      break;
    case 'hybrid':
      lines.push('1. Use browser automation for login/authentication and navigation');
      lines.push('2. Intercept and replicate API calls for data extraction');
      lines.push('3. Identify which navigation steps are required vs optional');
      lines.push('4. Build a two-phase script: browser setup → API extraction');
      break;
    case 'ui-automation':
      lines.push('1. Verify selector stability across page reloads');
      lines.push('2. Add wait conditions before interactions (element visible, page loaded)');
      lines.push('3. Build a step-by-step automation script using the stable selectors');
      lines.push('4. Add screenshot evidence at each key step');
      break;
    default:
      lines.push('1. Record a longer browsing session with more interactions');
      lines.push('2. Add manual marks at key decision points');
      lines.push('3. Visit multiple pages to capture navigation patterns');
      lines.push('4. Re-run review after collecting more trace data');
  }
  lines.push('');

  // Source
  lines.push('---');
  lines.push(`*Generated from: \`${taskDir}\`*`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function reviewTrace(taskId) {
  const safeName = taskId.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  const taskDir = path.join(tracesDir, safeName);

  if (!fs.existsSync(taskDir)) {
    throw new Error(`Task directory not found: ${taskDir}`);
  }

  const trace = loadTrace(taskDir);
  const network = loadNetwork(taskDir);
  const pages = loadPages(taskDir);

  const timeline = computeTimeline(trace);
  const apiCandidates = extractApiCandidates(network);
  const staticSummary = extractStaticSummary(network);
  const selectors = extractSelectors(pages);
  const navigation = extractNavigation(pages);
  const recommendation = generateRecommendation(apiCandidates, selectors, navigation, timeline);
  const otherCount = network.length - apiCandidates.length - staticSummary.count;

  const analysis = {
    taskId: safeName,
    taskDir,
    timeline,
    apiCandidates,
    staticSummary,
    selectors,
    navigation,
    recommendation,
    otherCount,
  };

  const report = generateReviewReport(analysis);
  const reviewFile = path.join(taskDir, 'review.md');
  fs.writeFileSync(reviewFile, report, 'utf-8');

  return { analysis, report, reviewFile };
}

function listTraces() {
  if (!fs.existsSync(tracesDir)) return [];
  return fs.readdirSync(tracesDir)
    .filter(name => {
      const dir = path.join(tracesDir, name);
      return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'trace.jsonl'));
    })
    .map(name => {
      const dir = path.join(tracesDir, name);
      const traceFile = path.join(dir, 'trace.jsonl');
      const stat = fs.statSync(traceFile);
      return { taskId: name, dir, modified: stat.mtime };
    })
    .sort((a, b) => b.modified - a.modified);
}

export {
  reviewTrace,
  listTraces,
  classifyRequest,
  extractApiCandidates,
  computeTimeline,
  extractSelectors,
  generateRecommendation,
};
