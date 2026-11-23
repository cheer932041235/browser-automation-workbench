import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import EventEmitter from 'node:events';
import CDPConnection from './core.mjs';
import SmartWaiter from './wait.mjs';
import PageAnalyzer from './page.mjs';
import DialogHandler from './dialog.mjs';
import NavigationTracker from './navigation.mjs';
import NetworkManager from './network.mjs';
import Pipeline from './pipeline.mjs';
import { inspectBrowserEndpoint } from './browsers.mjs';
import { SessionManager, projectRoot } from './sessions.mjs';
import { createWorkbench } from './workbench.mjs';

function createFakeCdp() {
  const cdp = new CDPConnection({ browser: 'chrome' });
  const sent = [];
  cdp.sessions.set('tabA', 'sidA');
  cdp.sessions.set('tabB', 'sidB');
  cdp.sendToTarget = async (targetId, method, params = {}) => {
    sent.push({ targetId, method, params });
    if (method === 'Runtime.evaluate' && params.expression === 'document.readyState') {
      return { result: { result: { value: 'loading' } } };
    }
    if (method === 'Runtime.evaluate' && params.expression === 'location.href') {
      return { result: { result: { value: 'https://example.com/start' } } };
    }
    return { result: {} };
  };
  cdp.emitTarget = (method, targetId, params = {}) => {
    const tset = cdp.targetHandlers.get(`${method}:${targetId}`);
    if (tset) {
      for (const entry of [...tset]) {
        entry.handler(params, cdp.sessions.get(targetId));
        if (entry.once) tset.delete(entry);
      }
    }
  };
  return { cdp, sent };
}

test('SmartWaiter isolates Page and Network events per targetId and ignores child frames', async () => {
  const { cdp } = createFakeCdp();
  const waiter = new SmartWaiter(cdp);

  const loadPromise = waiter.waitForPageLoad('tabA', 2000);
  await new Promise(r => setTimeout(r, 15));
  cdp.emitTarget('Page.loadEventFired', 'tabB', {});
  let settled = false;
  loadPromise.then(() => { settled = true; });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(settled, false);
  cdp.emitTarget('Page.loadEventFired', 'tabA', {});
  const loadResult = await loadPromise;
  assert.equal(loadResult.state, 'complete');
  assert.equal(loadResult.method, 'load-event');

  const navPromise = waiter.waitForNavigation('tabA', 2000);
  await new Promise(r => setTimeout(r, 15));
  cdp.emitTarget('Page.frameNavigated', 'tabA', { frame: { parentId: 'root', url: 'https://example.com/subframe' } });
  cdp.emitTarget('Page.loadEventFired', 'tabA', {});
  let navDone = false;
  navPromise.then(() => { navDone = true; });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(navDone, false);
  cdp.emitTarget('Page.frameNavigated', 'tabA', { frame: { url: 'https://example.com/next' } });
  cdp.emitTarget('Page.loadEventFired', 'tabA', {});
  const navResult = await navPromise;
  assert.equal(navResult.navigated, true);

  const netPromise = waiter.waitForNetworkIdle('tabA', 2000, { idleTime: 40 });
  await new Promise(r => setTimeout(r, 10));
  cdp.emitTarget('Network.requestWillBeSent', 'tabA', { requestId: 'r1', request: { url: 'https://example.com/api' } });
  cdp.emitTarget('Network.requestWillBeSent', 'tabB', { requestId: 'rB', request: { url: 'https://example.com/other' } });
  await new Promise(r => setTimeout(r, 50));
  cdp.emitTarget('Network.loadingFinished', 'tabA', { requestId: 'r1' });
  const netResult = await netPromise;
  assert.equal(netResult.idle, true);
  assert.equal(cdp.targetHandlers.size, 0);

  const urlPromise = waiter.waitForUrlChange('tabA', 'finish', 2000);
  await new Promise(r => setTimeout(r, 10));
  cdp.emitTarget('Page.navigatedWithinDocument', 'tabB', { url: 'https://example.com/finish' });
  cdp.emitTarget('Page.navigatedWithinDocument', 'tabA', { url: 'https://example.com/finish' });
  const urlResult = await urlPromise;
  assert.equal(urlResult.changed, true);
  assert.equal(urlResult.to, 'https://example.com/finish');
});

