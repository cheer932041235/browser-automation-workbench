#!/usr/bin/env node
// Browser Engine - 增强版浏览器自动化服务器
// 通过 CDP 连接用户日常 Edge/Chrome，提供完整的自动化 HTTP API
// 启动: node server.mjs [--port 3456] [--browser-port 59888]

import http from 'node:http';
import { URL } from 'node:url';
import CDPConnection from './core.mjs';
import TabManager from './tabs.mjs';
import Interactor from './interact.mjs';
import PageAnalyzer from './page.mjs';
import NetworkManager from './network.mjs';
import TaskManager from './tasks.mjs';
import FrameManager from './frames.mjs';
import StealthManager from './stealth.mjs';
import SmartWaiter from './wait.mjs';
import PageDetector from './detect.mjs';
import BatchProcessor from './batch.mjs';
import DialogHandler from './dialog.mjs';
import AccessibilitySnapshot from './accessibility.mjs';
import Pipeline from './pipeline.mjs';
import AutoScreenshot from './autoshot.mjs';
import NavigationTracker from './navigation.mjs';
import SiteProfiles from './profiles.mjs';

// --- 参数解析 ---
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}
const PORT = parseInt(getArg('--port', process.env.ENGINE_PORT || '3456'));
const BROWSER_PORT = getArg('--browser-port', process.env.BROWSER_PORT || null);

// --- 初始化模块 ---
const cdp = new CDPConnection();
const tabs = new TabManager(cdp);
const interact = new Interactor(cdp);
const waiter = new SmartWaiter(cdp);
const page = new PageAnalyzer(cdp, waiter);
const network = new NetworkManager(cdp);
const taskMgr = new TaskManager();
const frames = new FrameManager(cdp);
const stealth = new StealthManager(cdp);
const detector = new PageDetector(cdp);
const batch = new BatchProcessor(cdp, tabs, interact, page, stealth, waiter);
const dialog = new DialogHandler(cdp);
const axTree = new AccessibilitySnapshot(cdp);
const pipeline = new Pipeline(cdp);
const autoshot = new AutoScreenshot(cdp, page);
const navTracker = new NavigationTracker(cdp);
const profiles = new SiteProfiles();

// --- Tab 关闭时通知各模块清理 ---
tabs.onTabClose((targetId) => {
  stealth.onTargetClosed(targetId);
  network._cleanupTarget(targetId);
  page.onTargetClosed(targetId);
  dialog.onTargetClosed(targetId);
  axTree.onTargetClosed(targetId);
  autoshot.onTargetClosed(targetId);
  navTracker.onTargetClosed(targetId);
});

// --- 浏览器重连后重置所有模块状态 ---
cdp.onReconnect(() => {
  stealth.resetState();
  network.resetState();
  page.resetState();
  dialog.resetState();
  axTree.resetState();
  autoshot.resetState();
  navTracker.resetState();
  tabs.managedTabs.clear();
});

// --- 读取请求体 ---
async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function parseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

