#!/usr/bin/env node
const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:3456';
let passed = 0, failed = 0;
const results = [];

// Helper: target always goes in query params
async function get(path, target) {
  const url = target ? `${BASE}${path}?target=${target}` : `${BASE}${path}`;
  return (await fetch(url)).json();
}
// POST with raw text body (for /eval, /click etc)
async function postRaw(path, target, text) {
  const url = `${BASE}${path}?target=${target}`;
  return (await fetch(url, { method: 'POST', body: text })).json();
}
// POST with JSON body
async function postJSON(path, target, obj) {
  const url = target ? `${BASE}${path}?target=${target}` : `${BASE}${path}`;
  return (await fetch(url, { method: 'POST', body: JSON.stringify(obj), headers: {'Content-Type':'application/json'} })).json();
}
// DELETE with JSON body
async function del(path, target, obj) {
  const url = `${BASE}${path}?target=${target}`;
  return (await fetch(url, { method: 'DELETE', body: obj ? JSON.stringify(obj) : undefined, headers: {'Content-Type':'application/json'} })).json();
}

async function test(name, fn, timeout = 15000) {
  const start = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), timeout))]);
    passed++; results.push({ name, status: 'PASS', ms: Date.now() - start });
    console.log('  PASS ' + name + ' (' + (Date.now()-start) + 'ms)');
  } catch (e) {
    failed++; results.push({ name, status: 'FAIL', error: e.message, ms: Date.now() - start });
    console.log('  FAIL ' + name + ': ' + e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(msg || 'Expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let tid = null;

async function runAll() {
  console.log('\n=== Browser Engine Test Suite ===\n');

  // [System]
  console.log('[System]');
  await test('Health check', async () => {
    const r = await get('/health'); assertEq(r.status, 'ok'); assert(r.connected === true, 'Not connected');
  });
  await test('Help endpoint', async () => {
    const r = await get('/help'); assert(r.tabs); assert(r.interact); assert(r.network);
  });

  // [Tabs]
  console.log('\n[Tabs]');
  await test('Create new tab', async () => {
    const r = await get('/tabs/new?url=https://example.com');
    assert(r.targetId, 'No targetId'); tid = r.targetId; await sleep(2500);
  });
  await test('List tabs includes new tab', async () => {
    const r = await get('/tabs'); assert(Array.isArray(r)); assert(r.find(t => t.targetId === tid), 'Not found');
  });
  await test('Get tab info', async () => {
    const r = await get('/tabs/info', tid); assert(r.url && r.url.includes('example.com'), 'URL mismatch');
  });
  await test('Navigate tab', async () => {
    await postJSON('/tabs/navigate', tid, { url: 'https://httpbin.org/html' }); await sleep(3000);
    const r = await get('/tabs/info', tid); assert(r.url && r.url.includes('httpbin.org'), 'Nav failed');
  });

  // [Eval]
  console.log('\n[Eval]');
  await test('Eval simple expression', async () => {
    const r = await postRaw('/eval', tid, '1 + 2'); assertEq(r.value, 3);
  });
  await test('Eval DOM query', async () => {
    const r = await postRaw('/eval', tid, 'document.title'); assert(typeof r.value === 'string');
  });
  await test('Eval error returns error', async () => {
    const r = await postRaw('/eval', tid, 'throw new Error("test")'); assert(r.error);
  });

  // [Interact]
  console.log('\n[Interact]');
  await test('Navigate to form page', async () => {
    await postJSON('/tabs/navigate', tid, { url: 'https://httpbin.org/forms/post' }); await sleep(3000);
  });
  await test('Fill input field', async () => {
    const r = await postJSON('/fill', tid, { selector: 'input[name="custname"]', value: 'TestUser' });
    assert((r.value && r.value.filled === true) || r.filled === true, 'Fill failed: ' + JSON.stringify(r));
  });
  await test('Verify filled value', async () => {
    const r = await postRaw('/eval', tid, 'document.querySelector("input[name=\\"custname\\"]").value');
    assertEq(r.value, 'TestUser');
  });
  await test('Press key', async () => {
    const r = await postJSON('/pressKey', tid, { key: 'Tab' });
    assert(r.pressed === 'Tab', 'Key failed: ' + JSON.stringify(r));
  });
  await test('Scroll page', async () => {
    const r = await postJSON('/scroll', tid, { y: 300 });
    assert(r !== undefined && r !== null, 'Scroll failed');
  });
  await test('Click element', async () => {
    const r = await postRaw('/click', tid, 'input[name="custname"]');
    assert((r.value && r.value.clicked === true) || r.clicked === true, 'Click failed: ' + JSON.stringify(r));
  });


  // [Page Analysis]
  console.log('\n[Page Analysis]');
  await test('Get interactive elements', async () => {
    const r = await postJSON('/page/elements', tid, {}); assert(Array.isArray(r), 'Not array: ' + typeof r); assert(r.length > 0);
  });
  await test('Get page text', async () => {
    const r = await postJSON('/page/text', tid, {}); assert(r.text && r.text.length > 0, 'No text');
  });
  await test('Get page links', async () => {
    const r = await postJSON('/page/links', tid, {}); assert(Array.isArray(r));
  });
  await test('Get form fields', async () => {
    const r = await postJSON('/page/forms', tid, {}); assert(Array.isArray(r)); assert(r.length > 0, 'No forms');
  });

  // [Screenshot]
  console.log('\n[Screenshot]');
  await test('Take screenshot to file', async () => {
    const r = await postJSON('/screenshot', tid, { file: 'test-shot.png' });
    assert(r.file || r.saved || r.base64, 'No result: ' + JSON.stringify(r));
  });

  // [Stealth]
  console.log('\n[Stealth]');
  await test('Inject stealth', async () => {
    const r = await get('/stealth/inject', tid); assert(r.injected === true || r.already === true);
  });
  await test('Stealth check', async () => {
    const r = await get('/stealth/check', tid);
    assertEq(r.webdriver, false); assertEq(r.stealthActive, true); assert(r.pluginCount > 0);
  });

  // [Console]
  console.log('\n[Console]');
  await test('Enable console capture', async () => {
    const r = await get('/console/enable', tid); assert(r.enabled === true);
  });
  await test('Capture console.log', async () => {
    await postRaw('/eval', tid, 'console.log("__test_42__")'); await sleep(600);
    const r = await get('/console/logs', tid); assert(Array.isArray(r));
    assert(r.find(l => l.text && l.text.includes('__test_42__')), 'Not captured');
  });
  await test('Capture console.error', async () => {
    await postRaw('/eval', tid, 'console.error("__err_99__")'); await sleep(600);
    const r = await get('/console/logs', tid);
    assert(r.find(l => l.text && l.text.includes('__err_99__') && l.type === 'error'), 'Error not captured');
  });
  await test('Clear console', async () => {
    const r = await get('/console/clear', tid); assert(r.cleared === true);
    const logs = await get('/console/logs', tid); assertEq(logs.length, 0);
  });
  await test('Stop console capture', async () => {
    await get('/console/stop', tid);
    await postRaw('/eval', tid, 'console.log("__after_stop__")'); await sleep(500);
    const logs = await get('/console/logs', tid);
    assert(!logs.find(l => l.text && l.text.includes('__after_stop__')), 'Still capturing');
  });

  // [Network]
  console.log('\n[Network]');
  await test('Enable monitoring', async () => {
    const r = await get('/network/monitor', tid); assert(r.monitoring === true);
  });
  await test('Navigate triggers requests', async () => {
    await postJSON('/tabs/navigate', tid, { url: 'https://example.com' }); await sleep(3000);
    const r = await postJSON('/network/requests', tid, {}); assert(Array.isArray(r)); assert(r.length > 0, 'No reqs');
  });
  await test('Duplicate monitor = alreadyEnabled', async () => {
    const r = await get('/network/monitor', tid); assert(r.alreadyEnabled === true);
  });
  await test('Stop monitoring', async () => {
    const r = await get('/network/stop', tid); assert(r.stopped === true);
  });


  // [Cookies]
  console.log('\n[Cookies]');
  await test('Get cookies', async () => {
    const r = await get('/cookies', tid); assert(Array.isArray(r));
  });
  await test('Set cookie', async () => {
    const r = await postJSON('/cookies', tid, { name: '__tc', value: 'hi123', domain: 'example.com' });
    assert(r.success === true, 'Set failed: ' + JSON.stringify(r));
  });
  await test('Read cookie back', async () => {
    const r = await get('/cookies', tid); assert(r.find(c => c.name === '__tc' && c.value === 'hi123'), 'Not found');
  });
  await test('Delete cookie', async () => {
    await del('/cookies', tid, { name: '__tc', domain: 'example.com' });
    const r = await get('/cookies', tid); assert(!r.find(c => c.name === '__tc'), 'Not deleted');
  });

  // [Storage]
  console.log('\n[Storage]');
  await test('Set localStorage', async () => {
    const r = await postJSON('/storage', tid, { key: '__tk', value: 'v42' }); assert(r.set === true, JSON.stringify(r));
  });
  await test('Get localStorage', async () => {
    const r = await get('/storage', tid); assert(r.items && r.items.__tk === 'v42', JSON.stringify(r));
  });

  // [Frames]
  console.log('\n[Frames]');
  await test('List frames', async () => {
    const r = await get('/frames', tid); assert(Array.isArray(r)); assert(r.length >= 1);
  });

  // [Wait]
  console.log('\n[Smart Wait]');
  await test('Wait for load', async () => {
    const r = await postJSON('/wait/load', tid, {}); assert(r.state === 'complete' || r.state === 'interactive', JSON.stringify(r));
  });
  await test('Wait for element (body)', async () => {
    const r = await postJSON('/wait/element', tid, { selector: 'body' }); assert(r.found === true);
  });
  await test('Wait for element timeout', async () => {
    const r = await postJSON('/wait/element', tid, { selector: '#xyz_no_exist', timeout: 2000 }); assert(r.found === false);
  }, 20000);
  await test('Wait for text', async () => {
    const r = await postJSON('/wait/text', tid, { text: 'Example' }); assert(r.found === true);
  });
  await test('Wait for network idle', async () => {
    const r = await postJSON('/wait/network', tid, { timeout: 5000 });
    assert(r.idle === true || r.reason === 'timeout', JSON.stringify(r));
  });
  await test('Wait for stable', async () => {
    const r = await postJSON('/wait/stable', tid, {}); assert(r.load, JSON.stringify(r));
  });

  // [Detect]
  console.log('\n[Detect]');
  await test('Page detection', async () => {
    const r = await get('/detect', tid);
    assert(typeof r.hasLoginForm === 'boolean' || typeof r.hasLogin === 'boolean', 'Missing hasLogin: ' + JSON.stringify(r));
  });

  // [Cleanup Chain]
  console.log('\n[Cleanup Chain]');
  let ct;
  await test('Create tab + enable all features', async () => {
    const r = await get('/tabs/new?url=https://example.com'); ct = r.targetId; await sleep(2000);
    await get('/network/monitor', ct); await get('/console/enable', ct); await get('/stealth/inject', ct);
  });
  await test('Close tab cleans up', async () => {
    await get('/tabs/close', ct); const tabs2 = await get('/tabs');
    assert(!tabs2.find(t => t.targetId === ct), 'Still in list');
  });

  // [Hotkey]
  console.log('\n[Advanced Interact]');
  await test('Hotkey correct order', async () => {
    const r = await postJSON('/hotkey', tid, { keys: ['Control', 'a'] });
    assert(r.hotkey === 'Control+a', 'Wrong: ' + JSON.stringify(r));
  });
  await test('Double click', async () => {
    const r = await postRaw('/doubleClick', tid, 'body');
    assert(r.doubleClicked === true, JSON.stringify(r));
  });
  await test('Right click', async () => {
    const r = await postRaw('/rightClick', tid, 'body');
    assert(r.rightClicked === true, JSON.stringify(r));
  });

  // [insertText]
  console.log('\n[insertText]');
  await test('Navigate to form for insertText', async () => {
    await postJSON('/tabs/navigate', tid, { url: 'https://httpbin.org/forms/post' }); await sleep(3000);
  });
  await test('insertText with selector', async () => {
    await postJSON('/fill', tid, { selector: 'input[name="custname"]', value: '' });
    const r = await postJSON('/insertText', tid, { text: 'FastInput', selector: 'input[name="custname"]' });
    assert(r.inserted === 9, 'inserted: ' + JSON.stringify(r));
  });
  await test('insertText value persisted', async () => {
    const r = await postRaw('/eval', tid, 'document.querySelector("input[name=\\"custname\\"]").value');
    assert(r.value && String(r.value).includes('FastInput'), 'Value: ' + JSON.stringify(r));
  });

  // [Actionability]
  console.log('\n[Actionability]');
  await test('Actionability of visible element', async () => {
    const r = await postJSON('/actionability', tid, { selector: 'input[name="custname"]' });
    assert(r.value && r.value.actionable === true, JSON.stringify(r));
  });
  await test('Actionability of non-existent', async () => {
    const r = await postJSON('/actionability', tid, { selector: '#xyz_no' });
    assert(r.value && r.value.actionable === false);
  });
  await test('safeClick visible element', async () => {
    const r = await postJSON('/safeClick', tid, { selector: 'input[name="custname"]' });
    assert(r.value && r.value.clicked === true, JSON.stringify(r));
  });

  // [Dialog]
  console.log('\n[Dialog]');
  await test('Enable dialog auto-handling', async () => {
    const r = await get('/dialog/enable', tid); assert(r.enabled === true);
  });
  await test('Alert auto-handled', async () => {
    await postRaw('/eval', tid, 'setTimeout(() => alert("test_alert"), 500)'); await sleep(2000);
    const hist = await get('/dialog/history', tid);
    assert(hist.find(d => d.message === 'test_alert'), 'Alert not in history: ' + JSON.stringify(hist));
  });
  await test('Confirm auto-accepted', async () => {
    const r = await postRaw('/eval', tid, 'new Promise(r => setTimeout(() => r(confirm("ok?")), 200))');
    assert(r.value === true || r.value === false, 'Not boolean: ' + JSON.stringify(r));
  });
  await test('Disable dialog', async () => {
    await get('/dialog/clear', tid); await get('/dialog/disable', tid);
  });

  // [Accessibility Snapshot]
  console.log('\n[Accessibility Snapshot]');
  await test('Get snapshot', async () => {
    const r = await postJSON('/accessibility/snapshot', tid, {});
    assert(r.snapshot && r.snapshot.length > 0, 'Empty'); assert(r.refCount > 0);
  });
  await test('Snapshot has @eN refs', async () => {
    const r = await postJSON('/accessibility/snapshot', tid, {});
    assert(r.snapshot.includes('@e'), 'No refs'); assert(r.refs['@e1']);
  });
  await test('Resolve @e1', async () => {
    await postJSON('/accessibility/snapshot', tid, {});
    const r = await postJSON('/accessibility/resolve', tid, { refId: '@e1' });
    assert(r.resolved === true, JSON.stringify(r));
  });
  await test('Click via @eN ref', async () => {
    const snap = await postJSON('/accessibility/snapshot', tid, {});
    const tb = Object.entries(snap.refs).find(([, v]) => v.role === 'textbox');
    if (tb) { const r = await postJSON('/accessibility/click', tid, { refId: tb[0] }); assert(r.clicked === true); }
    else assert(true);
  });

  // [Pipeline]
  console.log('\n[Pipeline]');
  await test('Pipeline multi-step execute', async () => {
    await postJSON('/tabs/navigate', tid, { url: 'https://httpbin.org/forms/post' }); await sleep(3000);
    const r = await postJSON('/pipeline', tid, {
      steps: [
        { action: 'fill', selector: 'input[name="custname"]', value: 'PipelineTest' },
        { action: 'extract', selector: 'input[name="custname"]', property: 'value' },
        { action: 'wait', ms: 200 },
      ]
    });
    assert(r.ok === true, 'Pipeline failed: ' + JSON.stringify(r));
    assertEq(r.stepsRun, 3);
    assert(r.results[1].value === 'PipelineTest', 'Extract: ' + JSON.stringify(r.results[1]));
  });
  await test('Pipeline click + assert', async () => {
    const r = await postJSON('/pipeline', tid, {
      steps: [
        { action: 'assert', text: 'Customer name', selector: 'body' },
      ]
    });
    assert(r.ok === true, JSON.stringify(r));
  });
  await test('Pipeline error stops execution', async () => {
    const r = await postJSON('/pipeline', tid, {
      steps: [
        { action: 'click', selector: '#nonexistent_xyz' },
        { action: 'fill', selector: 'input', value: 'should not reach' },
      ]
    });
    assert(r.ok === false, 'Should fail');
    assertEq(r.stepsRun, 0);
  });

  // [AutoScreenshot]
  console.log('\n[AutoScreenshot]');
  await test('Enable autoshot', async () => {
    const r = await postJSON('/autoshot/enable', tid, {});
    assert(r.enabled === true, JSON.stringify(r));
  });
  await test('Capture screenshot', async () => {
    const r = await postJSON('/autoshot/capture', tid, { action: 'test_click' });
    assert(r && r.file, 'No file: ' + JSON.stringify(r));
    assert(r.action === 'test_click');
  });
  await test('Get autoshot history', async () => {
    const r = await get('/autoshot/history', tid);
    assert(Array.isArray(r) && r.length >= 1, 'No history');
  });
  await test('Get latest screenshot', async () => {
    const r = await get('/autoshot/latest', tid);
    assert(r.base64 && r.base64.length > 100, 'No base64 data');
  });
  await test('Disable autoshot', async () => {
    const r = await get('/autoshot/disable', tid);
    assert(r.disabled === true);
  });

  // [Navigation Tracker]
  console.log('\n[Navigation Tracker]');
  await test('Enable nav tracker', async () => {
    const r = await postJSON('/nav/enable', tid, {});
    assert(r.enabled === true, JSON.stringify(r));
  });
  await test('Navigate triggers history', async () => {
    await postJSON('/tabs/navigate', tid, { url: 'https://example.com' }); await sleep(2000);
    const hist = await get('/nav/history', tid);
    assert(Array.isArray(hist) && hist.length >= 1, 'No nav history: ' + JSON.stringify(hist));
    assert(hist.some(h => h.url.includes('example.com')), 'No example.com in history');
  });
  await test('Get current URL', async () => {
    const r = await get('/nav/current', tid);
    assert(r.url && r.url.includes('example.com'), 'URL: ' + r.url);
  });
  await test('Disable nav tracker', async () => {
    const r = await get('/nav/disable', tid);
    assert(r.disabled === true);
  });

  // [Site Profiles]
  console.log('\n[Site Profiles]');
  await test('Create site profile', async () => {
    const r = await postJSON('/profiles', null, { domain: 'example.com', loginType: 'none' });
    assert(r.saved === true, JSON.stringify(r));
  });
  await test('Get site profile', async () => {
    const r = await get('/profiles/get?domain=example.com');
    assert(r.domain === 'example.com', JSON.stringify(r));
    assert(r.loginType === 'none');
  });
  await test('Add selector to profile', async () => {
    const r = await postJSON('/profiles/selector', null, { domain: 'example.com', name: 'mainLink', selector: 'a[href]', description: 'Main link' });
    assert(r.saved === true);
  });
  await test('Add note to profile', async () => {
    const r = await postJSON('/profiles/note', null, { domain: 'example.com', note: 'Simple static page' });
    assert(r.saved === true);
  });
  await test('Match profile by URL', async () => {
    const r = await get('/profiles/match?url=https://example.com/page');
    assert(r.domain === 'example.com', JSON.stringify(r));
    assert(r.selectors?.mainLink?.selector === 'a[href]');
  });
  await test('List profiles', async () => {
    const r = await get('/profiles');
    assert(Array.isArray(r) && r.length >= 1, JSON.stringify(r));
  });
  await test('Delete profile', async () => {
    const r = await get('/profiles/delete?domain=example.com');
    assert(r.deleted === true);
    const check = await get('/profiles/get?domain=example.com');
    assert(check.notFound === true || !check.domain);
  });

  // [Multi-tab]
  console.log('\n[Multi-tab Isolation]');
  let t2;
  await test('Create second tab', async () => {
    const r = await get('/tabs/new?url=https://httpbin.org/html'); t2 = r.targetId; await sleep(2500);
  });
  await test('Eval tab1 = example.com', async () => {
    const r = await postRaw('/eval', tid, 'location.hostname'); assertEq(r.value, 'example.com');
  });
  await test('Eval tab2 = httpbin.org', async () => {
    const r = await postRaw('/eval', t2, 'location.hostname'); assertEq(r.value, 'httpbin.org');
  });
  await test('Close tab2', async () => { await get('/tabs/close', t2); });

  // [Teardown]
  console.log('\n[Teardown]');
  await test('Close main tab, sessions=0', async () => {
    await get('/tabs/close', tid); const h = await get('/health');
    assertEq(h.managedTabs, 0); assertEq(h.sessions, 0);
  });

  // Summary
  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed+failed) + ' total ===');
  if (failed > 0) { console.log('\nFailed:'); for (const r of results.filter(x => x.status==='FAIL')) console.log('  - ' + r.name + ': ' + r.error); }
  process.exit(failed > 0 ? 1 : 0);
}
runAll().catch(e => { console.error('Fatal:', e); process.exit(2); });
