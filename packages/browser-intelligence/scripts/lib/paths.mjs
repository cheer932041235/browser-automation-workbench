import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const libDir = path.dirname(thisFile);
const scriptsDir = path.dirname(libDir);
const rootDir = path.dirname(scriptsDir);
const workspaceDir = path.resolve(rootDir, '..', '..');
const knowledgeBaseDir = workspaceDir;
const browserEngineDir = process.env.BROWSER_ENGINE_DIR || path.join(workspaceDir, 'packages', 'browser-engine');
const docsDir = path.join(rootDir, 'docs');
const logsDir = process.env.BI_LOGS_DIR || path.join(workspaceDir, 'logs', 'browser-intelligence');
const tracesDir = path.join(logsDir, 'traces');
const recordingStateFile = path.join(logsDir, 'recording-state.json');

const docMap = {
  index: path.join(docsDir, 'README.md'),
  readme: path.join(docsDir, 'README.md'),
  developer: path.join(docsDir, 'developer-guide.md'),
  guide: path.join(docsDir, 'developer-guide.md'),
  capabilities: path.join(docsDir, 'capabilities.md'),
  cli: path.join(docsDir, 'cli.md'),
  api: path.join(docsDir, 'api-map.md'),
  'api-map': path.join(docsDir, 'api-map.md'),
  output: path.join(docsDir, 'output-policy.md'),
  'output-policy': path.join(docsDir, 'output-policy.md'),
  testing: path.join(docsDir, 'testing.md'),
  test: path.join(docsDir, 'testing.md'),
};

function ensureLogsDir() {
  fs.mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

function ensureTracesDir() {
  fs.mkdirSync(tracesDir, { recursive: true });
  return tracesDir;
}

function exists(targetPath) {
  return fs.existsSync(targetPath);
}

export {
  rootDir,
  scriptsDir,
  workspaceDir,
  knowledgeBaseDir,
  browserEngineDir,
  docsDir,
  logsDir,
  tracesDir,
  recordingStateFile,
  docMap,
  ensureLogsDir,
  ensureTracesDir,
  exists,
};
