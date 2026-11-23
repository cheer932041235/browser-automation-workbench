#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultBrowser, browserProfile, inspectBrowserEndpoint } from './browsers.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};
const browser = value('--browser', defaultBrowser);
const port = Number(value('--port', process.env.ENGINE_PORT || 3456));
const foreground = args.includes('--foreground');
browserProfile(browser);

const forwardArgs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--foreground') continue;
  if (args[i] === '--browser' || args[i] === '--port') { i++; continue; }
  forwardArgs.push(args[i]);
}
const serverArgs = [fileURLToPath(new URL('./server.mjs', import.meta.url)), '--browser', browser, '--port', String(port), ...forwardArgs];

async function probeHealth() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health?browser=${encodeURIComponent(browser)}`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

const health = await probeHealth();
if (health) {
  if (health.browser !== browser) throw new Error('Existing engine uses an old browser connection. Restart the engine service, not Edge.');
  console.log(JSON.stringify(health, null, 2));
} else if (foreground) {
  const child = spawn(process.execPath, serverArgs, { stdio: 'inherit', windowsHide: true });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
} else {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const logsDir = path.join(projectRoot, 'runtime', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const out = fs.openSync(path.join(logsDir, 'engine.log'), 'a');
  const child = spawn(process.execPath, serverArgs, { detached: true, windowsHide: true, stdio: ['ignore', out, out] });
  let spawnError = null;
  child.once('error', error => { spawnError = error; });
  child.unref();
  fs.closeSync(out);

  const deadline = Date.now() + 8000;
  let startedHealth = null;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    startedHealth = await probeHealth();
    if (startedHealth) break;
    await new Promise(r => setTimeout(r, 150));
  }
  if (!startedHealth) {
    const ep = inspectBrowserEndpoint(browser);
    throw new Error(`Browser Engine did not respond on :${port} (endpoint ok=${ep.ok}: ${ep.error || ep.port}); see runtime/logs/engine.log`);
  }
  console.log(JSON.stringify(startedHealth, null, 2));
}
