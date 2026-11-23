// Dialog Handler Module
// 自动处理 alert/confirm/prompt/beforeunload 弹窗，防止 agent 卡死

export class DialogHandler {
  constructor(cdp) {
    this.cdp = cdp;
    this._listeners = new Map();     // targetId -> { entry, policy, promptText }
    this._history = new Map();       // targetId -> [{type, message, url, defaultPrompt, action, timestamp}]
    this._policy = 'accept';         // 默认策略: 'accept' | 'dismiss' | 'log-only'
    this._promptText = '';           // confirm/prompt 的默认输入文本
    this._maxHistory = 50;
  }

  // 启用对话框自动处理
  async enable(targetId, opts = {}) {
    if (this._listeners.has(targetId)) return { alreadyEnabled: true };
    const state = {
      policy: opts.policy || this._policy,
      promptText: opts.promptText ?? this._promptText,
      entry: null,
    };

    await this.cdp.sendToTarget(targetId, 'Page.enable', {});

    state.entry = this.cdp.onTarget('Page.javascriptDialogOpening', targetId, (params) => {
      const entry = {
        type: params.type,          // alert, confirm, prompt, beforeunload
        message: params.message,
        url: params.url,
        defaultPrompt: params.defaultPrompt || '',
        action: state.policy,
        timestamp: Date.now(),
      };

      // 记录历史
      if (!this._history.has(targetId)) this._history.set(targetId, []);
      const hist = this._history.get(targetId);
      hist.push(entry);
      if (hist.length > this._maxHistory) hist.shift();

      // 根据当前 target 策略处理
      if (state.policy !== 'log-only') {
        const accept = state.policy === 'accept';
        this.cdp.sendToTarget(targetId, 'Page.handleJavaScriptDialog', {
          accept,
          promptText: accept && params.type === 'prompt' ? (state.promptText || params.defaultPrompt || '') : undefined,
        }).catch(() => {});  // 静默错误，弹窗可能已被用户关闭
      }
    });

    this._listeners.set(targetId, state);
    return { enabled: true, policy: state.policy };
  }

  // 禁用对话框自动处理（仅移除本模块注册的监听器）
  disable(targetId) {
    const state = this._listeners.get(targetId);
    if (state?.entry) this.cdp.offTarget('Page.javascriptDialogOpening', targetId, state.entry);
    this._listeners.delete(targetId);
    return { disabled: true };
  }

  // 获取对话框历史
  getHistory(targetId) {
    return this._history.get(targetId) || [];
  }

  // 清除历史
  clearHistory(targetId) {
    if (targetId) {
      this._history.delete(targetId);
    } else {
      this._history.clear();
    }
    return { cleared: true };
  }

  // 手动处理当前对话框（覆盖自动策略）
  async handle(targetId, accept = true, promptText = '') {
    await this.cdp.sendToTarget(targetId, 'Page.handleJavaScriptDialog', {
      accept,
      promptText: accept ? promptText : undefined,
    });
    return { handled: true, accept };
  }

  // 设置策略（传入 targetId 时仅更新对应标签，否则更新全局默认与已启用标签）
  setPolicy(policy, promptText, targetId = null) {
    if (!['accept', 'dismiss', 'log-only'].includes(policy)) {
      return { error: '策略必须是 accept/dismiss/log-only' };
    }
    if (targetId) {
      const state = this._listeners.get(targetId);
      if (state) {
        state.policy = policy;
        if (promptText !== undefined) state.promptText = promptText;
      }
      return { policy, targetId };
    }
    this._policy = policy;
    if (promptText !== undefined) this._promptText = promptText;
    for (const state of this._listeners.values()) {
      state.policy = policy;
      if (promptText !== undefined) state.promptText = promptText;
    }
    return { policy: this._policy };
  }

  // Tab 关闭清理
  onTargetClosed(targetId) {
    this.disable(targetId);
    this._history.delete(targetId);
  }

  // 重连重置
  resetState() {
    for (const tid of [...this._listeners.keys()]) this.disable(tid);
    this._history.clear();
  }
}

export default DialogHandler;