test('DialogHandler and NavigationTracker disable preserves NetworkManager target listeners and per-tab policies', async () => {
  const { cdp, sent } = createFakeCdp();
  const network = new NetworkManager(cdp);
  const dialog = new DialogHandler(cdp);
  const nav = new NavigationTracker(cdp);

  await network.enableMonitoring('tabA');
  await dialog.enable('tabA', { policy: 'dismiss' });
  await dialog.enable('tabB', { policy: 'accept', promptText: 'yes' });
  await nav.enable('tabA');

  cdp.emitTarget('Page.javascriptDialogOpening', 'tabA', { type: 'confirm', message: 'Leave?' });
  const tabAHandle = sent.filter(c => c.targetId === 'tabA' && c.method === 'Page.handleJavaScriptDialog').at(-1);
  assert.equal(tabAHandle.params.accept, false);

  dialog.disable('tabA');
  nav.disable('tabA');

  assert.equal(cdp.targetHandlers.has('Page.javascriptDialogOpening:tabA'), false);
  assert.equal(cdp.targetHandlers.has('Page.frameNavigated:tabA'), false);
  assert.equal(cdp.targetHandlers.has('Network.requestWillBeSent:tabA'), true);

  cdp.emitTarget('Network.requestWillBeSent', 'tabA', { requestId: 'req1', request: { url: 'https://example.com/data', method: 'GET' } });
  assert.equal(network.getRecentRequests({ targetId: 'tabA' }).length, 1);
});

test('PageAnalyzer isolates console logs per targetId and redacts secret input values', async () => {
  const { cdp } = createFakeCdp();
  const page = new PageAnalyzer(cdp);

  await page.enableConsoleCapture('tabA');
  await page.enableConsoleCapture('tabB');

  cdp.emitTarget('Runtime.consoleAPICalled', 'tabA', { type: 'log', args: [{ value: 'alpha' }] });
  cdp.emitTarget('Runtime.exceptionThrown', 'tabB', { exceptionDetails: { text: 'beta-err' } });

  assert.deepEqual(page.getConsoleLogs({ targetId: 'tabA' }).map(l => l.text), ['alpha']);
  assert.deepEqual(page.getConsoleLogs({ targetId: 'tabB' }).map(l => l.text), ['beta-err']);

  page.clearConsoleLogs('tabA');
  assert.equal(page.getConsoleLogs({ targetId: 'tabA' }).length, 0);
  assert.deepEqual(page.getConsoleLogs({ targetId: 'tabB' }).map(l => l.text), ['beta-err']);

  const mockEls = [
    {
      tagName: 'INPUT',
      type: 'password',
      autocomplete: 'current-password',
      value: 'super-secret-pw',
      textContent: '',
      placeholder: 'Enter password',
      name: 'pw',
      id: 'pw-box',
      labels: [],
      getBoundingClientRect: () => ({ width: 100, height: 24, top: 10 }),
      matches: () => true,
    },
    {
      tagName: 'INPUT',
      type: 'text',
      autocomplete: 'one-time-code',
      value: '654321',
      textContent: '',
      placeholder: 'OTP',
      name: 'otp',
      id: 'otp-box',
      labels: [],
      getBoundingClientRect: () => ({ width: 100, height: 24, top: 40 }),
      matches: () => true,
    },
    {
      tagName: 'INPUT',
      type: 'text',
      autocomplete: 'off',
      value: 'visible-query',
      textContent: '',
      placeholder: 'Search',
      name: 'q',
      id: 'search-box',
      labels: [],
      getBoundingClientRect: () => ({ width: 100, height: 24, top: 70 }),
      matches: () => true,
    },
  ];
  const fakeWindow = {
    innerHeight: 900,
    CSS: { escape: s => s },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    document: {
      body: { querySelectorAll: () => mockEls },
      querySelector: () => null,
      querySelectorAll: () => mockEls,
    },
  };
  fakeWindow.window = fakeWindow;
  const evalExpressions = [];
  const vmCdp = {
    sendToTarget: async (_tid, _method, params) => {
      evalExpressions.push(params.expression);
      const value = vm.runInNewContext(params.expression, fakeWindow);
      return { result: { result: { value } } };
    },
  };
  const vmPage = new PageAnalyzer(vmCdp);
  const interactive = await vmPage.getInteractiveElements('tabA');
  assert.equal(interactive.find(e => e.id === 'pw-box').text, 'Enter password');
  assert.equal(interactive.find(e => e.id === 'otp-box').text, 'OTP');
  assert.equal(interactive.find(e => e.id === 'search-box').text, 'visible-query');

  const forms = await vmPage.getFormFields('tabA');
  assert.equal(forms.find(f => f.id === 'pw-box').value, '[REDACTED]');
  assert.equal(forms.find(f => f.id === 'otp-box').value, '[REDACTED]');
  assert.equal(forms.find(f => f.id === 'search-box').value, 'visible-query');
});

