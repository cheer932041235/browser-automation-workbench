// Network Module
// 网络请求监控、拦截、Cookie管理、下载跟踪

import fs from 'node:fs';
import path from 'node:path';

export class NetworkManager {
  constructor(cdp) {
    this.cdp = cdp;
    this.requestLog = []; // 最近的网络请求
    this.maxLogSize = 200;
    this.interceptRules = []; // { pattern, action: 'block'|'modify', ... }
    this.downloads = new Map(); // guid -> { url, filename, state, path }
    this.downloadDir = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads');
    this._monitoringTargets = new Set(); // 防止重复注册
    // 按 targetId 追踪事件: targetId -> [{method, entry}]
    this._targetEvents = new Map();
    // 全局事件（如 Browser.download*）
    this._globalEvents = [];
  }

  _trackEvent(targetId, method, entry) {
    if (!this._targetEvents.has(targetId)) this._targetEvents.set(targetId, []);
    this._targetEvents.get(targetId).push({ method, entry });
  }

  _cleanupTarget(targetId) {
    const events = this._targetEvents.get(targetId);
    if (events) {
      for (const { method, entry } of events) this.cdp.off(method, entry);
      this._targetEvents.delete(targetId);
    }
    this._monitoringTargets.delete(targetId);
  }

  // --- 启用网络监控 ---
  async enableMonitoring(targetId) {
    // 防止对同一 target 重复注册事件
    if (this._monitoringTargets.has(targetId)) return { monitoring: true, alreadyEnabled: true };
    this._monitoringTargets.add(targetId);

    await this.cdp.sendToTarget(targetId, 'Network.enable', {});

    const reqEntry = this.cdp.on('Network.requestWillBeSent', (params) => {
      this.requestLog.push({
        id: params.requestId,
        url: params.request.url,
        method: params.request.method,
        type: params.type,
        time: Date.now(),
      });
      if (this.requestLog.length > this.maxLogSize) this.requestLog.shift();
    });

    const respEntry = this.cdp.on('Network.responseReceived', (params) => {
      const logEntry = this.requestLog.find(r => r.id === params.requestId);
      if (logEntry) {
        logEntry.status = params.response.status;
        logEntry.mimeType = params.response.mimeType;
        logEntry.size = params.response.headers?.['content-length'];
      }
    });

    this._trackEvent(targetId, 'Network.requestWillBeSent', reqEntry);
    this._trackEvent(targetId, 'Network.responseReceived', respEntry);
    return { monitoring: true };
  }

  // --- 停止监控并清理事件 ---
  stopMonitoring(targetId) {
    this._cleanupTarget(targetId);
  }

  // --- 获取最近的网络请求 ---
  getRecentRequests(opts = {}) {
    let logs = [...this.requestLog];
    if (opts.type) logs = logs.filter(r => r.type === opts.type);
    if (opts.urlPattern) {
      const re = new RegExp(opts.urlPattern, 'i');
      logs = logs.filter(r => re.test(r.url));
    }
    if (opts.method) logs = logs.filter(r => r.method === opts.method);
    return logs.slice(-(opts.limit || 50));
  }

