// Auto-Screenshot Module
// 每次可视操作后自动截图，供 AI 验证操作结果
// 参考 cdp-skill 的 "每次可视操作自动截图" 设计

import fs from 'node:fs';
import path from 'node:path';

export class AutoScreenshot {
  constructor(cdp, page) {
    this.cdp = cdp;
    this.page = page;        // PageAnalyzer 实例（复用 screenshot 方法）
    this._enabled = new Map();  // targetId -> { dir, history, maxHistory }
    this._globalEnabled = false;
    this._defaultDir = path.join(process.cwd(), '.screenshots');
  }

  // 启用自动截图
  enable(targetId, opts = {}) {
    const dir = opts.dir || this._defaultDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this._enabled.set(targetId, {
      dir,
      history: [],
      maxHistory: opts.maxHistory || 20,
      format: opts.format || 'jpeg',
      quality: opts.quality || 60,
    });
    return { enabled: true, dir };
  }

  // 全局启用（新 tab 自动开启）
  enableGlobal(opts = {}) {
    this._globalEnabled = true;
    this._defaultDir = opts.dir || this._defaultDir;
    return { globalEnabled: true, dir: this._defaultDir };
  }

  disable(targetId) {
    this._enabled.delete(targetId);
    return { disabled: true };
  }

  disableGlobal() {
    this._globalEnabled = false;
    return { globalDisabled: true };
  }

  isEnabled(targetId) {
    return this._enabled.has(targetId) || this._globalEnabled;
  }

  // 执行截图（操作后调用）
  async capture(targetId, actionName = 'action') {
    let config = this._enabled.get(targetId);
    if (!config && this._globalEnabled) {
      this.enable(targetId);
      config = this._enabled.get(targetId);
    }
    if (!config) return null;

    const ts = Date.now();
    const filename = `${ts}_${actionName.replace(/[^a-zA-Z0-9]/g, '_')}.${config.format}`;
    const filePath = path.join(config.dir, filename);

    try {
      await this.page.screenshot(targetId, filePath, {
        format: config.format,
        quality: config.quality,
      });
      const entry = { file: filePath, action: actionName, time: ts };
      config.history.push(entry);
      if (config.history.length > config.maxHistory) {
        const old = config.history.shift();
        try { fs.unlinkSync(old.file); } catch {}
      }
      return entry;
    } catch {
      return null;
    }
  }

  // 获取截图历史
  getHistory(targetId, limit = 10) {
    const config = this._enabled.get(targetId);
    if (!config) return [];
    return config.history.slice(-limit);
  }

  // 获取最新截图的 base64
  async getLatest(targetId) {
    const config = this._enabled.get(targetId);
    if (!config || !config.history.length) return { error: '无截图' };
    const latest = config.history[config.history.length - 1];
    try {
      const data = fs.readFileSync(latest.file);
      return { ...latest, base64: data.toString('base64') };
    } catch {
      return { error: '文件不存在', ...latest };
    }
  }

  // Tab 关闭清理
  onTargetClosed(targetId) {
    this._enabled.delete(targetId);
  }

  // 重连重置
  resetState() {
    this._enabled.clear();
  }
}

export default AutoScreenshot;
