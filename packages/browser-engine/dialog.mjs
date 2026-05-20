// Dialog Handler Module
// 自动处理 alert/confirm/prompt/beforeunload 弹窗，防止 agent 卡死

export class DialogHandler {
  constructor(cdp) {
    this.cdp = cdp;
    this._enabled = new Set();       // 已启用自动处理的 targetId
    this._history = new Map();       // targetId -> [{type, message, url, defaultPrompt, action, timestamp}]
    this._policy = 'accept';         // 默认策略: 'accept' | 'dismiss' | 'log-only'
    this._promptText = '';           // confirm/prompt 的默认输入文本
    this._maxHistory = 50;
  }

  // 启用对话框自动处理
  async enable(targetId, opts = {}) {
    if (this._enabled.has(targetId)) return { alreadyEnabled: true };
    this._policy = opts.policy || 'accept';
    this._promptText = opts.promptText || '';

    await this.cdp.sendToTarget(targetId, 'Page.enable', {});

    this.cdp.onTarget('Page.javascriptDialogOpening', targetId, (params) => {
      const entry = {
        type: params.type,          // alert, confirm, prompt, beforeunload
        message: params.message,
        url: params.url,
        defaultPrompt: params.defaultPrompt || '',
        action: this._policy,
        timestamp: Date.now(),
      };

      // 记录历史
      if (!this._history.has(targetId)) this._history.set(targetId, []);
      const hist = this._history.get(targetId);
      hist.push(entry);
      if (hist.length > this._maxHistory) hist.shift();

      // 根据策略处理
      if (this._policy !== 'log-only') {
        const accept = this._policy === 'accept';
        this.cdp.sendToTarget(targetId, 'Page.handleJavaScriptDialog', {
          accept,
          promptText: accept && params.type === 'prompt' ? (this._promptText || params.defaultPrompt || '') : undefined,
        }).catch(() => {});  // 静默错误，弹窗可能已被用户关闭
      }
    });

    this._enabled.add(targetId);
    return { enabled: true, policy: this._policy };
  }

  // 禁用对话框自动处理
  disable(targetId) {
    this.cdp.offAllForTarget(targetId);
    this._enabled.delete(targetId);
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

  // 设置策略
  setPolicy(policy, promptText) {
    if (!['accept', 'dismiss', 'log-only'].includes(policy)) {
      return { error: '策略必须是 accept/dismiss/log-only' };
    }
    this._policy = policy;
    if (promptText !== undefined) this._promptText = promptText;
    return { policy: this._policy };
  }

  // Tab 关闭清理
  onTargetClosed(targetId) {
    this._enabled.delete(targetId);
    this._history.delete(targetId);
  }

  // 重连重置
  resetState() {
    this._enabled.clear();
    this._history.clear();
  }
}

export default DialogHandler;
