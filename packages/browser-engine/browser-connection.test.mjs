import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { browserProfile, readBrowserEndpoint } from './browsers.mjs';
import CDPConnection from './core.mjs';
import TabManager from './tabs.mjs';

test('Edge and Chrome use separate profiles and reject unknown browsers', () => {
  assert.notEqual(browserProfile('edge'), browserProfile('chrome'));
  assert.throws(() => browserProfile('xiaodouya'), /Unknown browser/);
});

test('discovery reads only the selected profile, including CRLF', async () => {
  const dir = path.resolve('work/browser-connection-test');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), '54321\r\n/devtools/browser/example\r\n');
    const cdp = new CDPConnection({ browser: 'edge', userDataDir: dir });
    cdp.checkPort = () => { throw new Error('Must not probe another endpoint'); };
    assert.equal((await cdp.discoverPort()).port, 54321);
    assert.equal(readBrowserEndpoint('edge', dir).wsPath, '/devtools/browser/example');
    fs.unlinkSync(path.join(dir, 'DevToolsActivePort'));
    await assert.rejects(cdp.discoverPort(), /enable remote debugging/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('separate clients reuse a browser tab without creating or navigating it', async () => {
  const calls = [];
  const cdp = { send: async (method) => {
    calls.push(method);
    assert.equal(method, 'Target.getTargets');
    return { result: { targetInfos: [{ type: 'page', targetId: 'existing', url: 'https://www.goofish.com/', title: '闲鱼' }] } };
  } };
  for (let i = 0; i < 2; i++) {
    const tabs = new TabManager(cdp);
    const result = await tabs.open('https://www.goofish.com/');
    assert.equal(result.targetId, 'existing');
    assert.equal(result.reused, true);
    assert.equal(tabs.managedTabs.size, 0);
  }
  assert.deepEqual(calls, ['Target.getTargets', 'Target.getTargets']);
});

test('opening a site preserves its current search or product page', async () => {
  const tabs = new TabManager({ send: async () => ({ result: { targetInfos: [
    { type: 'page', targetId: 'search', url: 'https://www.goofish.com/search?q=test', title: 'Search' }
  ] } }) });
  assert.equal((await tabs.open('https://www.goofish.com/')).targetId, 'search');
});