  // --- 获取请求响应内容 ---
  async getResponseBody(targetId, requestId) {
    try {
      const resp = await this.cdp.sendToTarget(targetId, 'Network.getResponseBody', { requestId });
      return {
        body: resp.result.body?.slice(0, 10000),
        base64Encoded: resp.result.base64Encoded,
        truncated: resp.result.body?.length > 10000,
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  // --- Cookie 管理 ---
  async getCookies(targetId, urls = []) {
    const params = urls.length ? { urls } : {};
    const resp = await this.cdp.sendToTarget(targetId, 'Network.getCookies', params);
    return resp.result?.cookies || [];
  }

  async setCookie(targetId, cookie) {
    // cookie: { name, value, domain, path, secure, httpOnly, sameSite, expires }
    const resp = await this.cdp.sendToTarget(targetId, 'Network.setCookie', cookie);
    return { success: resp.result?.success };
  }

  async deleteCookies(targetId, opts) {
    // opts: { name, domain, path, url }
    await this.cdp.sendToTarget(targetId, 'Network.deleteCookies', opts);
    return { deleted: true };
  }

  async clearAllCookies(targetId) {
    await this.cdp.sendToTarget(targetId, 'Network.clearBrowserCookies', {});
    return { cleared: true };
  }

  // --- localStorage / sessionStorage ---
  async getStorage(targetId, type = 'local') {
    const js = `(() => {
      const storage = ${type === 'session' ? 'sessionStorage' : 'localStorage'};
      const items = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        items[key] = storage.getItem(key)?.slice(0, 200);
      }
      return { count: storage.length, items };
    })()`;
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
    });
    return resp.result?.result?.value || {};
  }

  async setStorageItem(targetId, key, value, type = 'local') {
    const storage = type === 'session' ? 'sessionStorage' : 'localStorage';
    const js = `${storage}.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); true`;
    await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', { expression: js, returnByValue: true });
    return { set: true };
  }

  // --- 请求拦截 ---
  async enableInterception(targetId, rules) {
    // rules: [{ urlPattern: '*.ads.*', action: 'block' }, { urlPattern: '*.tracker.*', action: 'block' }]
    this.interceptRules = rules;
    const patterns = rules.map(r => ({ urlPattern: r.urlPattern, requestStage: 'Request' }));
    await this.cdp.sendToTarget(targetId, 'Fetch.enable', { patterns });

    const fetchEntry = this.cdp.on('Fetch.requestPaused', async (params, sessionId) => {
      const url = params.request.url;
      const matchedRule = this.interceptRules.find(r => {
        const re = new RegExp(r.urlPattern.replace(/\*/g, '.*'), 'i');
        return re.test(url);
      });

      if (matchedRule?.action === 'block') {
        await this.cdp.sendToTarget(targetId, 'Fetch.failRequest', {
          requestId: params.requestId, errorReason: 'BlockedByClient'
        }).catch(() => {});
      } else if (matchedRule?.action === 'modify' && matchedRule.headers) {
        const headers = params.request.headers;
        Object.assign(headers, matchedRule.headers);
        await this.cdp.sendToTarget(targetId, 'Fetch.continueRequest', {
          requestId: params.requestId,
          headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
        }).catch(() => {});
      } else {
        await this.cdp.sendToTarget(targetId, 'Fetch.continueRequest', {
          requestId: params.requestId
        }).catch(() => {});
      }
    });
    this._trackEvent(targetId, 'Fetch.requestPaused', fetchEntry);

    return { intercepting: rules.length };
  }

  // --- 停止拦截 ---
  async disableInterception(targetId) {
    await this.cdp.sendToTarget(targetId, 'Fetch.disable', {}).catch(() => {});
    this.interceptRules = [];
    // 清理 Fetch 事件
    const events = this._targetEvents.get(targetId);
    if (events) {
      const remaining = [];
      for (const ev of events) {
        if (ev.method === 'Fetch.requestPaused') {
          this.cdp.off(ev.method, ev.entry);
        } else {
          remaining.push(ev);
        }
      }
      this._targetEvents.set(targetId, remaining);
    }
    return { intercepting: 0 };
  }

  // --- 下载管理 ---
  async enableDownloads(targetId) {
    if (!fs.existsSync(this.downloadDir)) fs.mkdirSync(this.downloadDir, { recursive: true });

    // Browser 域命令不需要 session（浏览器级别）
    await this.cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: this.downloadDir,
      eventsEnabled: true,
    });

    const beginEntry = this.cdp.on('Browser.downloadWillBegin', (params) => {
      this.downloads.set(params.guid, {
        url: params.url,
        filename: params.suggestedFilename,
        state: 'inProgress',
        started: Date.now(),
      });
    });

    const progressEntry = this.cdp.on('Browser.downloadProgress', (params) => {
      const dl = this.downloads.get(params.guid);
      if (dl) {
        dl.state = params.state;
        dl.received = params.receivedBytes;
        dl.total = params.totalBytes;
        if (params.state === 'completed') {
          dl.path = path.join(this.downloadDir, dl.filename || params.guid);
          dl.completed = Date.now();
        }
      }
    });

    this._globalEvents.push(
      { method: 'Browser.downloadWillBegin', entry: beginEntry },
      { method: 'Browser.downloadProgress', entry: progressEntry },
    );
    return { downloadDir: this.downloadDir };
  }

  getDownloadStatus() {
    const all = [...this.downloads.values()];
    return {
      total: all.length,
      inProgress: all.filter(d => d.state === 'inProgress').length,
      completed: all.filter(d => d.state === 'completed').length,
      downloads: all.slice(-20),
    };
  }

  // --- 导出 Session 状态（Cookie + localStorage） ---
  async exportSession(targetId, filePath) {
    const cookies = await this.getCookies(targetId);
    const storage = await this.getStorage(targetId, 'local');
    const session = { cookies, localStorage: storage.items, exportedAt: new Date().toISOString() };
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    return { exported: filePath, cookies: cookies.length };
  }

  // --- 导入 Session 状态 ---
  async importSession(targetId, filePath) {
    const session = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let cookieCount = 0;
    for (const cookie of (session.cookies || [])) {
      try {
        await this.cdp.sendToTarget(targetId, 'Network.setCookie', cookie);
        cookieCount++;
      } catch { /* skip invalid */ }
    }
    if (session.localStorage) {
      for (const [key, value] of Object.entries(session.localStorage)) {
        await this.setStorageItem(targetId, key, value);
      }
    }
    return { imported: true, cookies: cookieCount, storageItems: Object.keys(session.localStorage || {}).length };
  }

  // --- 清空 Storage ---
  async clearStorage(targetId, type = 'local') {
    const storage = type === 'session' ? 'sessionStorage' : 'localStorage';
    await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: `${storage}.clear(); true`, returnByValue: true,
    });
    return { cleared: type };
  }

  // --- 重置所有状态（浏览器重连后调用） ---
  resetState() {
    // 清理所有 target 事件
    for (const [targetId] of this._targetEvents) this._cleanupTarget(targetId);
    // 清理全局事件
    for (const { method, entry } of this._globalEvents) this.cdp.off(method, entry);
    this._globalEvents = [];
    this._monitoringTargets.clear();
    this.requestLog = [];
    this.downloads.clear();
    this.interceptRules = [];
  }
}

export default NetworkManager;
