#!/usr/bin/env node
import { docMap, rootDir, workspaceDir, browserEngineDir, docsDir, logsDir, ensureLogsDir, exists } from './lib/paths.mjs';
import { getHealth, getHelp, getTabs, DEFAULT_BASE_URL } from './lib/engine-client.mjs';
import { startRecording, markRecording, getRecordingStatus, stopRecording } from './lib/recorder.mjs';
import { reviewTrace, listTraces } from './lib/reviewer.mjs';
import { extractContent } from './lib/extractor.mjs';
import { printTitle, printSection, printKeyValue, printList, printJson, formatStatus } from './lib/format.mjs';

const VERSION = '0.3.0';
const [command, ...args] = process.argv.slice(2);

const HELP = `
Browser Intelligence CLI
========================
Usage:
  node scripts/bi.mjs <command> [args...]

Core:
  help                         Show this help
  version                      Show CLI version
  paths                        Show project paths
  docs [name]                  Show docs index or one doc path
  capabilities                 Show browser capability map
  health                       Check Browser Intelligence and Browser Engine status

Engine proxy:
  engine health                GET /health
  engine help                  GET /help
  engine tabs                  GET /tabs

Recorder:
  record start <id> --url <url>     Start recording with a new tab
  record start <id> --target <id>   Attach recording to an existing target
  record mark <note>                Add a manual mark
  record status                     Show active recording
  record stop                       Stop and export summary

Review:
  review <taskId>                   Analyze a recorded trace and generate review
  review list                       List all recorded traces

Extract:
  extract <taskId>                  Extract structured content from a trace

Docs names:
  index, developer, capabilities, cli, api-map, output-policy
`.trim();

async function main() {
  switch (command || 'help') {
    case 'help':
    case '-h':
    case '--help':
      console.log(HELP);
      return;

    case 'version':
    case '-v':
    case '--version':
      printVersion();
      return;

    case 'paths':
      printPaths(false);
      return;

    case 'docs':
      printDocs(args[0]);
      return;

    case 'capabilities':
    case 'caps':
      printCapabilities();
      return;

    case 'health':
      await printHealth();
      return;

    case 'engine':
      await runEngineCommand(args);
      return;

    case 'record':
    case 'rec':
      await runRecordCommand(args);
      return;

    case 'review':
      runReviewCommand(args);
      return;

    case 'extract':
      runExtractCommand(args);
      return;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run: node scripts/bi.mjs help');
      process.exit(1);
  }
}

function printVersion() {
  printTitle('Browser Intelligence');
  printKeyValue('Version', VERSION);
  printKeyValue('Root', rootDir);
}

function printPaths(createLogs) {
  const finalLogsDir = createLogs ? ensureLogsDir() : logsDir;
  printTitle('Browser Intelligence Paths');
  printKeyValue('Workspace', workspaceDir);
  printKeyValue('Root', rootDir);
  printKeyValue('Browser Engine', browserEngineDir);
  printKeyValue('Docs', docsDir);
  printKeyValue('Logs', finalLogsDir);
  printSection('Exists');
  printKeyValue('Root', formatStatus(exists(rootDir)));
  printKeyValue('Browser Engine', formatStatus(exists(browserEngineDir)));
  printKeyValue('Docs', formatStatus(exists(docsDir)));
  printKeyValue('Logs', formatStatus(exists(finalLogsDir)));
}

function printDocs(name) {
  if (!name) {
    printTitle('Browser Intelligence Docs');
    for (const [key, file] of Object.entries(docMap)) {
      if (['readme', 'guide', 'api', 'output'].includes(key)) continue;
      printKeyValue(key, file);
    }
    return;
  }

  const file = docMap[name];
  if (!file) {
    console.error(`Unknown doc name: ${name}`);
    console.error(`Available: ${Object.keys(docMap).join(', ')}`);
    process.exit(1);
  }

  printTitle(`Doc: ${name}`);
  printKeyValue('Path', file);
  printKeyValue('Exists', formatStatus(exists(file)));
}