test('Pipeline redacts sensitive/password fill results and counts raw string length on type', async () => {
  const pwInput = {
    tagName: 'INPUT',
    type: 'password',
    autocomplete: 'current-password',
    value: '',
    scrollIntoView() {},
    focus() {},
    dispatchEvent() {},
  };
  const textInput = {
    tagName: 'INPUT',
    type: 'text',
    autocomplete: 'off',
    value: '',
    scrollIntoView() {},
    focus() {},
    dispatchEvent() {},
  };
  const fakeWindow = {
    HTMLInputElement: { prototype: {} },
    HTMLTextAreaElement: { prototype: {} },
    KeyboardEvent: class { constructor(t, o) { this.t = t; this.o = o; } },
    Event: class { constructor(t, o) { this.t = t; this.o = o; } },
    setTimeout,
    document: {
      execCommand() {},
      querySelector(sel) {
        return sel === '#pw' ? pwInput : textInput;
      },
    },
  };
  const pipeline = new Pipeline({
    sendToTarget: async (_t, _m, params) => {
      const value = await vm.runInNewContext(params.expression, fakeWindow);
      return { result: { result: { value } } };
    },
  });
  const res = await pipeline.execute('t1', [
    { action: 'fill', selector: '#pw', value: 'SecretPass!' },
    { action: 'fill', selector: '#txt', value: 'TokenValue', sensitive: true },
    { action: 'type', selector: '#txt', text: 'a"b\nc', delay: 1 },
  ]);
  assert.equal(res.ok, true);
  assert.equal(res.results[0].value, '[REDACTED]');
  assert.equal(res.results[1].value, '[REDACTED]');
  assert.equal(res.results[2].len, 5);
});

