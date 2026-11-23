#!/usr/bin/env node
// Browser Engine Core - CDP 连接与命令层
// 连接 Edge/Chrome 浏览器的远程调试端口

import http from 'node:http';
import { defaultBrowser, readBrowserEndpoint } from './browsers.mjs';

// --- WebSocket 兼容层 ---
let WS;
if (typeof globalThis.WebSocket !== 'undefined') {
  WS = globalThis.WebSocket;
} else {
  try { WS = (await import('ws')).default; } catch {
    console.error('[Engine] Node.js 22+ required or install ws module');
    process.exit(1);
  }
}

export class CDPConnection {
  constructor({ browser = defaultBrowser, userDataDir, endpoint, connectTimeout=300000, WebSocket: CustomWS } = {}) {
    this.browser = browser;
    this.userDataDir = userDataDir;
    this.endpoint = endpoint;
    this.connectTimeout=connectTimeout;
    this._WS = CustomWS || WS;
    this.ws = null;
    this.cmdId = 0;
    this.pending = new Map();
    this.sessions = new Map();
    this.targetParents = new Map();
    this.targetInfo = new Map();
    this.eventHandlers = new Map();  // method -> Set<{handler, once}>
    this.targetHandlers = new Map(); // `${method}:${targetId}` -> Set<{handler, once}>
    this.port = null;
    this.wsPath = null;
    this.connectingPromise = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.autoReconnect = false;
    this._everConnected = false;
    this._reconnectTimer = null;
    this._specifiedPort = null;
    this._onReconnectCallbacks = [];
  }

  // 注册重连后的回调（供外部模块重置状态）
  onReconnect(callback) { this._onReconnectCallbacks.push(callback); }

  // 自动发现浏览器调试端口
  async discoverPort() {
    return readBrowserEndpoint(this.browser, this.userDataDir);
  }

