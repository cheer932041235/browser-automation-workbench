import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-cli-test-'));
const baseEnv = { ...process.env, BI_LOGS_DIR: tempRoot };

function runCli(args) {
  return spawnSync(process.execPath, ['scripts/bi.mjs', ...args], {
    cwd: projectRoot,
    env: baseEnv,
    encoding: 'utf8',
  });
}

test('help command lists core, engine, and recorder commands', () => {
  const result = runCli(['help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Browser Intelligence CLI/);
  assert.match(result.stdout, /engine tabs/);
  assert.match(result.stdout, /record start/);
});

test('version command reports 0.3.0', () => {
  const result = runCli(['version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Version\s+0\.3\.0/);
});

test('docs command resolves cli document', () => {
  const result = runCli(['docs', 'cli']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Doc: cli/);
  assert.match(result.stdout, /docs\\cli\.md|docs\/cli\.md/);
  assert.match(result.stdout, /Exists\s+OK/);
});

test('record status is safe with no active recording', () => {
  const result = runCli(['record', 'status']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No active recording/);
  assert.equal(fs.existsSync(path.join(tempRoot, 'recording-state.json')), false);
});

test('record start without url or target fails before creating trace directory', () => {
  const result = runCli(['record', 'start', 'test-no-url']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing --url or --target/);
  assert.equal(fs.existsSync(path.join(tempRoot, 'traces', 'test-no-url')), false);
});

test('record mark without active recording fails safely', () => {
  const result = runCli(['record', 'mark', 'offline', 'test']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No active recording/);
  assert.equal(fs.existsSync(path.join(tempRoot, 'recording-state.json')), false);
});

test('record stop without active recording fails safely', () => {
  const result = runCli(['record', 'stop']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No active recording/);
  assert.equal(fs.existsSync(path.join(tempRoot, 'recording-state.json')), false);
});

test('unknown command returns a clear error', () => {
  const result = runCli(['unknown-command']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command/);
});

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