// --- HTTP 路由 ---
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const q = Object.fromEntries(parsed.searchParams);
  const target = q.target;
  if (target) tabs.touch(target);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.end(''); return; }

  try {
    // ===== 系统 =====
    if (pathname === '/health') {
      return ok(res, {
        status: 'ok',
        connected: cdp.connected,
        browserPort: cdp.port,
        sessions: cdp.sessions.size,
        managedTabs: tabs.managedTabs.size,
        uptime: process.uptime(),
      });
    }

    // 所有其他端点需要连接
    await cdp.connect(BROWSER_PORT ? parseInt(BROWSER_PORT) : null);

    // ===== Tab 管理 =====
    if (pathname === '/tabs') {
      return ok(res, await tabs.listAll());
    }
    if (pathname === '/tabs/new') {
      const body = parseJSON(await readBody(req));
      const url = body?.url || q.url || 'about:blank';
      const group = body?.group || q.group || 'default';
      const targetId = await tabs.create(url, group);
      return ok(res, { targetId, url, group });
    }
    if (pathname === '/tabs/close') {
      await tabs.close(target);
      return ok(res, { closed: target });
    }
    if (pathname === '/tabs/closeAll') {
      const count = await tabs.closeAll();
      return ok(res, { closed: count });
    }
    if (pathname === '/tabs/closeGroup') {
      const count = await tabs.closeGroup(q.group);
      return ok(res, { closed: count, group: q.group });
    }
    if (pathname === '/tabs/navigate') {
      const body = parseJSON(await readBody(req));
      const url = body?.url || q.url;
      if (!url) return err(res, '需要 url 参数');
      const result = await tabs.navigate(target, url);
      return ok(res, result);
    }
    if (pathname === '/tabs/back') { await tabs.back(target); return ok(res, { ok: true }); }
    if (pathname === '/tabs/forward') { await tabs.forward(target); return ok(res, { ok: true }); }
    if (pathname === '/tabs/reload') { await tabs.reload(target); return ok(res, { ok: true }); }
    if (pathname === '/tabs/info') {
      return ok(res, await tabs.getInfo(target));
    }

    // ===== 交互 =====
    if (pathname === '/eval') {
      const body = await readBody(req);
      const expr = body || q.expr;
      if (!expr) return err(res, '需要 JS 表达式');
      const opts = {};
      if (q.userGesture === '1' || q.userGesture === 'true') opts.userGesture = true;
      return ok(res, await interact.eval(target, expr, opts));
    }
    if (pathname === '/clipboard/write') {
      const body = await readBody(req);
      if (!body) return err(res, '需要写入的文本内容');
      return ok(res, await interact.clipboardWrite(target, body));
    }
    if (pathname === '/clipboard/read') {
      return ok(res, await interact.clipboardRead(target));
    }
    if (pathname === '/click') {
      const body = await readBody(req);
      const selector = body || q.selector;
      if (!selector) return err(res, '需要 CSS 选择器');
      return ok(res, await interact.click(target, selector));
    }
    if (pathname === '/clickByText') {
      const body = parseJSON(await readBody(req)) || {};
      const text = body.text || q.text;
      if (!text) return err(res, '需要 text 参数');
      return ok(res, await interact.clickByText(target, text, body.tag || q.tag || ''));
    }
    if (pathname === '/clickAt') {
      const body = await readBody(req);
      const selector = body || q.selector;
      if (!selector) return err(res, '需要 CSS 选择器');
      return ok(res, await interact.clickAt(target, selector));
    }
    if (pathname === '/clickXY') {
      const body = parseJSON(await readBody(req)) || {};
      const x = body.x ?? parseFloat(q.x);
      const y = body.y ?? parseFloat(q.y);
      if (isNaN(x) || isNaN(y)) return err(res, '需要 x, y 坐标');
      return ok(res, await interact.clickXY(target, x, y, body));
    }
    if (pathname === '/type') {
      const body = parseJSON(await readBody(req)) || {};
      const text = body.text || q.text;
      if (!text) return err(res, '需要 text');
      return ok(res, await interact.type(target, text, body));
    }
    if (pathname === '/fill') {
      const body = parseJSON(await readBody(req));
      if (!body?.selector || body.value === undefined) return err(res, '需要 selector 和 value');
      return ok(res, await interact.fill(target, body.selector, body.value));
    }
    if (pathname === '/fillForm') {
      const body = parseJSON(await readBody(req));
      if (!body?.fields) return err(res, '需要 fields 数组');
      return ok(res, await interact.fillForm(target, body.fields));
    }
    if (pathname === '/pressKey') {
      const body = parseJSON(await readBody(req)) || {};
      const key = body.key || q.key;
      if (!key) return err(res, '需要 key');
      return ok(res, await interact.pressKey(target, key, body.modifiers || {}));
    }
    if (pathname === '/hotkey') {
      const body = parseJSON(await readBody(req)) || {};
      const keys = body.keys || (q.keys ? q.keys.split('+') : null);
      if (!keys) return err(res, '需要 keys 数组');
      return ok(res, await interact.hotkey(target, ...keys));
    }
    if (pathname === '/paste') {
      return ok(res, await interact.paste(target));
    }
    if (pathname === '/copy') {
      return ok(res, await interact.copy(target));
    }
    if (pathname === '/hover') {
      const body = await readBody(req);
      return ok(res, await interact.hover(target, body || q.selector));
    }
    if (pathname === '/scroll') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await interact.scroll(target, { ...body, ...q }));
    }
    if (pathname === '/select') {
      const body = parseJSON(await readBody(req));
      if (!body?.selector || !body.value) return err(res, '需要 selector 和 value');
      return ok(res, await interact.select(target, body.selector, body.value));
    }
    if (pathname === '/checkbox') {
      const body = parseJSON(await readBody(req));
      if (!body?.selector) return err(res, '需要 selector');
      return ok(res, await interact.checkbox(target, body.selector, body.checked !== false));
    }
    if (pathname === '/upload') {
      const body = parseJSON(await readBody(req));
      if (!body?.selector || !body?.files) return err(res, '需要 selector 和 files');
      return ok(res, await interact.setFiles(target, body.selector, body.files));
    }
    if (pathname === '/drag') {
      const body = parseJSON(await readBody(req));
      if (!body?.from || !body?.to) return err(res, '需要 from 和 to 选择器');
      return ok(res, await interact.drag(target, body.from, body.to));
    }
    if (pathname === '/doubleClick') {
      const body = await readBody(req);
      const selector = body || q.selector;
      if (!selector) return err(res, '需要 CSS 选择器');
      return ok(res, await interact.doubleClick(target, selector));
    }
    if (pathname === '/rightClick') {
      const body = await readBody(req);
      const selector = body || q.selector;
      if (!selector) return err(res, '需要 CSS 选择器');
      return ok(res, await interact.rightClick(target, selector));
    }

    // ===== 页面分析 =====
    if (pathname === '/page/elements') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await page.getInteractiveElements(target, body));
    }
    if (pathname === '/page/text') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, { text: await page.getTextContent(target, body) });
    }
    if (pathname === '/page/forms') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await page.getFormFields(target, body.selector || 'form'));
    }
    if (pathname === '/page/links') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await page.getLinks(target, body));
    }
    if (pathname === '/page/table') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await page.getTableData(target, body.selector || 'table'));
    }
    if (pathname === '/page/waitElement') {
      const body = parseJSON(await readBody(req)) || {};
      const selector = body.selector || q.selector;
      if (!selector) return err(res, '需要 selector');
      return ok(res, await page.waitForElement(target, selector, body.timeout || 10000));
    }
    if (pathname === '/page/waitText') {
      const body = parseJSON(await readBody(req)) || {};
      const text = body.text || q.text;
      if (!text) return err(res, '需要 text');
      return ok(res, await page.waitForText(target, text, body.timeout || 10000));
    }
    if (pathname === '/page/waitNetwork') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await page.waitForNetworkIdle(target, body.timeout || 15000, body.idleTime || 2000));
    }

    // ===== Console 日志 =====
    if (pathname === '/console/enable') {
      return ok(res, await page.enableConsoleCapture(target));
    }
    if (pathname === '/console/logs') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, page.getConsoleLogs({ ...body, ...q }));
    }
    if (pathname === '/console/clear') {
      return ok(res, page.clearConsoleLogs());
    }
    if (pathname === '/console/stop') {
      page.stopConsoleCapture(target);
      return ok(res, { stopped: true });
    }

    // ===== Shadow DOM =====
    if (pathname === '/shadow/query') {
      const body = parseJSON(await readBody(req)) || {};
      const selector = body.selector || q.selector;
      if (!selector) return err(res, '需要 selector');
      return ok(res, await page.queryShadowDOM(target, selector, body));
    }
    if (pathname === '/shadow/click') {
      const body = await readBody(req);
      const selector = body || q.selector;
      if (!selector) return err(res, '需要 CSS 选择器');
      return ok(res, await page.clickInShadowDOM(target, selector));
    }
    if (pathname === '/shadow/fill') {
      const body = parseJSON(await readBody(req));
      if (!body?.selector || body.value === undefined) return err(res, '需要 selector 和 value');
      return ok(res, await page.fillInShadowDOM(target, body.selector, body.value));
    }
    if (pathname === '/screenshot') {
      const body = parseJSON(await readBody(req)) || {};
      const filePath = body.file || q.file || null;
      const result = await page.screenshot(target, filePath, body);
      if (filePath) return ok(res, result);
      // 返回图片
      res.setHeader('Content-Type', 'image/png');
      res.end(Buffer.from(result.base64, 'base64'));
      return;
    }
    if (pathname === '/pdf') {
      const body = parseJSON(await readBody(req)) || {};
      const filePath = body.file || q.file;
      if (!filePath) return err(res, '需要 file 路径');
      return ok(res, await page.generatePDF(target, filePath, body));
    }

    // ===== 网络 =====
    if (pathname === '/network/monitor') {
      return ok(res, await network.enableMonitoring(target));
    }
    if (pathname === '/network/stop') {
      network.stopMonitoring(target);
      return ok(res, { stopped: true });
    }
    if (pathname === '/network/requests') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, network.getRecentRequests(body));
    }
    if (pathname === '/network/response') {
      const requestId = q.requestId;
      if (!requestId) return err(res, '需要 requestId');
      return ok(res, await network.getResponseBody(target, requestId));
    }
    if (pathname === '/network/intercept') {
      const body = parseJSON(await readBody(req));
      if (!body?.rules) return err(res, '需要 rules 数组');
      return ok(res, await network.enableInterception(target, body.rules));
    }
    if (pathname === '/network/intercept/stop') {
      return ok(res, await network.disableInterception(target));
    }
    if (pathname === '/cookies') {
      if (req.method === 'GET') return ok(res, await network.getCookies(target));
      const body = parseJSON(await readBody(req));
      if (req.method === 'POST') return ok(res, await network.setCookie(target, body));
      if (req.method === 'DELETE') return ok(res, await network.deleteCookies(target, body));
    }
    if (pathname === '/storage') {
      if (req.method === 'GET') {
        return ok(res, await network.getStorage(target, q.type || 'local'));
      }
      if (req.method === 'DELETE') {
        return ok(res, await network.clearStorage(target, q.type || 'local'));
      }
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await network.setStorageItem(target, body.key, body.value, body.type || 'local'));
    }
    if (pathname === '/session/export') {
      const body = parseJSON(await readBody(req)) || {};
      const filePath = body.file || q.file;
      if (!filePath) return err(res, '需要 file 路径');
      return ok(res, await network.exportSession(target, filePath));
    }
    if (pathname === '/session/import') {
      const body = parseJSON(await readBody(req)) || {};
      const filePath = body.file || q.file;
      if (!filePath) return err(res, '需要 file 路径');
      return ok(res, await network.importSession(target, filePath));
    }
    if (pathname === '/downloads') {
      if (q.enable === '1') return ok(res, await network.enableDownloads(target));
      return ok(res, network.getDownloadStatus());
    }

    // ===== 任务管理 =====
    if (pathname === '/tasks') {
      if (req.method === 'GET') return ok(res, taskMgr.list());
      const body = parseJSON(await readBody(req));
      if (!body?.id || !body?.name || !body?.steps) return err(res, '需要 id, name, steps');
      return ok(res, taskMgr.create(body.id, body));
    }
    if (pathname === '/tasks/get') {
      return ok(res, taskMgr.get(q.id) || { error: '任务不存在' });
    }
    if (pathname === '/tasks/step/start') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, taskMgr.stepStart(body.taskId || q.taskId, body.stepId || q.stepId));
    }
    if (pathname === '/tasks/step/done') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, taskMgr.stepDone(body.taskId, body.stepId, body.result));
    }
    if (pathname === '/tasks/step/fail') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, taskMgr.stepFail(body.taskId, body.stepId, body.error));
    }
    if (pathname === '/tasks/next') {
      return ok(res, taskMgr.getNextStep(q.id) || { done: true });
    }
    if (pathname === '/tasks/context') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, taskMgr.updateContext(q.id, body));
    }
    if (pathname === '/tasks/pause') {
      return ok(res, taskMgr.pause(q.id));
    }
    if (pathname === '/tasks/delete') {
      return ok(res, { deleted: taskMgr.delete(q.id) });
    }

    // ===== iframe 操作 =====
    if (pathname === '/frames') {
      return ok(res, await frames.listFrames(target));
    }
    if (pathname === '/frames/eval') {
      const body = parseJSON(await readBody(req)) || {};
      const frameId = body.frameId || q.frameId;
      const frameIndex = body.frameIndex ?? (q.frameIndex != null ? parseInt(q.frameIndex) : null);
      const urlPattern = body.urlPattern || q.urlPattern;
      const expr = body.expression || body.expr;
      if (!expr) return err(res, '需要 expression');
      if (frameId) return ok(res, await frames.evalInFrame(target, frameId, expr, body));
      if (frameIndex != null) return ok(res, await frames.evalInFrameByIndex(target, frameIndex, expr, body));
      if (urlPattern) return ok(res, await frames.evalInFrameByUrl(target, urlPattern, expr, body));
      return err(res, '需要 frameId / frameIndex / urlPattern');
    }
    if (pathname === '/frames/click') {
      const body = parseJSON(await readBody(req)) || {};
      if (!body.frameId || !body.selector) return err(res, '需要 frameId 和 selector');
      return ok(res, await frames.clickInFrame(target, body.frameId, body.selector));
    }
    if (pathname === '/frames/fill') {
      const body = parseJSON(await readBody(req)) || {};
      if (!body.frameId || !body.selector || body.value === undefined) return err(res, '需要 frameId, selector, value');
      return ok(res, await frames.fillInFrame(target, body.frameId, body.selector, body.value));
    }
    if (pathname === '/frames/elements') {
      const body = parseJSON(await readBody(req)) || {};
      if (!body.frameId) return err(res, '需要 frameId');
      return ok(res, await frames.getElementsInFrame(target, body.frameId, body.maxItems || 50));
    }
    if (pathname === '/frames/text') {
      const body = parseJSON(await readBody(req)) || {};
      if (!body.frameId) return err(res, '需要 frameId');
      return ok(res, { text: await frames.getTextInFrame(target, body.frameId, body.maxLength || 5000) });
    }
    if (pathname === '/frames/findText') {
      const body = parseJSON(await readBody(req)) || {};
      const text = body.text || q.text;
      if (!text) return err(res, '需要 text');
      return ok(res, await frames.findTextAcrossFrames(target, text));
    }
    if (pathname === '/frames/findElement') {
      const body = parseJSON(await readBody(req)) || {};
      const selector = body.selector || q.selector;
      if (!selector) return err(res, '需要 selector');
      return ok(res, await frames.findElementAcrossFrames(target, selector));
    }

    // ===== 快速输入 =====
    if (pathname === '/insertText') {
      const body = parseJSON(await readBody(req)) || {};
      const text = body.text || q.text;
      if (!text) return err(res, '需要 text');
      return ok(res, await interact.insertText(target, text, body));
    }

    // ===== Actionability 检查 =====
    if (pathname === '/actionability') {
      const body = parseJSON(await readBody(req)) || {};
      const selector = body.selector || q.selector;
      if (!selector) return err(res, '需要 selector');
      return ok(res, await interact.checkActionability(target, selector, body));
    }
    if (pathname === '/safeClick') {
      const body = parseJSON(await readBody(req)) || {};
      const selector = body.selector || q.selector;
      if (!selector) return err(res, '需要 selector');
      return ok(res, await interact.safeClick(target, selector, body));
    }

    // ===== Dialog 对话框 =====
    if (pathname === '/dialog/enable') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await dialog.enable(target, body));
    }
    if (pathname === '/dialog/disable') {
      return ok(res, dialog.disable(target));
    }
    if (pathname === '/dialog/history') {
      return ok(res, dialog.getHistory(target));
    }
    if (pathname === '/dialog/clear') {
      return ok(res, dialog.clearHistory(target));
    }
    if (pathname === '/dialog/handle') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await dialog.handle(target, body.accept !== false, body.promptText || ''));
    }
    if (pathname === '/dialog/policy') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, dialog.setPolicy(body.policy || q.policy, body.promptText));
    }

    // ===== 无障碍树快照 =====
    if (pathname === '/accessibility/snapshot') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await axTree.getSnapshot(target, body));
    }
    if (pathname === '/accessibility/resolve') {
      const body = parseJSON(await readBody(req)) || {};
      const refId = body.refId || q.refId;
      if (!refId) return err(res, '需要 refId (如 @e1)');
      return ok(res, await axTree.resolveRef(target, refId));
    }
    if (pathname === '/accessibility/click') {
      const body = parseJSON(await readBody(req)) || {};
      const refId = body.refId || q.refId;
      if (!refId) return err(res, '需要 refId (如 @e1)');
      return ok(res, await axTree.clickRef(target, refId));
    }

    // ===== 反检测 =====
    if (pathname === '/stealth/inject') {
      return ok(res, await stealth.inject(target));
    }
    if (pathname === '/stealth/injectAll') {
      return ok(res, await stealth.injectAll(tabs));
    }
    if (pathname === '/stealth/check') {
      return ok(res, await stealth.check(target));
    }

    // ===== 智能等待 =====
    if (pathname === '/wait/load') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await waiter.waitForPageLoad(target, body.timeout || 20000));
    }
    if (pathname === '/wait/navigation') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await waiter.waitForNavigation(target, body.timeout || 30000));
    }
    if (pathname === '/wait/network') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await waiter.waitForNetworkIdle(target, body.timeout || 15000, body));
    }
    if (pathname === '/wait/element') {
      const body = parseJSON(await readBody(req)) || {};
      const selector = body.selector || q.selector;
      if (!selector) return err(res, '需要 selector');
      return ok(res, await waiter.waitForElement(target, selector, body.timeout || 10000));
    }
    if (pathname === '/wait/elementGone') {
      const body = parseJSON(await readBody(req)) || {};
      const selector = body.selector || q.selector;
      if (!selector) return err(res, '需要 selector');
      return ok(res, await waiter.waitForElementGone(target, selector, body.timeout || 10000));
    }
    if (pathname === '/wait/text') {
      const body = parseJSON(await readBody(req)) || {};
      const text = body.text || q.text;
      if (!text) return err(res, '需要 text');
      return ok(res, await waiter.waitForText(target, text, body.timeout || 10000));
    }
    if (pathname === '/wait/url') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await waiter.waitForUrlChange(target, body.pattern || q.pattern, body.timeout || 15000));
    }
    if (pathname === '/wait/stable') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await waiter.waitForStable(target, body.timeout || 20000));
    }

    // ===== 页面检测 =====
    if (pathname === '/detect') {
      return ok(res, await detector.detect(target));
    }
    if (pathname === '/detect/dismiss') {
      return ok(res, await detector.dismissOverlays(target));
    }
    if (pathname === '/detect/smartOpen') {
      const body = parseJSON(await readBody(req)) || {};
      const url = body.url || q.url;
      if (!url) return err(res, '需要 url');
      return ok(res, await detector.smartOpen(tabs, stealth, url, body.group || q.group || 'default', waiter));
    }

    // ===== 批量操作 =====
    if (pathname === '/batch/open') {
      const body = parseJSON(await readBody(req));
      if (!body?.urls || !Array.isArray(body.urls)) return err(res, '需要 urls 数组');
      return ok(res, await batch.openAll(body.urls, body));
    }
    if (pathname === '/batch/eval') {
      const body = parseJSON(await readBody(req));
      if (!body?.targetIds || !body?.expression) return err(res, '需要 targetIds 和 expression');
      return ok(res, await batch.evalAll(body.targetIds, body.expression, body));
    }
    if (pathname === '/batch/text') {
      const body = parseJSON(await readBody(req));
      if (!body?.targetIds) return err(res, '需要 targetIds');
      return ok(res, await batch.extractTextAll(body.targetIds, body));
    }
    if (pathname === '/batch/screenshot') {
      const body = parseJSON(await readBody(req));
      if (!body?.targetIds || !body?.dir) return err(res, '需要 targetIds 和 dir');
      return ok(res, await batch.screenshotAll(body.targetIds, body.dir, body));
    }
    if (pathname === '/batch/scrape') {
      const body = parseJSON(await readBody(req));
      if (!body?.urls) return err(res, '需要 urls 数组');
      return ok(res, await batch.scrape(body.urls, body.expression || null, body));
    }
    if (pathname === '/batch/close') {
      const body = parseJSON(await readBody(req));
      if (!body?.targetIds) return err(res, '需要 targetIds');
      return ok(res, await batch.closeAll(body.targetIds));
    }

    // ===== Pipeline 批量执行 =====
    if (pathname === '/pipeline') {
      const body = parseJSON(await readBody(req));
      if (!body?.steps || !Array.isArray(body.steps)) return err(res, '需要 steps 数组');
      return ok(res, await pipeline.execute(target, body.steps, body));
    }

    // ===== 自动截图 =====
    if (pathname === '/autoshot/enable') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, autoshot.enable(target, body));
    }
    if (pathname === '/autoshot/disable') {
      return ok(res, autoshot.disable(target));
    }
    if (pathname === '/autoshot/capture') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await autoshot.capture(target, body.action || q.action || 'manual'));
    }
    if (pathname === '/autoshot/history') {
      return ok(res, autoshot.getHistory(target, parseInt(q.limit || '10')));
    }
    if (pathname === '/autoshot/latest') {
      return ok(res, await autoshot.getLatest(target));
    }
    if (pathname === '/autoshot/global') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, autoshot.enableGlobal(body));
    }

    // ===== 跨导航追踪 =====
    if (pathname === '/nav/enable') {
      const body = parseJSON(await readBody(req)) || {};
      return ok(res, await navTracker.enable(target, body));
    }
    if (pathname === '/nav/disable') {
      return ok(res, navTracker.disable(target));
    }
    if (pathname === '/nav/history') {
      return ok(res, navTracker.getHistory(target));
    }
    if (pathname === '/nav/current') {
      return ok(res, { url: navTracker.getCurrentUrl(target) });
    }

    // ===== 站点 Profile =====
    if (pathname === '/profiles') {
      if (req.method === 'GET') return ok(res, profiles.list());
      const body = parseJSON(await readBody(req));
      if (!body?.domain) return err(res, '需要 domain');
      return ok(res, profiles.set(body.domain, body));
    }
    if (pathname === '/profiles/get') {
      const domain = q.domain || q.url;
      if (!domain) return err(res, '需要 domain');
      return ok(res, profiles.get(domain) || { notFound: true });
    }
    if (pathname === '/profiles/match') {
      const url = q.url || q.domain;
      if (!url) return err(res, '需要 url');
      return ok(res, profiles.match(url) || { notFound: true });
    }
    if (pathname === '/profiles/delete') {
      const domain = q.domain;
      if (!domain) return err(res, '需要 domain');
      return ok(res, profiles.delete(domain));
    }
    if (pathname === '/profiles/selector') {
      const body = parseJSON(await readBody(req));
      if (!body?.domain || !body?.name || !body?.selector) return err(res, '需要 domain, name, selector');
      return ok(res, profiles.addSelector(body.domain, body.name, body.selector, body.description));
    }
    if (pathname === '/profiles/note') {
      const body = parseJSON(await readBody(req));
      if (!body?.domain || !body?.note) return err(res, '需要 domain, note');
      return ok(res, profiles.addNote(body.domain, body.note));
    }

    // ===== 帮助 =====
    if (pathname === '/help') {
      return ok(res, API_HELP);
    }

    // ===== 404 =====
    res.statusCode = 404;
    return ok(res, {
      error: '未知端点: ' + pathname,
      hint: 'GET /help 查看所有 API',
    });

  } catch (e) {
    console.error(`[Engine] Error on ${pathname}:`, e.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
});