test('inspectBrowserEndpoint validates DevToolsActivePort without probing sockets and CDPConnection runs onReconnect on demand', async () => {
  const dir = path.join(projectRoot, 'work/preflight-unit-test');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const missing = inspectBrowserEndpoint('edge', dir);
    assert.equal(missing.ok, false);
    assert.match(missing.error, /not found/);

    fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), 'not-a-port\n/bad\n');
    const invalid = inspectBrowserEndpoint('edge', dir);
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /invalid/);

    fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), '59888\r\n/devtools/browser/test-id\r\n');
    const valid = inspectBrowserEndpoint('edge', dir);
    assert.equal(valid.ok, true);
    assert.equal(valid.port, 59888);
    assert.equal(valid.wsPath, '/devtools/browser/test-id');

    const sockets = [];
    class FakeWS extends EventEmitter {
      constructor() {
        super();
        this.readyState = 0;
        sockets.push(this);
        queueMicrotask(() => { this.readyState = 1; this.emit('open'); });
      }
      close() { this.readyState = 3; this.emit('close'); }
    }
    const cdp = new CDPConnection({ browser: 'edge', userDataDir: dir, WebSocket: FakeWS });
    let reconnectCount = 0;
    cdp.onReconnect(() => { reconnectCount++; });
    await cdp.connect();
    assert.equal(reconnectCount, 0);
    sockets[0].close();
    assert.equal(cdp.connected, false);
    await cdp.connect();
    assert.equal(cdp.connected, true);
    assert.equal(reconnectCount, 1);
    sockets[1].close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionManager supports idleTimeoutMinutes and sampleMetrics safely', async () => {
  const root = path.join(projectRoot, 'work/metrics-unit-test');
  fs.rmSync(root, { recursive: true, force: true });
  let nowMs = 100_000;
  const manager = new SessionManager({ root, idleTimeoutMs: 600_000, now: () => nowMs });
  try {
    assert.throws(() => manager.create({ id: 'bad-idle', idleTimeoutMinutes: -1 }), /non-negative/);
    const created = manager.create({ id: 'fast-idle', idleTimeoutMinutes: 0.01 });
    assert.equal(created.idleTimeoutMinutes, 0.01);
    const listed = manager.list().find(s => s.id === 'fast-idle');
    assert.equal(listed.idleTimeoutMs, 600);

    const closed = [];
    const ctx = {
      session: manager.get('fast-idle'),
      cdp: { connected: true, send: async () => { ctx.cdp.connected = false; }, ws: { addEventListener: () => {} } },
      tabs: { listAll: async () => [{ url: 'https://example.com/' }, { url: 'https://example.com/2' }] },
      network: { getDownloadStatus: () => ({ inProgress: 0 }) },
      exitPromise: Promise.resolve(),
      lastActiveAt: nowMs,
    };
    manager.contexts.set('fast-idle', ctx);
    manager.update('fast-idle', { state: 'running', pid: process.pid });
    await manager.sampleMetrics({ ttlMs: 0 });
    const sampled = manager.list().find(s => s.id === 'fast-idle');
    assert.equal(sampled.pageCount, 2);
    if (process.platform === 'win32') assert.ok(sampled.memoryMB === null || sampled.memoryMB > 0);

    nowMs += 700;
    const reaped = await manager.reapIdle();
    closed.push(...reaped);
    assert.deepEqual(closed, ['fast-idle']);

    const staleHuman = path.join(root, 'stale-human');
    fs.mkdirSync(staleHuman, { recursive: true });
    fs.writeFileSync(path.join(staleHuman, 'sessions.json'), JSON.stringify([
      { id: 'dead-run-human', mode: 'managed', state: 'running', pid: 9999997, needsHuman: { reason: 'check', url: 'https://example.com/' } },
    ], null, 2));
    const reconciled = new SessionManager({ root: staleHuman });
    assert.equal(reconciled.get('dead-run-human').state, 'waiting_human');
    assert.equal(reconciled.get('dead-run-human').pid, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('browser_page_screenshot and browser_page_check manage emulation locks and always clear device metrics', async () => {
  const root = path.join(projectRoot, 'work/workbench-feature-test');
  fs.rmSync(root, { recursive: true, force: true });
  const manager = new SessionManager({ root });
  const app = createWorkbench({ sessions: manager, idleCheckIntervalMs: 0 });
  const calls = [];
  let failCheck = false;
  try {
    manager.create({ id: 'feat-sess', allowedUrls: ['https://example.com/'] });
    manager.contexts.set('feat-sess', {
      session: manager.get('feat-sess'),
      cdp: {
        connected: true,
        sendToTarget: async (targetId, method, params) => {
          calls.push({ targetId, method, params });
          if (method === 'Runtime.evaluate' && params.expression?.includes('horizontalOverflow')) {
            if (failCheck) throw new Error('simulated failure');
            const w = calls.filter(c => c.method === 'Emulation.setDeviceMetricsOverride').at(-1)?.params?.width || 1440;
            const isMobile = w <= 480;
            return {
              result: {
                result: {
                  value: JSON.stringify({
                    url: 'https://example.com/',
                    title: 'Example',
                    readyState: 'complete',
                    innerWidth: w,
                    innerHeight: 900,
                    scrollWidth: isMobile ? 430 : w,
                    scrollHeight: 1200,
                    horizontalOverflow: isMobile,
                    overflowPx: isMobile ? 40 : 0,
                    overflowingElements: isMobile ? [{ tag: 'div', selector: 'div.wide', left: 0, right: 430, width: 430 }] : [],
                    images: { total: 2, loaded: 1, brokenCount: 1, broken: [{ src: 'https://example.com/missing.png', alt: 'Missing' }] },
                  }),
                },
              },
            };
          }
          if (method === 'Page.captureScreenshot') {
            return { result: { data: Buffer.from('fake-png').toString('base64') } };
          }
          return { result: {} };
        },
      },
      tabs: { requirePage: async () => ({ targetId: 'p1', url: 'https://example.com/' }) },
      network: { getDownloadStatus: () => ({ inProgress: 0 }) },
    });

    if (process.platform === 'win32') {
      await assert.rejects(() => app.dispatch('browser_page_screenshot', {
        sessionId: 'feat-sess', pageId: 'p1', filePath: 'C:/tmp/forbidden.png',
      }), /C: root\/temp\/Desktop/);
    }

    const shotFile = path.join(root, 'shots/custom.png');
    const shotRes = await app.dispatch('browser_page_screenshot', {
      sessionId: 'feat-sess', pageId: 'p1', filePath: shotFile, width: 390, height: 844, mobile: true, deviceScaleFactor: 2,
    });
    assert.equal(shotRes.filePath, shotFile);
    assert.equal(fs.readFileSync(shotFile, 'utf8'), 'fake-png');
    assert.equal(calls.find(c => c.method === 'Emulation.setDeviceMetricsOverride').params.mobile, true);
    assert.ok(calls.some(c => c.method === 'Emulation.clearDeviceMetricsOverride'));

    calls.length = 0;
    const checkDir = path.join(root, 'check-shots');
    const checkRes = await app.dispatch('browser_page_check', {
      sessionId: 'feat-sess', pageId: 'p1', screenshotDir: checkDir,
    });
    assert.equal(checkRes.passed, false);
    assert.equal(checkRes.viewports.length, 2);
    assert.equal(checkRes.viewports[0].horizontalOverflow, false);
    assert.equal(checkRes.viewports[1].horizontalOverflow, true);
    assert.equal(checkRes.viewports[1].overflowPx, 40);
    assert.equal(checkRes.viewports[1].images.brokenCount, 1);
    assert.equal(fs.existsSync(path.join(checkDir, 'viewport-1440px.png')), true);
    assert.equal(fs.existsSync(path.join(checkDir, 'viewport-390px.png')), true);
    assert.equal(calls.filter(c => c.method === 'Emulation.clearDeviceMetricsOverride').length, 1);

    calls.length = 0;
    const desktopCtx = manager.contexts.get('feat-sess');
    desktopCtx.session.engine = 'desktop';
    desktopCtx.session.execution = 'background';
    const desktopCaptures = [];
    const mockDesktop = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      desktopCaptures.push({ url: req.url, body: JSON.parse(body || '{}') });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: Buffer.from('desktop-png').toString('base64') }));
    });
    await new Promise(r => mockDesktop.listen(0, '127.0.0.1', r));
    fs.writeFileSync(path.join(desktopCtx.session.profile, 'desktop-control.json'), JSON.stringify({ port: mockDesktop.address().port, pid: process.pid }));
    try {
      const desktopShotOut = await app.dispatch('browser_page_screenshot', {
        sessionId: 'feat-sess', pageId: 'p1', filePath: path.join(root, 'shots/desktop.png'), width: 1280, height: 800,
      });
      assert.equal(desktopShotOut.bytes, Buffer.from('desktop-png').length);
      assert.equal(desktopCaptures.at(-1).url, '/capture');
      assert.equal(desktopCaptures.at(-1).body.width, 1280);

      await app.dispatch('browser_page_check', {
        sessionId: 'feat-sess', pageId: 'p1', widths: [390], screenshotDir: checkDir,
      });
      assert.equal(desktopCaptures.at(-1).url, '/capture');
      assert.equal(desktopCaptures.at(-1).body.width, 390);
      assert.equal(fs.readFileSync(path.join(checkDir, 'viewport-390px.png'), 'utf8'), 'desktop-png');
    } finally {
      desktopCtx.session.engine = 'native';
      mockDesktop.closeAllConnections();
      await new Promise(r => mockDesktop.close(r));
    }

    calls.length = 0;
    failCheck = true;
    await assert.rejects(() => app.dispatch('browser_page_check', { sessionId: 'feat-sess', pageId: 'p1' }), /simulated failure/);
    assert.equal(calls.filter(c => c.method === 'Emulation.clearDeviceMetricsOverride').length, 1);
  } finally {
    app.server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
