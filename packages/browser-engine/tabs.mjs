// Tab Management Module
// 管理浏览器标签页：创建、关闭、导航、分组

export class TabManager {
  constructor(cdp) {
    this.cdp = cdp;
    this.managedTabs = new Map(); // targetId -> { url, title, created, lastAccessed, group }
    this.TAB_IDLE_TIMEOUT = parseInt(process.env.TAB_IDLE_TIMEOUT || '1800000'); // 30min
    this._onCloseCallbacks = []; // 外部模块注册的 tab 关闭回调
  }

  // 注册 tab 关闭时的清理回调（供其他模块使用）
  onTabClose(callback) { this._onCloseCallbacks.push(callback); }

  touch(targetId) {
    const entry = this.managedTabs.get(targetId);
    if (entry) entry.lastAccessed = Date.now();
  }

  async listAll() {
    const resp = await this.cdp.send('Target.getTargets');
    return resp.result.targetInfos.filter(t => t.type === 'page').map(t => ({
      targetId: t.targetId,
      url: t.url,
      title: t.title,
      managed: this.managedTabs.has(t.targetId),
      group: this.managedTabs.get(t.targetId)?.group || null,
    }));
  }

  async create(url = 'about:blank', group = 'default') {
    const resp = await this.cdp.send('Target.createTarget', { url, background: true });
    const targetId = resp.result.targetId;
    this.managedTabs.set(targetId, {
      url, title: '', created: Date.now(), lastAccessed: Date.now(), group
    });
    // 等待加载
    if (url !== 'about:blank') {
      try {
        await this.waitForLoad(targetId);
        // 更新标题
        const info = await this.getInfo(targetId);
        const entry = this.managedTabs.get(targetId);
        if (entry && info) { entry.title = info.title; entry.url = info.url; }
      } catch { /* non-fatal */ }
    }
    return targetId;
  }

  async close(targetId) {
    await this.cdp.send('Target.closeTarget', { targetId });
    this.cdp.offAllForTarget(targetId);
    this.cdp.sessions.delete(targetId);
    this.managedTabs.delete(targetId);
    // 通知其他模块清理该 target 的状态
    for (const cb of this._onCloseCallbacks) { try { cb(targetId); } catch {} }
  }

  async closeAll() {
    const targets = [...this.managedTabs.keys()];
    for (const targetId of targets) {
      try { await this.close(targetId); } catch { /* ignore */ }
    }
    return targets.length;
  }

  async closeGroup(group) {
    let count = 0;
    for (const [targetId, info] of this.managedTabs) {
      if (info.group === group) {
        try { await this.close(targetId); count++; } catch { /* ignore */ }
      }
    }
    return count;
  }

  async navigate(targetId, url) {
    const resp = await this.cdp.sendToTarget(targetId, 'Page.navigate', { url });
    await this.waitForLoad(targetId);
    const entry = this.managedTabs.get(targetId);
    if (entry) { entry.url = url; entry.lastAccessed = Date.now(); }
    return resp.result;
  }

  async back(targetId) {
    await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', { expression: 'history.back()' });
    await this.waitForLoad(targetId);
  }

  async forward(targetId) {
    await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', { expression: 'history.forward()' });
    await this.waitForLoad(targetId);
  }

  async reload(targetId) {
    await this.cdp.sendToTarget(targetId, 'Page.reload', {});
    await this.waitForLoad(targetId);
  }

  async getInfo(targetId) {
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: 'JSON.stringify({title:document.title,url:location.href,ready:document.readyState,scroll:{x:window.scrollX,y:window.scrollY},size:{w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,vw:window.innerWidth,vh:window.innerHeight}})',
      returnByValue: true,
    });
    try { return JSON.parse(resp.result?.result?.value || '{}'); } catch { return {}; }
  }

  async waitForLoad(targetId, timeoutMs = 20000) {
    try { await this.cdp.sendToTarget(targetId, 'Page.enable', {}); } catch {}
    return new Promise((resolve) => {
      let resolved = false;
      const done = (r) => { if (resolved) return; resolved = true; clearTimeout(timer); clearInterval(ci); resolve(r); };
      const timer = setTimeout(() => done('timeout'), timeoutMs);
      const ci = setInterval(async () => {
        try {
          const r = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
            expression: 'document.readyState', returnByValue: true
          });
          if (r.result?.result?.value === 'complete') done('complete');
        } catch { /* ignore */ }
      }, 400);
    });
  }

  async cleanupIdle() {
    const now = Date.now();
    let count = 0;
    for (const [targetId, info] of this.managedTabs) {
      if (now - info.lastAccessed > this.TAB_IDLE_TIMEOUT) {
        try { await this.close(targetId); count++; } catch { /* ignore */ }
      }
    }
    return count;
  }
}

export default TabManager;