function ok(res, data) { res.end(JSON.stringify(data, null, 2)); }
function err(res, msg) { res.statusCode = 400; res.end(JSON.stringify({ error: msg })); }

const API_HELP = {
  system: ['GET /health', 'GET /help'],
  tabs: ['GET /tabs', 'GET|POST /tabs/new', 'GET /tabs/close', 'GET /tabs/closeAll', 'GET /tabs/closeGroup', 'POST /tabs/navigate', 'GET /tabs/back', 'GET /tabs/forward', 'GET /tabs/reload', 'GET /tabs/info'],
  interact: ['POST /eval', 'POST /eval?userGesture=1', 'POST /clipboard/write', 'GET /clipboard/read', 'POST /click', 'POST /clickByText', 'POST /clickAt', 'POST /clickXY', 'POST /doubleClick', 'POST /rightClick', 'POST /type', 'POST /insertText', 'POST /fill', 'POST /fillForm', 'POST /pressKey', 'POST /hotkey', 'POST /hover', 'POST /scroll', 'POST /select', 'POST /checkbox', 'POST /upload', 'POST /drag', 'POST /actionability', 'POST /safeClick'],
  page: ['POST /page/elements', 'POST /page/text', 'POST /page/forms', 'POST /page/links', 'POST /page/table', 'POST /page/waitElement', 'POST /page/waitText', 'POST /page/waitNetwork', 'POST /screenshot', 'POST /pdf'],
  console: ['GET /console/enable', 'GET /console/logs', 'GET /console/clear', 'GET /console/stop'],
  shadow: ['POST /shadow/query', 'POST /shadow/click', 'POST /shadow/fill'],
  frames: ['GET /frames', 'POST /frames/eval', 'POST /frames/click', 'POST /frames/fill', 'POST /frames/elements', 'POST /frames/text', 'POST /frames/findText', 'POST /frames/findElement'],
  stealth: ['GET /stealth/inject', 'GET /stealth/injectAll', 'GET /stealth/check'],
  wait: ['POST /wait/load', 'POST /wait/navigation', 'POST /wait/network', 'POST /wait/element', 'POST /wait/elementGone', 'POST /wait/text', 'POST /wait/url', 'POST /wait/stable'],
  network: ['GET /network/monitor', 'GET /network/stop', 'POST /network/requests', 'GET /network/response', 'POST /network/intercept', 'GET /network/intercept/stop', 'GET|POST|DELETE /cookies', 'GET|POST|DELETE /storage', 'POST /session/export', 'POST /session/import', 'GET /downloads'],
  tasks: ['GET|POST /tasks', 'GET /tasks/get', 'POST /tasks/step/start', 'POST /tasks/step/done', 'POST /tasks/step/fail', 'GET /tasks/next', 'POST /tasks/context', 'GET /tasks/pause', 'GET /tasks/delete'],
  dialog: ['GET /dialog/enable', 'GET /dialog/disable', 'GET /dialog/history', 'GET /dialog/clear', 'POST /dialog/handle', 'POST /dialog/policy'],
  accessibility: ['POST /accessibility/snapshot', 'POST /accessibility/resolve', 'POST /accessibility/click'],
  pipeline: ['POST /pipeline'],
  autoshot: ['POST /autoshot/enable', 'GET /autoshot/disable', 'POST /autoshot/capture', 'GET /autoshot/history', 'GET /autoshot/latest', 'POST /autoshot/global'],
  nav: ['POST /nav/enable', 'GET /nav/disable', 'GET /nav/history', 'GET /nav/current'],
  profiles: ['GET|POST /profiles', 'GET /profiles/get', 'GET /profiles/match', 'GET /profiles/delete', 'POST /profiles/selector', 'POST /profiles/note'],
  detect: ['GET /detect', 'GET /detect/dismiss', 'POST /detect/smartOpen'],
  batch: ['POST /batch/open', 'POST /batch/eval', 'POST /batch/text', 'POST /batch/screenshot', 'POST /batch/scrape', 'POST /batch/close'],
};

