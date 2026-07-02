#!/usr/bin/env node
// Browser Engine Core - CDP 连接与命令层
// 连接 Edge/Chrome 浏览器的远程调试端口

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

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
  constructor() {
    this.ws = null;
    this.cmdId = 0;
    this.pending = new Map();
    this.sessions = new Map();
    this.eventHandlers = new Map();  // method -> Set<{handler, once}>
    this.targetHandlers = new Map(); // `${method}:${targetId}` -> Set<{handler, once}>
    this.port = null;
    this.wsPath = null;
    this.connectingPromise = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.autoReconnect = true;
    this._specifiedPort = null;
    this._onReconnectCallbacks = [];
  }

  // 注册重连后的回调（供外部模块重置状态）
  onReconnect(callback) { this._onReconnectCallbacks.push(callback); }

  // 自动发现浏览器调试端口
  async discoverPort() {
    const platform = os.platform();
    const paths = [];

    if (platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || '';
      paths.push(
        path.join(localAppData, 'Microsoft/Edge/User Data/DevToolsActivePort'),
        path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
      );
    } else if (platform === 'darwin') {
      const home = os.homedir();
      paths.push(
        path.join(home, 'Library/Application Support/Microsoft Edge/DevToolsActivePort'),
        path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
      );
    } else {
      const home = os.homedir();
      paths.push(
        path.join(home, '.config/microsoft-edge/DevToolsActivePort'),
        path.join(home, '.config/google-chrome/DevToolsActivePort'),
      );
    }

    for (const p of paths) {
      try {
        const content = fs.readFileSync(p, 'utf-8').trim();
        const lines = content.split('\n');
        const port = parseInt(lines[0]);
        if (port > 0 && port < 65536 && await this.checkPort(port)) {
          const wsPath = lines[1] || null;
          if (wsPath) {
            // 信任 DevToolsActivePort 文件（跳过 WebSocket 预检，连接时验证）
            console.log(`[Engine] 从 DevToolsActivePort 发现端口: ${port} (${p.includes('Edge') ? 'Edge' : 'Chrome'})`);
            return { port, wsPath };
          }
        }
      } catch { /* continue */ }
    }

    // 扫描常见端口
    const commonPorts = [59888, 9222, 9229, 9333];
    for (const port of commonPorts) {
      const wsUrl = await this.resolveBrowserWebSocket(port);
      if (wsUrl && await this.checkWebSocket(wsUrl)) {
        console.log(`[Engine] 扫描发现调试端口: ${port}`);
        return { port, wsPath: null };
      }
    }
    return null;
  }

  checkPort(port) {
    return new Promise((resolve) => {
      const socket = net.createConnection(port, '127.0.0.1');
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 2000);
      socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.once('error', () => { clearTimeout(timer); resolve(false); });
    });
  }

  async resolveBrowserWebSocket(port) {
    try {
      const versionInfo = await this.httpGet(`http://127.0.0.1:${port}/json/version`);
      const info = JSON.parse(versionInfo);
      return info.webSocketDebuggerUrl || null;
    } catch {
      return null;
    }
  }

  checkWebSocket(url, timeout = 3000) {
    return new Promise((resolve) => {
      let settled = false;
      const ws = new WS(url);
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), timeout);
      if (ws.on) {
        ws.on('open', () => done(true));
        ws.on('error', () => done(false));
      } else {
        ws.addEventListener('open', () => done(true));
        ws.addEventListener('error', () => done(false));
      }
    });
  }

  async connect(specifiedPort = null) {
    if (this.ws && (this.ws.readyState === WS.OPEN || this.ws.readyState === 1)) return;
    if (this.connectingPromise) return this.connectingPromise;

    if (specifiedPort) this._specifiedPort = specifiedPort;
    if (specifiedPort && !this.port) {
      // 指定了端口但还没发现 wsPath，尝试读 DevToolsActivePort
      const discovered = await this.discoverPort();
      if (discovered && discovered.port === specifiedPort) {
        this.port = discovered.port;
        this.wsPath = discovered.wsPath;
      } else {
        this.port = specifiedPort;
        this.wsPath = null;
      }
    } else if (!this.port) {
      const discovered = await this.discoverPort();
      if (!discovered) throw new Error('未发现浏览器调试端口。请确认 Edge 已开启远程调试。');
      this.port = discovered.port;
      this.wsPath = discovered.wsPath;
    }

    // 获取 WebSocket URL — 优先 HTTP 发现（最新），DevToolsActivePort 作备选
    let wsUrl;
    try {
      const versionInfo = await this.httpGet(`http://127.0.0.1:${this.port}/json/version`);
      const info = JSON.parse(versionInfo);
      wsUrl = info.webSocketDebuggerUrl;
      console.log(`[Engine] 浏览器: ${info.Browser || 'unknown'}`);
    } catch {
      if (this.wsPath) {
        wsUrl = `ws://127.0.0.1:${this.port}${this.wsPath}`;
        console.log(`[Engine] HTTP 不可用，使用 DevToolsActivePort 路径`);
      } else {
        wsUrl = `ws://127.0.0.1:${this.port}/devtools/browser`;
        console.log(`[Engine] HTTP 发现失败，尝试通用 WebSocket 路径`);
      }
    }

    return this.connectingPromise = new Promise((resolve, reject) => {
      let settled = false;
      let shouldReconnect = true;
      this.ws = new WS(wsUrl);
      const wasReconnect = this.reconnectAttempts > 0;
      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        shouldReconnect = false;
        this.connectingPromise = null;
        try { this.ws?.close?.(); } catch {}
        this.ws = null;
        this.port = null;
        this.wsPath = null;
        reject(new Error(`连接浏览器超时: ${wsUrl}`));
      }, 5000);
      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        this.connectingPromise = null;
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
        this.ws = null;
        this.port = null;
        this.wsPath = null;
        reject(new Error(e.message || '连接失败'));
      };
      const onClose = () => {
        console.log('[Engine] 连接断开');
        this.ws = null;
        this.sessions.clear();
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          this.connectingPromise = null;
        }
        // 自动重连
        if (shouldReconnect && this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 15000);
          console.log(`[Engine] ${delay}ms 后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          setTimeout(() => {
            this.connect(this._specifiedPort).catch(e => {
              console.error('[Engine] 重连失败:', e.message);
            });
          }, delay);
        }
      };
      const onMessage = (evt) => {
        const data = typeof evt === 'string' ? evt : (evt.data || evt);
        const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
        if (msg.method === 'Target.attachedToTarget') {
          this.sessions.set(msg.params.targetInfo.targetId, msg.params.sessionId);
        }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, timer } = this.pending.get(msg.id);
          clearTimeout(timer);
          this.pending.delete(msg.id);
          resolve(msg);
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
      http.get(url, { timeout: 3000 }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      }).on('error', reject);
    });
  }

  send(method, params = {}, sessionId = null, timeout = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || (this.ws.readyState !== WS.OPEN && this.ws.readyState !== 1)) {
        return reject(new Error('WebSocket 未连接'));
      }
      const id = ++this.cmdId;
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时: ${method} (${timeout}ms)`));
      }, timeout);
      this.pending.set(id, { resolve, timer });
      this.ws.send(JSON.stringify(msg));
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

  // 带自动重试的 session 命令执行
  async sendToTarget(targetId, method, params = {}, timeout = 30000) {
    const attempt = async (retry) => {
      const sid = await this.ensureSession(targetId, retry);
      const resp = await this.send(method, params, sid, timeout);
      if (resp.error) {
        // session 失效类错误，重试一次
        if (!retry && (resp.error.message?.includes('not found') ||
            resp.error.message?.includes('detached') ||
            resp.error.code === -32001 || resp.error.code === -32602)) {
          return attempt(true);
        }
        throw new Error(resp.error.message || JSON.stringify(resp.error));
      }
      return resp;
    };
    try {
      return await attempt(false);
    } catch (e) {
      // 超时或其他错误，尝试重新 attach 一次
      if (e.message?.includes('超时') || e.message?.includes('timeout')) {
        try { return await attempt(true); } catch { /* throw original */ }
      }
      throw e;
    }
  }

  get connected() {
    return this.ws && (this.ws.readyState === WS.OPEN || this.ws.readyState === 1);
  }
}

export default CDPConnection;
