import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import CDPConnection from '../packages/browser-engine/core.mjs';
import TabManager from '../packages/browser-engine/tabs.mjs';
import FrameManager from '../packages/browser-engine/frames.mjs';
import NetworkManager from '../packages/browser-engine/network.mjs';
import Interactor from '../packages/browser-engine/interact.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = path.join(root, 'work/engine-acceptance/profile');
const output = path.join(root, 'outputs/engine-acceptance');
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(output, { recursive: true });
await fs.rm(path.join(profile, 'DevToolsActivePort'), { force: true });
let childOrigin;
const fixture = http.createServer((req, res) => {
  if (req.url.startsWith('/api')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ page: req.url })); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(req.url === '/inner' ? '<button id="nested" onclick="this.textContent=\'clicked\'">nested button</button>' :
    `<title>Engine fixture</title><h1>Page ${req.url}</h1><input id="input"><textarea id="note"></textarea><div id="later"></div><script>setTimeout(()=>document.querySelector('#later').textContent='ready',100)</script><iframe src="${childOrigin}/frame"></iframe>`);
});
const childFixture = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<input id="input"><textarea id="note"></textarea><button id="child" onclick="this.textContent='clicked'">frame button</button><iframe src="${origin}/inner"></iframe>`); });
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => childFixture.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${fixture.address().port}`;
childOrigin = `http://localhost:${childFixture.address().port}`;
const browser = spawn(process.env.BROWSER_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--site-per-process', 'about:blank'],
  { windowsHide: true, stdio: 'ignore', env: { ...process.env, TEMP: path.dirname(profile), TMP: path.dirname(profile) } });
const exited = new Promise(resolve => browser.once('exit', resolve));
const cdp = new CDPConnection({ browser: 'chrome', userDataDir: profile });
const evidence = { checks: [], startedAt: new Date().toISOString() };
try {
  const deadline = Date.now() + 15000;
  while (true) {
    try { await fs.access(path.join(profile, 'DevToolsActivePort')); break; }
    catch (error) { if (Date.now() > deadline || browser.exitCode !== null) throw error; await new Promise(r => setTimeout(r, 100)); }
  }
  await cdp.connect();
  const tabs = new TabManager(cdp), frames = new FrameManager(cdp), network = new NetworkManager(cdp);
  const a = await tabs.openExact(origin + '/a');
  assert.equal((await tabs.openExact(origin + '/a')).targetId, a.targetId);
  const b = await tabs.openExact(origin + '/b');
  assert.notEqual(a.targetId, b.targetId);
  evidence.checks.push('exact page reuse and separate paths');
  assert.equal((await tabs.inspect(a.targetId)).url, origin + '/a');
  const later = await cdp.sendToTarget(a.targetId, 'Runtime.evaluate', { expression: 'new Promise(resolve=>{const el=document.querySelector("#later");if(el.textContent) return resolve(el.textContent);const observer=new MutationObserver(()=>{observer.disconnect();resolve(el.textContent)});observer.observe(el,{childList:true})})', awaitPromise: true, returnByValue: true });
  assert.equal(later.result.result.value, 'ready');
  evidence.checks.push('live URL and asynchronous DOM');
  const before = await frames.listFrames(a.targetId);
  evidence.frames = before;
  const child = before.find(f => f.url.startsWith(childOrigin));
  assert.ok(child, 'cross-site frame must be enumerated');
  const click = await frames.clickInFrame(a.targetId, child.frameId, '#child');
  assert.equal(click.value?.clicked, true);
  evidence.checks.push('cross-site iframe click');
  const interact=new Interactor(cdp);
  for(const selector of ['#input','#note']){
    assert.equal((await interact.fill(a.targetId,selector,'main page note')).value.value,'main page note');
    assert.equal((await frames.fillInFrame(a.targetId,child.frameId,selector,'iframe note')).value.value,'iframe note');
  }
  assert.equal((await interact.eval(a.targetId,"document.querySelector('#note').value")).value,'main page note');
  assert.equal((await frames.evalInFrame(a.targetId,child.frameId,"document.querySelector('#note').value")).value,'iframe note');
  evidence.checks.push('input and textarea fill on the main page and cross-site iframe');
  const nested=(await frames.listFrames(a.targetId)).find(f=>f.url===origin+'/inner');
  assert.ok(nested);assert.equal(nested.depth,2);
  assert.equal((await frames.clickInFrame(a.targetId,nested.frameId,'#nested')).value.clicked,true);
  evidence.checks.push('nested cross-process iframe click');
  await assert.rejects(() => frames.evalInFrame(b.targetId, child.frameId, 'document.title'));
  evidence.checks.push('foreign frame rejected');
  await network.enableMonitoring(a.targetId); await network.enableMonitoring(b.targetId);
  await Promise.all([a,b].map(t => cdp.sendToTarget(t.targetId,'Runtime.evaluate', {expression:`fetch('/api?owner=${t.targetId}').then(r=>r.json())`,awaitPromise:true,returnByValue:true})));
  const ar = network.getRecentRequests({targetId:a.targetId});
  const br = network.getRecentRequests({targetId:b.targetId});
  assert.ok(ar.length > 0 && br.length > 0);
  assert.ok(ar.every(r=>r.targetId===a.targetId)); assert.ok(br.every(r=>r.targetId===b.targetId));
  evidence.checks.push('two-page network ownership');
  await tabs.close(a.targetId);
  await assert.rejects(() => tabs.inspect(a.targetId), {code:'PAGE_NOT_FOUND'});
  assert.equal((await tabs.inspect(b.targetId)).url, origin + '/b');
  evidence.checks.push('closed page does not select another page');
  evidence.passed = true;
} catch (error) { evidence.passed = false; evidence.error = error.stack; process.exitCode = 1; }
finally {
  if (cdp.connected) await cdp.send('Browser.close');
  await exited;
  fixture.closeAllConnections(); childFixture.closeAllConnections();
  await Promise.all([new Promise(r=>fixture.close(r)),new Promise(r=>childFixture.close(r))]);
  await fs.writeFile(path.join(output, process.argv.includes('--before') ? 'iframe-before.json' : 'result.json'), JSON.stringify(evidence, null, 2));
}
console.log(JSON.stringify(evidence, null, 2));