// --- 启动 ---
import net from 'node:net';

async function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port, '127.0.0.1');
  });
}

async function main() {
  const available = await checkPortAvailable(PORT);
  if (!available) {
    // 检查已有实例
    try {
      const resp = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${PORT}/health`, { timeout: 2000 }, (r) => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => resolve(d));
        }).on('error', () => resolve(null));
      });
      if (resp && resp.includes('"ok"')) {
        console.log(`[Engine] 已有实例运行在端口 ${PORT}`);
        process.exit(0);
      }
    } catch { /* port occupied by other */ }
    console.error(`[Engine] 端口 ${PORT} 已被占用`);
    process.exit(1);
  }

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Browser Engine] ✓ 运行在 http://localhost:${PORT}`);
    console.log(`[Browser Engine] 浏览器端口: ${BROWSER_PORT || '自动发现'}`);
    // 尝试连接
    cdp.connect(BROWSER_PORT ? parseInt(BROWSER_PORT) : null)
      .then(() => console.log('[Browser Engine] ✓ 浏览器已连接'))
      .catch(e => console.log(`[Browser Engine] 初始连接待命: ${e.message}`));
  });

  // 定时清理闲置 tab
  const cleanup = setInterval(() => tabs.cleanupIdle(), 60000);
  cleanup.unref();

  // 优雅关闭
  const shutdown = async (sig) => {
    console.log(`[Engine] ${sig}, 清理中...`);
    clearInterval(cleanup);
    await tabs.closeAll();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('uncaughtException', (e) => console.error('[Engine] 异常:', e.message));
process.on('unhandledRejection', (e) => console.error('[Engine] 拒绝:', e?.message || e));

main();