  async connect(specifiedPort = null) {
    if (this.ws && (this.ws.readyState === this._WS.OPEN || this.ws.readyState === 1)) return;
    if (this.connectingPromise) return this.connectingPromise;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._specifiedPort = specifiedPort;

    let wsUrl = this.endpoint;
    if (!wsUrl) {
      const discovered = readBrowserEndpoint(this.browser, this.userDataDir);
      if (specifiedPort && Number(specifiedPort) !== discovered.port) {
        throw new Error(`${this.browser}: selected port ${specifiedPort} does not match its profile port ${discovered.port}`);
      }
      this.port = discovered.port;
      this.wsPath = discovered.wsPath;
      wsUrl = `ws://127.0.0.1:${this.port}${this.wsPath}`;
    }

    return this.connectingPromise = new Promise((resolve, reject) => {
      let settled = false;
      let shouldReconnect = true;
      const socket = new this._WS(wsUrl);
      this.ws = socket;
      const wasReconnect = this._everConnected;
      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        shouldReconnect = false;
        this.connectingPromise = null;
        try { socket.close(); } catch {}
        this.ws = null;
        this.port = null;
        this.wsPath = null;
        reject(new Error(`${this.browser}: 等待现有浏览器连接超时；请检查远程调试授权。未切换浏览器或新建窗口。`));
      }, this.connectTimeout);
      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        this.connectingPromise = null;
        this._everConnected = true;
        this.reconnectAttempts = 0;
        console.log(`[Engine] 已连接浏览器 (端口 ${this.port})`);
        if (wasReconnect) {
          console.log('[Engine] 重连成功，通知模块重置状态');
          for (const cb of this._onReconnectCallbacks) { try { cb(); } catch {} }
        }
        resolve();
      };
      const onError = (e) => {
        if (settled) return;
        settled = true;
        shouldReconnect = false;
        clearTimeout(connectTimer);
        this.connectingPromise = null;
        const failedPort = this.port;
        this.ws = null;
        this.port = null;
        this.wsPath = null;
        const detail = e?.message || `无法连接 ${this.browser} 调试端口 ${failedPort || '(未知)'}`;
        reject(new Error(`${this.browser}: ${detail}；请检查 ${this.browser} 是否运行并已开启远程调试。`));
      };
      const onClose = () => {
        if (this.ws && this.ws !== socket) return;
        console.log('[Engine] 连接断开');
        this.ws = null;
        this.sessions.clear();
        this.targetParents.clear();
        this.targetInfo.clear();
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          this.connectingPromise = null;
          reject(new Error(`${this.browser}: connection closed before authorization`));
        }
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Object.assign(new Error('Browser connection closed; inspect the action outcome'),{code:'CDP_DISCONNECTED',outcome:'unknown'})); }
        this.pending.clear();
        // 自动重连
        if (shouldReconnect && this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 15000);
          console.log(`[Engine] ${delay}ms 后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this.connect(this._specifiedPort).catch(e => {
              console.error('[Engine] 重连失败:', e.message);
            });
          }, delay);
          this._reconnectTimer.unref?.();
        }
      };
      const onMessage = (evt) => {
        const data = typeof evt === 'string' ? evt : (evt.data || evt);
        const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
        if (msg.method === 'Target.attachedToTarget') {
          const parent = [...this.sessions].find(([,sid]) => sid === msg.sessionId)?.[0];
          if (parent) this.targetParents.set(msg.params.targetInfo.targetId, parent);
          this.targetInfo.set(msg.params.targetInfo.targetId, msg.params.targetInfo);
          this.sessions.set(msg.params.targetInfo.targetId, msg.params.sessionId);
        }
        if (msg.method === 'Target.detachedFromTarget') {
          for (const [targetId, sessionId] of this.sessions) {
            if (sessionId === msg.params.sessionId) {
              this.sessions.delete(targetId);
              this.targetParents.delete(targetId);
              this.targetInfo.delete(targetId);
            }
          }
        }
        if (msg.method === 'Target.targetDestroyed') {
          this.sessions.delete(msg.params.targetId);
          this.targetParents.delete(msg.params.targetId);
          this.targetInfo.delete(msg.params.targetId);
        }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject, timer } = this.pending.get(msg.id);
          clearTimeout(timer);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
          else resolve(msg);
        }
        // 触发全局事件处理器
        if (msg.method) {
          const set = this.eventHandlers.get(msg.method);
          if (set) {
            const toRemove = [];
            for (const entry of set) {
              try { entry.handler(msg.params, msg.sessionId); } catch {}
              if (entry.once) toRemove.push(entry);
            }
            for (const e of toRemove) set.delete(e);
          }
          // 触发 target 隔离的事件处理器（通过 sessionId 反查 targetId）
          if (msg.sessionId) {
            let targetId = null;
            for (const [tid, sid] of this.sessions) {
              if (sid === msg.sessionId) { targetId = tid; break; }
            }
            if (targetId) {
              const key = `${msg.method}:${targetId}`;
              const tset = this.targetHandlers.get(key);
              if (tset) {
                const toRemove = [];
                for (const entry of tset) {
                  try { entry.handler(msg.params, msg.sessionId); } catch {}
                  if (entry.once) toRemove.push(entry);
                }
                for (const e of toRemove) tset.delete(e);
              }
            }
          }
        }
      };

      if (this.ws.on) {
        this.ws.on('open', onOpen);
        this.ws.on('error', onError);
        this.ws.on('close', onClose);
        this.ws.on('message', onMessage);
      } else {
        this.ws.addEventListener('open', onOpen);
        this.ws.addEventListener('error', onError);
        this.ws.addEventListener('close', onClose);
        this.ws.addEventListener('message', onMessage);
      }
    });
  }

  httpGet(url) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: 3000 }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => res.statusCode === 200 ? resolve(d) : reject(new Error(`HTTP ${res.statusCode}`)));
      }).on('error', reject);
      req.on('timeout', () => req.destroy(new Error('HTTP discovery timeout')));
    });
  }

  send(method, params = {}, sessionId = null, timeout = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || (this.ws.readyState !== WS.OPEN && this.ws.readyState !== 1)) {
        return reject(Object.assign(new Error('WebSocket 未连接'),{code:'CDP_DISCONNECTED',outcome:'not_sent'}));
      }
      const id = ++this.cmdId;
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`CDP 超时: ${method} (${timeout}ms); 检查实际结果后再决定下一步`),
          { code: 'CDP_TIMEOUT', method, outcome: 'unknown' }));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify(msg)); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  // --- 事件管理 ---
  on(method, handler) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, new Set());
    const entry = { handler, once: false };
    this.eventHandlers.get(method).add(entry);
    return entry; // 返回引用，方便 off() 使用
  }

  once(method, handler) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, new Set());
    const entry = { handler, once: true };
    this.eventHandlers.get(method).add(entry);
    return entry;
  }

  off(method, entryOrHandler) {
    const set = this.eventHandlers.get(method);
    if (!set) return;
    if (typeof entryOrHandler === 'object' && entryOrHandler.handler) {
      set.delete(entryOrHandler);
    } else {
      // 按函数引用删除
      for (const entry of set) {
        if (entry.handler === entryOrHandler) { set.delete(entry); break; }
      }
    }
    if (set.size === 0) this.eventHandlers.delete(method);
  }

  // 按 targetId 隔离的事件监听（只接收该 target 的 session 事件）
  onTarget(method, targetId, handler) {
    const key = `${method}:${targetId}`;
    if (!this.targetHandlers.has(key)) this.targetHandlers.set(key, new Set());
    const entry = { handler, once: false };
    this.targetHandlers.get(key).add(entry);
    return entry;
  }

  onceTarget(method, targetId, handler) {
    const key = `${method}:${targetId}`;
    if (!this.targetHandlers.has(key)) this.targetHandlers.set(key, new Set());
    const entry = { handler, once: true };
    this.targetHandlers.get(key).add(entry);
    return entry;
  }

  offTarget(method, targetId, entryOrHandler) {
    const key = `${method}:${targetId}`;
    const set = this.targetHandlers.get(key);
    if (!set) return;
    if (typeof entryOrHandler === 'object' && entryOrHandler.handler) {
      set.delete(entryOrHandler);
    } else {
      for (const e of set) { if (e.handler === entryOrHandler) { set.delete(e); break; } }
    }
    if (set.size === 0) this.targetHandlers.delete(key);
  }

  // 清除某个 target 的所有事件监听
  offAllForTarget(targetId) {
    for (const [key] of this.targetHandlers) {
      if (key.endsWith(':' + targetId)) this.targetHandlers.delete(key);
    }
  }

  async ensureSession(targetId, forceReattach = false) {
    if (!forceReattach && this.sessions.has(targetId)) return this.sessions.get(targetId);
    // 先尝试 detach 旧 session（忽略错误）
    if (this.sessions.has(targetId)) {
      try { await this.send('Target.detachFromTarget', { sessionId: this.sessions.get(targetId) }); } catch {}
      this.sessions.delete(targetId);
    }
    const resp = await this.send('Target.attachToTarget', { targetId, flatten: true });
    if (resp.result?.sessionId) {
      this.sessions.set(targetId, resp.result.sessionId);
      return resp.result.sessionId;
    }
    throw new Error('attach 失败: ' + JSON.stringify(resp.error));
  }

  // A timeout can mean the page already acted. Never replay a command implicitly.
  async sendToTarget(targetId, method, params = {}, timeout = 30000) {
    const sid = await this.ensureSession(targetId);
    try {
      return await this.send(method, params, sid, timeout);
    } catch (error) {
      if (/Session with given id not found|Target closed|No target with given id/i.test(error.message || '')) {
        this.sessions.delete(targetId);
        error.outcome = 'not_sent';
      }
      throw error;
    }
  }

  get connected() {
    return Boolean(this.ws && (this.ws.readyState === (this._WS?.OPEN ?? 1) || this.ws.readyState === 1));
  }
}

export default CDPConnection;
