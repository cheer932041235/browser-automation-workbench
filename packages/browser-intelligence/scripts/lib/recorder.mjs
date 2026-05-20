import fs from 'node:fs';
import path from 'node:path';
import { tracesDir, recordingStateFile, ensureLogsDir, ensureTracesDir } from './paths.mjs';
import { getHealth, getJson, postJson } from './engine-client.mjs';

function nowIso() {
  return new Date().toISOString();
}

function safeTaskId(taskId) {
  return String(taskId || '').trim().replace(/[^a-zA-Z0-9._-]/g, '-');
}

function parseFlags(args) {
  const flags = { _: [] };
  const booleanFlags = new Set(['force']);
  for (let i = 0; i < args.length; i++) {
    const item = args[i];
    if (!item.startsWith('--')) {
      flags._.push(item);
      continue;
    }
    const key = item.slice(2);
    if (booleanFlags.has(key)) {
      flags[key] = true;
      continue;
    }
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

function taskPaths(taskId) {
  const id = safeTaskId(taskId);
  const taskDir = path.join(tracesDir, id);
  return {
    taskId: id,
    taskDir,
    pagesDir: path.join(taskDir, 'pages'),
    screenshotsDir: path.join(taskDir, 'screenshots'),
    traceFile: path.join(taskDir, 'trace.jsonl'),
    networkFile: path.join(taskDir, 'network.json'),
    pagesFile: path.join(taskDir, 'pages.json'),
    notesFile: path.join(taskDir, 'notes.md'),
    summaryFile: path.join(taskDir, 'summary.md'),
    stateFile: path.join(taskDir, 'state.json'),
  };
}

function ensureTaskDirs(paths) {
  ensureLogsDir();
  ensureTracesDir();
  fs.mkdirSync(paths.taskDir, { recursive: true });
  fs.mkdirSync(paths.pagesDir, { recursive: true });
  fs.mkdirSync(paths.screenshotsDir, { recursive: true });
}

function appendEvent(paths, event) {
  fs.appendFileSync(paths.traceFile, `${JSON.stringify({ time: nowIso(), ...event })}\n`, 'utf8');
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadActiveState() {
  if (!fs.existsSync(recordingStateFile)) return null;
  try { return readJson(recordingStateFile); } catch { return null; }
}

function saveActiveState(state) {
  ensureLogsDir();
  writeJson(recordingStateFile, state);
}

function clearActiveState() {
  try { fs.unlinkSync(recordingStateFile); } catch {}
}

function requireActiveState() {
  const state = loadActiveState();
  if (!state?.taskId) throw new Error('No active recording. Run: node scripts/bi.mjs record start <taskId> --url <url>');
  return state;
}

function resolveStartOptions(args) {
  const flags = parseFlags(args);
  const taskId = flags._[0];
  let url = flags.url;
  let targetId = flags.target;
  const note = flags.note || '';
  const force = Boolean(flags.force);

  for (const value of flags._.slice(1)) {
    if (!url && /^(https?:|about:|file:)/i.test(value)) url = value;
    else if (!targetId) targetId = value;
  }

  if (!taskId) throw new Error('Missing taskId. Usage: node scripts/bi.mjs record start <taskId> --url <url>');
  if (!url && !targetId) throw new Error('Missing --url or --target. Recorder must open a URL or attach to an existing target.');

  return { taskId: safeTaskId(taskId), url, targetId, note, force };
}

async function startRecording(args) {
  const opts = resolveStartOptions(args);
  const existing = loadActiveState();
  if (existing?.taskId && !opts.force) {
    throw new Error(`Recording already active: ${existing.taskId}. Stop it first or pass --force.`);
  }

  await getHealth({ timeout: 3000 });

  const paths = taskPaths(opts.taskId);
  let targetId = opts.targetId;
  let opened = null;
  if (opts.url) {
    opened = await getJson(`/tabs/new?url=${encodeURIComponent(opts.url)}&group=${encodeURIComponent(`bi-${opts.taskId}`)}`);
    targetId = opened.targetId;
  }

  if (!targetId) throw new Error('Unable to resolve targetId.');

  ensureTaskDirs(paths);

  const startInfo = await safeCall(() => getJson(`/tabs/info?target=${encodeURIComponent(targetId)}`));
  const screenshotDir = paths.screenshotsDir;
  const setup = {
    network: await safeCall(() => getJson(`/network/monitor?target=${encodeURIComponent(targetId)}`)),
    nav: await safeCall(() => postJson(`/nav/enable?target=${encodeURIComponent(targetId)}`, { console: true, network: true })),
    autoshot: await safeCall(() => postJson(`/autoshot/enable?target=${encodeURIComponent(targetId)}`, { dir: screenshotDir, format: 'jpeg', quality: 65, maxHistory: 50 })),
    firstShot: await safeCall(() => postJson(`/autoshot/capture?target=${encodeURIComponent(targetId)}`, { action: 'record_start' })),
  };

  const state = {
    taskId: opts.taskId,
    targetId,
    taskDir: paths.taskDir,
    startedAt: nowIso(),
    startUrl: opts.url || startInfo?.url || '',
    note: opts.note,
  };

  appendEvent(paths, {
    type: 'start',
    taskId: opts.taskId,
    targetId,
    url: state.startUrl,
    opened,
    page: startInfo,
    setup,
    note: opts.note,
  });
  writeJson(paths.stateFile, state);
  saveActiveState(state);

  if (!fs.existsSync(paths.notesFile)) {
    fs.writeFileSync(paths.notesFile, `# Recording Notes: ${opts.taskId}\n\n`, 'utf8');
  }

  return { state, paths, setup };
}

function markRecording(args) {
  const state = requireActiveState();
  const paths = taskPaths(state.taskId);
  const note = args.join(' ').trim();
  if (!note) throw new Error('Missing mark text. Usage: node scripts/bi.mjs record mark <note>');
  appendEvent(paths, { type: 'mark', taskId: state.taskId, targetId: state.targetId, note });
  fs.appendFileSync(paths.notesFile, `- ${nowIso()} ${note}\n`, 'utf8');
  return { state, note };
}

function getRecordingStatus() {
  const state = loadActiveState();
  if (!state?.taskId) return { active: false };
  const paths = taskPaths(state.taskId);
  return {
    active: true,
    state,
    traceFile: paths.traceFile,
    notesFile: paths.notesFile,
    taskDir: paths.taskDir,
  };
}

async function stopRecording(args) {
  const flags = parseFlags(args);
  const state = requireActiveState();
  const paths = taskPaths(state.taskId);
  ensureTaskDirs(paths);

  const target = encodeURIComponent(state.targetId);
  const finalInfo = await safeCall(() => getJson(`/tabs/info?target=${target}`));
  const text = await safeCall(() => postJson(`/page/text?target=${target}`, { maxLength: Number(flags['max-text'] || 8000) }));
  const elements = await safeCall(() => postJson(`/page/elements?target=${target}`, { maxItems: Number(flags['max-elements'] || 80) }));
  const network = await safeCall(() => postJson('/network/requests', { limit: Number(flags['max-network'] || 100) }));
  const navHistory = await safeCall(() => getJson(`/nav/history?target=${target}`));
  const finalShot = await safeCall(() => postJson(`/autoshot/capture?target=${target}`, { action: 'record_stop' }));
  const shotHistory = await safeCall(() => getJson(`/autoshot/history?target=${target}&limit=50`));

  const pages = {
    final: {
      info: finalInfo,
      text: text?.text || '',
      elements,
    },
    navigation: navHistory,
    screenshots: shotHistory,
  };

  writeJson(paths.pagesFile, pages);
  writeJson(paths.networkFile, network || []);

  const summary = buildSummary(state, pages, network, paths);
  fs.writeFileSync(paths.summaryFile, summary, 'utf8');

  appendEvent(paths, {
    type: 'stop',
    taskId: state.taskId,
    targetId: state.targetId,
    finalUrl: finalInfo?.url || '',
    finalTitle: finalInfo?.title || '',
    files: {
      pages: paths.pagesFile,
      network: paths.networkFile,
      notes: paths.notesFile,
      summary: paths.summaryFile,
    },
    finalShot,
  });

  clearActiveState();
  return { state, paths, finalInfo, networkCount: Array.isArray(network) ? network.length : 0 };
}

function buildSummary(state, pages, network, paths) {
  const info = pages.final?.info || {};
  const nav = Array.isArray(pages.navigation) ? pages.navigation : [];
  const shots = Array.isArray(pages.screenshots) ? pages.screenshots : [];
  const requests = Array.isArray(network) ? network : [];
  return `# Recording Summary: ${state.taskId}

## Basic

- Task ID: ${state.taskId}
- Target ID: ${state.targetId}
- Started At: ${state.startedAt}
- Stopped At: ${nowIso()}
- Start URL: ${state.startUrl || ''}
- Final URL: ${info.url || ''}
- Final Title: ${info.title || ''}

## Files

- Trace: ${paths.traceFile}
- Notes: ${paths.notesFile}
- Pages: ${paths.pagesFile}
- Network: ${paths.networkFile}
- Screenshots: ${paths.screenshotsDir}

## Counts

- Navigation events: ${nav.length}
- Network requests: ${requests.length}
- Screenshots: ${shots.length}
- Final text length: ${(pages.final?.text || '').length}
- Final elements: ${Array.isArray(pages.final?.elements) ? pages.final.elements.length : 0}

## Next AI Review Checklist

- Identify successful path.
- Identify failed or repeated steps.
- Extract key API candidates from network requests.
- Extract stable selectors or accessibility references.
- Decide whether this flow should become API-first or UI automation.
`;
}

async function safeCall(fn) {
  try { return await fn(); } catch (error) { return { error: error.message }; }
}

export {
  safeTaskId,
  parseFlags,
  taskPaths,
  loadActiveState,
  saveActiveState,
  clearActiveState,
  startRecording,
  markRecording,
  getRecordingStatus,
  stopRecording,
};
