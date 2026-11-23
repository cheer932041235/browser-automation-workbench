// Cross-Navigation Module
// 跨页面导航保留 console/network 数据，自动重新启用监控
// 监听 Page.frameNavigated 事件，导航后自动 re-enable Runtime + Network

export class NavigationTracker {
  constructor(cdp) {
    this.cdp = cdp;
    this._tracked = new Map();      // targetId -> { consoleEnabled, networkEnabled, history }
    this._maxNavHistory = 30;
  }

  // 启用跨导航追踪
  async enable(targetId, opts = {}) {
    if (this._tracked.has(targetId)) return { alreadyEnabled: true };

    const state = {
      consoleEnabled: opts.console !== false,
      networkEnabled: opts.network !== false,
      history: [],
      entry: null,
    };
    this._tracked.set(targetId, state);

    await this.cdp.sendToTarget(targetId, 'Page.enable', {});

    // 监听 frameNavigated 事件
    state.entry = this.cdp.onTarget('Page.frameNavigated', targetId, async (params) => {
      // 只关注主框架导航
      if (params.frame?.parentId) return;

      const entry = {
        url: params.frame?.url || '',
        ts: Date.now(),
        securityOrigin: params.frame?.securityOrigin || '',
      };
      state.history.push(entry);
      if (state.history.length > this._maxNavHistory) state.history.shift();

      // 自动重新启用 Runtime 和 Network（导航后可能需要重新发送 enable）
      try {
        if (state.consoleEnabled) {
          await this.cdp.sendToTarget(targetId, 'Runtime.enable', {});
        }
        if (state.networkEnabled) {
          await this.cdp.sendToTarget(targetId, 'Network.enable', {});
        }
      } catch { /* session might be transitioning */ }
    });

    return { enabled: true, console: state.consoleEnabled, network: state.networkEnabled };
  }

  // 禁用（仅移除本模块注册的监听器）
  disable(targetId) {
    const state = this._tracked.get(targetId);
    if (state?.entry) this.cdp.offTarget('Page.frameNavigated', targetId, state.entry);
    this._tracked.delete(targetId);
    return { disabled: true };
  }

  // 获取导航历史
  getHistory(targetId) {
    return this._tracked.get(targetId)?.history || [];
  }

  // 获取当前 URL（最新导航）
  getCurrentUrl(targetId) {
    const hist = this._tracked.get(targetId)?.history;
    return hist?.length ? hist[hist.length - 1].url : null;
  }

  // Tab 关闭清理
  onTargetClosed(targetId) {
    this.disable(targetId);
  }

  // 重连重置
  resetState() {
    for (const tid of [...this._tracked.keys()]) this.disable(tid);
  }
}

export default NavigationTracker;
