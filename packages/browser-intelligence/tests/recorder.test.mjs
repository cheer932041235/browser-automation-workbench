import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-recorder-test-'));
process.env.BI_LOGS_DIR = tempRoot;

const recorder = await import('../scripts/lib/recorder.mjs');
const paths = await import('../scripts/lib/paths.mjs');

test('paths module respects BI_LOGS_DIR', () => {
  assert.equal(paths.logsDir, tempRoot);
  assert.equal(paths.tracesDir, path.join(tempRoot, 'traces'));
  assert.equal(paths.recordingStateFile, path.join(tempRoot, 'recording-state.json'));
});

test('safeTaskId keeps safe chars and replaces unsafe chars', () => {
  assert.equal(recorder.safeTaskId('abc-DEF_123.v1'), 'abc-DEF_123.v1');
  assert.equal(recorder.safeTaskId('杭州 活动/小红书'), '---------');
  assert.equal(recorder.safeTaskId(' task:name '), 'task-name');
});

test('parseFlags parses positional args, values, and boolean flags', () => {
  assert.deepEqual(recorder.parseFlags(['task1', '--url', 'https://example.com', '--force', 'extra']), {
    _: ['task1', 'extra'],
    url: 'https://example.com',
    force: true,
  });
});

test('taskPaths returns trace output files under temp traces directory', () => {
  const p = recorder.taskPaths('task/unsafe name');
  assert.equal(p.taskId, 'task-unsafe-name');
  assert.equal(p.taskDir, path.join(tempRoot, 'traces', 'task-unsafe-name'));
  assert.equal(p.traceFile, path.join(p.taskDir, 'trace.jsonl'));
  assert.equal(p.networkFile, path.join(p.taskDir, 'network.json'));
  assert.equal(p.summaryFile, path.join(p.taskDir, 'summary.md'));
});

test('active recording state can be saved, loaded, and cleared', () => {
  recorder.clearActiveState();
  assert.equal(recorder.loadActiveState(), null);

  const state = { taskId: 'unit-test', targetId: 'TARGET123', startedAt: '2026-05-20T00:00:00.000Z' };
  recorder.saveActiveState(state);
  assert.deepEqual(recorder.loadActiveState(), state);
  assert.equal(fs.existsSync(paths.recordingStateFile), true);

  recorder.clearActiveState();
  assert.equal(recorder.loadActiveState(), null);
});

test('markRecording requires an active state', () => {
  recorder.clearActiveState();
  assert.throws(() => recorder.markRecording(['hello']), /No active recording/);
});

test('stopRecording requires an active state before touching output files', async () => {
  recorder.clearActiveState();
  await assert.rejects(() => recorder.stopRecording([]), /No active recording/);
});

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