function printCapabilities() {
  printTitle('Browser Capability Map');

  const groups = [
    ['Open & Tabs', ['GET /tabs', 'GET|POST /tabs/new', 'GET /tabs/info', 'POST /tabs/navigate', 'GET /tabs/close']],
    ['Page Understanding', ['POST /page/text', 'POST /page/elements', 'POST /page/forms', 'POST /page/links', 'POST /accessibility/snapshot']],
    ['Interaction', ['POST /click', 'POST /clickByText', 'POST /clickAt', 'POST /safeClick', 'POST /fill', 'POST /type', 'POST /insertText', 'POST /pressKey', 'POST /scroll']],
    ['Network', ['GET /network/monitor', 'POST /network/requests', 'GET /network/response', 'GET /network/stop']],
    ['Evidence', ['POST /screenshot', 'POST /autoshot/enable', 'POST /autoshot/capture', 'GET /autoshot/history']],
    ['Complex DOM', ['GET /frames', 'POST /frames/eval', 'POST /frames/click', 'POST /shadow/query', 'POST /shadow/click']],
    ['Stability', ['POST /wait/load', 'POST /wait/network', 'POST /wait/element', 'POST /wait/stable', 'GET /detect']],
    ['Persistence', ['GET|POST /tasks', 'GET /tasks/next', 'POST /tasks/context', 'GET|POST /profiles', 'POST /profiles/note']],
  ];

  for (const [group, items] of groups) {
    printSection(group);
    printList(items);
  }

  console.log('\nFull map: docs/capabilities.md and docs/api-map.md');
}

async function printHealth() {
  printTitle('Browser Intelligence Health');
  ensureLogsDir();
  printKeyValue('Root', formatStatus(exists(rootDir)));
  printKeyValue('Browser Engine Dir', formatStatus(exists(browserEngineDir)));
  printKeyValue('Docs', formatStatus(exists(docsDir)));
  printKeyValue('Logs', formatStatus(exists(logsDir)));

  printSection('Browser Engine');
  try {
    const health = await getHealth({ timeout: 3000 });
    printKeyValue('Endpoint', DEFAULT_BASE_URL);
    printKeyValue('Status', health?.status || 'unknown');
    printKeyValue('Connected', String(Boolean(health?.connected)));
    printKeyValue('Browser Port', String(health?.browserPort ?? 'unknown'));
    printKeyValue('Managed Tabs', String(health?.managedTabs ?? 'unknown'));
    printKeyValue('Uptime', health?.uptime === undefined ? 'unknown' : `${Math.round(health.uptime)}s`);
  } catch (error) {
    printEngineUnavailable(error);
    process.exit(2);
  }
}

async function runEngineCommand(engineArgs) {
  const sub = engineArgs[0] || 'help';
  try {
    switch (sub) {
      case 'health':
        printJson(await getHealth());
        return;

      case 'help':
        printEngineHelp(await getHelp());
        return;

      case 'tabs':
      case 'ls':
        printTabs(await getTabs());
        return;

      default:
        console.error(`Unknown engine command: ${sub}`);
        console.error('Available: health, help, tabs');
        process.exit(1);
    }
  } catch (error) {
    printEngineUnavailable(error);
    process.exit(2);
  }
}

