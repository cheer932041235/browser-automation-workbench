// Smart Wait Module - 事件驱动的智能等待
// 替代轮询方式，用 CDP 事件精确检测页面状态变化

export class SmartWaiter {
  constructor(cdp) {
    this.cdp = cdp;
  }

  // --- 等待页面完全加载（事件驱动） ---
  async waitForPageLoad(targetId, timeoutMs = 20000) {
    await this.cdp.sendToTarget(targetId, 'Page.enable', {}).catch(() => {});
    const start = Date.now();

    // 先检查当前状态
    const current = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: 'document.readyState', returnByValue: true,
    }).catch(() => null);
    if (current?.result?.result?.value === 'complete') {
      return { state: 'complete', elapsed: 0, method: 'already-loaded' };
    }

    // 事件驱动等待：同时监听 loadEventFired 和轮询 readyState
    return new Promise((resolve) => {
      let resolved = false;
      let loadEntry, domEntry;
      const done = (state, method) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        clearInterval(fallback);
        // 清理事件监听
        if (loadEntry) this.cdp.off('Page.loadEventFired', loadEntry);
        if (domEntry) this.cdp.off('Page.domContentEventFired', domEntry);
        resolve({ state, elapsed: Date.now() - start, method });
      };

      // 超时保底
      const timer = setTimeout(() => done('timeout', 'timeout'), timeoutMs);

      // CDP 事件监听（最快路径）
      loadEntry = this.cdp.on('Page.loadEventFired', () => done('complete', 'load-event'));

      // DOMContentLoaded 作为中间信号
      domEntry = this.cdp.on('Page.domContentEventFired', () => {
        if (Date.now() - start > 5000) done('interactive', 'dom-content-loaded');
      });

      // 轮询保底（某些 SPA 不触发 load 事件）
      const fallback = setInterval(async () => {
        try {
          const r = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
            expression: 'document.readyState', returnByValue: true,
          });
          if (r.result?.result?.value === 'complete') done('complete', 'polling');
        } catch { /* ignore */ }
      }, 800);
    });
  }

  // --- 等待导航完成（URL 变化 + 页面加载） ---
  async waitForNavigation(targetId, timeoutMs = 30000) {
    await this.cdp.sendToTarget(targetId, 'Page.enable', {}).catch(() => {});
    const start = Date.now();

    // 获取当前 URL 作为基准
    const currentResp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: 'location.href', returnByValue: true,
    });
    const startUrl = currentResp.result?.result?.value || '';

    return new Promise((resolve) => {
      let resolved = false;
      let navigated = false;
      let navEntry, loadEntry;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        clearInterval(fallback);
        if (navEntry) this.cdp.off('Page.frameNavigated', navEntry);
        if (loadEntry) this.cdp.off('Page.loadEventFired', loadEntry);
        resolve({ ...result, elapsed: Date.now() - start });
      };

      const timer = setTimeout(() => done({ state: 'timeout' }), timeoutMs);

      // 监听 frameNavigated
      navEntry = this.cdp.on('Page.frameNavigated', (params) => {
        if (params.frame?.url && params.frame.url !== startUrl) navigated = true;
      });

      // 监听 load
      loadEntry = this.cdp.on('Page.loadEventFired', () => {
        if (navigated) done({ state: 'complete', navigated: true });
      });

      // 轮询保底
      const fallback = setInterval(async () => {
        try {
          const r = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
            expression: 'JSON.stringify({url:location.href,ready:document.readyState})',
            returnByValue: true,
          });
          const state = JSON.parse(r.result?.result?.value || '{}');
          if (state.url !== startUrl && state.ready === 'complete') {
            done({ state: 'complete', url: state.url, navigated: true });
          }
        } catch { /* ignore during navigation */ }
      }, 600);
    });
  }

  // --- 等待网络空闲（真正的事件驱动） ---
  async waitForNetworkIdle(targetId, timeoutMs = 15000, opts = {}) {
    const idleTime = opts.idleTime || 2000;
    const maxPending = opts.maxPending || 0; // 允许的最大待处理请求数
    const ignorePatterns = opts.ignore || []; // 忽略的 URL 模式

    await this.cdp.sendToTarget(targetId, 'Network.enable', {}).catch(() => {});
    const start = Date.now();
    const activeRequests = new Set();
    let lastActivity = Date.now();

    return new Promise((resolve) => {
      let resolved = false;
      let reqEntry, finEntry, failEntry, respEntry;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        clearInterval(check);
        // 清理所有事件监听
        if (reqEntry) this.cdp.off('Network.requestWillBeSent', reqEntry);
        if (finEntry) this.cdp.off('Network.loadingFinished', finEntry);
        if (failEntry) this.cdp.off('Network.loadingFailed', failEntry);
        if (respEntry) this.cdp.off('Network.responseReceived', respEntry);
        resolve({ ...result, elapsed: Date.now() - start });
      };

      const timer = setTimeout(() => done({
        idle: false, reason: 'timeout', pendingRequests: activeRequests.size
      }), timeoutMs);

      const shouldIgnore = (url) =>
        ignorePatterns.some(p => new RegExp(p, 'i').test(url));

      const doneHandler = (params) => {
        activeRequests.delete(params.requestId);
        if (activeRequests.size <= maxPending) lastActivity = Date.now();
      };

      reqEntry = this.cdp.on('Network.requestWillBeSent', (params) => {
        if (!shouldIgnore(params.request?.url || '')) {
          activeRequests.add(params.requestId);
          lastActivity = Date.now();
        }
      });
      finEntry = this.cdp.on('Network.loadingFinished', doneHandler);
      failEntry = this.cdp.on('Network.loadingFailed', doneHandler);
      respEntry = this.cdp.on('Network.responseReceived', (params) => {
        if (params.response?.status >= 300) activeRequests.delete(params.requestId);
      });

      const check = setInterval(() => {
        if (activeRequests.size <= maxPending && Date.now() - lastActivity >= idleTime) {
          done({ idle: true, pendingAtEnd: activeRequests.size });
        }
      }, 300);
    });
  }

  // --- 等待元素出现（MutationObserver 注入，比轮询快） ---
  async waitForElement(targetId, selector, timeoutMs = 10000) {
    const start = Date.now();

    // 先检查是否已存在
    const check = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: `!!document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: true,
    });
    if (check.result?.result?.value === true) {
      return { found: true, elapsed: 0, method: 'already-present' };
    }

    // 注入 MutationObserver 等待
    const js = `new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { observer.disconnect(); resolve(false); }, ${timeoutMs});
      const observer = new MutationObserver(() => {
        if (document.querySelector(${JSON.stringify(selector)})) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(true);
        }
      });
      observer.observe(document.body || document.documentElement, {
        childList: true, subtree: true, attributes: true
      });
      // 再检查一次（observer 注册和检查之间可能有元素出现）
      if (document.querySelector(${JSON.stringify(selector)})) {
        observer.disconnect();
        clearTimeout(timeout);
        resolve(true);
      }
    })`;

    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js,
      returnByValue: true,
      awaitPromise: true,
      timeout: timeoutMs + 2000,
    });

    const found = resp.result?.result?.value === true;
    return { found, elapsed: Date.now() - start, method: found ? 'mutation-observer' : 'timeout' };
  }

  // --- 等待元素消失 ---
  async waitForElementGone(targetId, selector, timeoutMs = 10000) {
    const start = Date.now();

    const check = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: `!document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: true,
    });
    if (check.result?.result?.value === true) {
      return { gone: true, elapsed: 0 };
    }

    const js = `new Promise((resolve) => {
      const timeout = setTimeout(() => { observer.disconnect(); resolve(false); }, ${timeoutMs});
      const observer = new MutationObserver(() => {
        if (!document.querySelector(${JSON.stringify(selector)})) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(true);
        }
      });
      observer.observe(document.body || document.documentElement, {
        childList: true, subtree: true, attributes: true
      });
    })`;

    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
      timeout: timeoutMs + 2000,
    });

    return { gone: resp.result?.result?.value === true, elapsed: Date.now() - start };
  }

  // --- 等待文本出现（注入 Observer） ---
  async waitForText(targetId, text, timeoutMs = 10000) {
    const start = Date.now();

    const check = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: `document.body?.innerText?.includes(${JSON.stringify(text)})`,
      returnByValue: true,
    });
    if (check.result?.result?.value === true) {
      return { found: true, elapsed: 0, method: 'already-present' };
    }

    const js = `new Promise((resolve) => {
      const timeout = setTimeout(() => { observer.disconnect(); resolve(false); }, ${timeoutMs});
      const observer = new MutationObserver(() => {
        if (document.body?.innerText?.includes(${JSON.stringify(text)})) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(true);
        }
      });
      observer.observe(document.body || document.documentElement, {
        childList: true, subtree: true, characterData: true
      });
    })`;

    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
      timeout: timeoutMs + 2000,
    });

    return { found: resp.result?.result?.value === true, elapsed: Date.now() - start };
  }

  // --- 等待 URL 变化 ---
  async waitForUrlChange(targetId, urlPattern = null, timeoutMs = 15000) {
    await this.cdp.sendToTarget(targetId, 'Page.enable', {}).catch(() => {});
    const start = Date.now();

    const currentResp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: 'location.href', returnByValue: true,
    });
    const startUrl = currentResp.result?.result?.value || '';

    return new Promise((resolve) => {
      let resolved = false;
      const done = (r) => { if (resolved) return; resolved = true; clearTimeout(t); clearInterval(c); resolve(r); };
      const t = setTimeout(() => done({ changed: false, elapsed: Date.now() - start }), timeoutMs);
      const c = setInterval(async () => {
        try {
          const r = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
            expression: 'location.href', returnByValue: true,
          });
          const url = r.result?.result?.value;
          if (url && url !== startUrl) {
            if (!urlPattern || new RegExp(urlPattern, 'i').test(url)) {
              done({ changed: true, from: startUrl, to: url, elapsed: Date.now() - start });
            }
          }
        } catch {}
      }, 300);
    });
  }

  // --- 组合等待：页面加载 + 网络空闲 ---
  async waitForStable(targetId, timeoutMs = 20000) {
    const start = Date.now();
    const loadResult = await this.waitForPageLoad(targetId, timeoutMs);
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining > 2000) {
      const networkResult = await this.waitForNetworkIdle(targetId, Math.min(remaining, 5000), { idleTime: 1000 });
      return {
        load: loadResult,
        network: networkResult,
        elapsed: Date.now() - start,
      };
    }
    return { load: loadResult, elapsed: Date.now() - start };
  }
}

export default SmartWaiter;