async function runRecordCommand(recordArgs) {
  const sub = recordArgs[0] || 'help';
  const rest = recordArgs.slice(1);
  try {
    switch (sub) {
      case 'help':
      case '-h':
      case '--help':
        printRecordHelp();
        return;

      case 'start': {
        const result = await startRecording(rest);
        printTitle('Recording Started');
        printKeyValue('Task ID', result.state.taskId);
        printKeyValue('Target ID', result.state.targetId);
        printKeyValue('Task Dir', result.paths.taskDir);
        printKeyValue('Trace', result.paths.traceFile);
        return;
      }

      case 'mark': {
        const result = markRecording(rest);
        printTitle('Recording Mark Added');
        printKeyValue('Task ID', result.state.taskId);
        printKeyValue('Note', result.note);
        return;
      }

      case 'status': {
        const status = getRecordingStatus();
        printTitle('Recording Status');
        if (!status.active) {
          console.log('No active recording.');
          return;
        }
        printKeyValue('Task ID', status.state.taskId);
        printKeyValue('Target ID', status.state.targetId);
        printKeyValue('Started At', status.state.startedAt);
        printKeyValue('Task Dir', status.taskDir);
        printKeyValue('Trace', status.traceFile);
        return;
      }

      case 'stop': {
        const result = await stopRecording(rest);
        printTitle('Recording Stopped');
        printKeyValue('Task ID', result.state.taskId);
        printKeyValue('Target ID', result.state.targetId);
        printKeyValue('Final URL', result.finalInfo?.url || '');
        printKeyValue('Network Requests', String(result.networkCount));
        printKeyValue('Summary', result.paths.summaryFile);
        return;
      }

      default:
        console.error(`Unknown record command: ${sub}`);
        printRecordHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

function printRecordHelp() {
  console.log(`
Recorder Commands
=================
  record start <id> --url <url>       Open a new tab and start recording
  record start <id> --target <id>     Attach to an existing Browser Engine target
  record mark <note>                  Add a manual mark to trace.jsonl and notes.md
  record status                       Show active recording
  record stop                         Stop recording and export summary

Examples:
  node scripts/bi.mjs record start hangzhou-xhs --url https://www.xiaohongshu.com
  node scripts/bi.mjs record mark "opened search results"
  node scripts/bi.mjs record stop
`.trim());
}

function printEngineHelp(help) {
  printTitle('Browser Engine API Categories');
  if (!help || typeof help !== 'object') {
    printJson(help);
    return;
  }
  for (const [category, endpoints] of Object.entries(help)) {
    printSection(category);
    printList(Array.isArray(endpoints) ? endpoints : [String(endpoints)]);
  }
}

function printTabs(tabs) {
  printTitle('Browser Engine Tabs');
  if (!Array.isArray(tabs)) {
    printJson(tabs);
    return;
  }
  if (tabs.length === 0) {
    console.log('No tabs.');
    return;
  }
  for (const tab of tabs) {
    const id = String(tab.targetId || '').slice(0, 8);
    const title = String(tab.title || '').slice(0, 50);
    const url = String(tab.url || '').slice(0, 90);
    const managed = tab.managed ? ' managed' : '';
    console.log(`${id.padEnd(10)} ${title.padEnd(52)} ${url}${managed}`);
  }
}

function runExtractCommand(extractArgs) {
  const sub = extractArgs[0];

  if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
    console.log(`
Extract Commands
================
  extract <taskId>     Extract structured content and generate extract.md + posts.json

Example:
  node scripts/bi.mjs extract xhs-browse-01
`.trim());
    return;
  }

  try {
    const { extraction, postsFile, extractFile } = extractContent(sub);
    printTitle(`Extract: ${extraction.taskId}`);
    printKeyValue('Platform', `${extraction.platform.label} (${extraction.platform.name})`);
    printKeyValue('Posts', String(extraction.posts.length));
    printKeyValue('API Endpoints', String(extraction.apiEndpoints.length));
    if (extraction.posts.length > 0) {
      printKeyValue('Avg Quality', (extraction.posts.reduce((s, p) => s + p.qualityScore, 0) / extraction.posts.length).toFixed(1) + '/10');
    }
    printKeyValue('Posts File', postsFile);
    printKeyValue('Extract File', extractFile);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

function runReviewCommand(reviewArgs) {
  const sub = reviewArgs[0] || 'list';

  if (sub === 'list' || sub === 'ls') {
    const traces = listTraces();
    printTitle('Recorded Traces');
    if (traces.length === 0) {
      console.log('No traces found.');
      return;
    }
    for (const t of traces) {
      const date = t.modified.toISOString().slice(0, 19).replace('T', ' ');
      console.log(`  ${t.taskId.padEnd(40)} ${date}`);
    }
    return;
  }

  if (sub === 'help' || sub === '-h' || sub === '--help') {
    console.log(`
Review Commands
===============
  review <taskId>     Analyze a trace and generate review.md
  review list         List all recorded traces

Example:
  node scripts/bi.mjs review real-example-2
`.trim());
    return;
  }

  // Treat sub as taskId
  try {
    const { analysis, reviewFile } = reviewTrace(sub);
    printTitle(`Review: ${analysis.taskId}`);
    printKeyValue('Duration', analysis.timeline?.durationHuman || 'unknown');
    printKeyValue('Events', String(analysis.timeline?.eventCount || 0));
    printKeyValue('API Candidates', String(analysis.apiCandidates.length));
    printKeyValue('Stable Selectors', String(analysis.selectors.length));
    printKeyValue('Navigation Pages', String(analysis.navigation.length));
    printKeyValue('Recommendation', analysis.recommendation.recommendation);
    printKeyValue('Review File', reviewFile);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

function printEngineUnavailable(error) {
  const reason = error?.message || String(error);
  const prefix = 'Browser Engine unavailable: ';
  console.error(reason.startsWith(prefix) ? reason : `${prefix}${reason}`);
  console.error(`Endpoint: ${DEFAULT_BASE_URL}`);
  console.error(`Start/check manually: node "${browserEngineDir}\\start.mjs"`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
