#!/usr/bin/env node
// Browser Engine 启动器
// 检查依赖 → 发现浏览器 → 启动服务

import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.ENGINE_PORT || '3456');

async function checkHealth() {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}/health`, { timeout: 2000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const info = JSON.parse(d);
          resolve(info);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function httpGet(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(d);
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTP timeout'));
    });
    req.on('error', reject);
  });
}

function checkWebSocket(url, timeout = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocket(url);
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeout);
    ws.addEventListener('open', () => done(true));
    ws.addEventListener('error', () => done(false));
  });
}

async function readDevToolsPort() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const files = [
    path.join(localAppData, 'Microsoft/Edge/User Data/DevToolsActivePort'),
    path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
  ];
  for (const file of files) {
    try {
      const [portLine, wsPath] = fs.readFileSync(file, 'utf-8').trim().split(/\r?\n/);
      const port = parseInt(portLine);
      if (port > 0 && wsPath && await checkWebSocket(`ws://127.0.0.1:${port}${wsPath}`)) return port;
    } catch {}
  }
  return null;
}

async function checkBrowserPort() {
  const discovered = await readDevToolsPort();
  if (discovered) return discovered;

  // 扫描端口
  const ports = [59888, 9222, 9229];
  for (const port of ports) {
    try {
      const info = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json/version`, 1500));
      if (info.webSocketDebuggerUrl && await checkWebSocket(info.webSocketDebuggerUrl)) return port;
    } catch {}
  }
  return null;
}

async function main() {
  console.log('=== Browser Engine 启动检查 ===\n');

  // 1. Node.js 版本
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  if (major < 22) {
    console.log(`❌ Node.js ${nodeVersion} (需要 22+)`);
    process.exit(1);
  }
  console.log(`✓ Node.js ${nodeVersion}`);

  // 2. 检查浏览器调试端口
  const browserPort = await checkBrowserPort();
  if (!browserPort) {
    console.log('❌ 未发现浏览器调试端口');
    console.log('  请在 Edge 地址栏打开 edge://inspect/#remote-debugging');
    console.log('  勾选 "Allow remote debugging for this browser instance"');
    process.exit(1);
  }
  console.log(`✓ 浏览器调试端口: ${browserPort}`);

  // 3. 获取浏览器信息
  try {
    const info = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${browserPort}/json/version`, { timeout: 3000 }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
      }).on('error', reject);
    });
    console.log(`✓ 浏览器: ${info.Browser || 'unknown'}`);
  } catch {
    console.log('⚠ 无法获取浏览器版本信息（不影响使用）');
  }

  // 4. 检查 Engine 是否已运行
  const health = await checkHealth();
  if (health?.status === 'ok') {
    console.log(`\n✓ Browser Engine 已在运行 (端口 ${PORT})`);
    console.log(`  浏览器连接: ${health.connected ? '已连接' : '未连接'}`);
    console.log(`  管理的 Tab: ${health.managedTabs}`);
    console.log(`  运行时间: ${Math.round(health.uptime)}s`);
    return;
  }

  // 5. 启动 Engine
  console.log(`\n启动 Browser Engine (端口 ${PORT})...`);
  const { spawn } = await import('node:child_process');
  const child = spawn('node', [path.join(__dirname, 'server.mjs'), '--browser-port', String(browserPort)], {
    cwd: __dirname,
    stdio: 'inherit',
    detached: false,
  });

  child.on('error', (e) => {
    console.error('启动失败:', e.message);
    process.exit(1);
  });

  // 等待启动
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    const h = await checkHealth();
    if (h?.status === 'ok') {
      console.log(`\n✓ Browser Engine 启动成功!`);
      console.log(`  API: http://localhost:${PORT}`);
      console.log(`  浏览器: ${h.connected ? '已连接' : '连接中...'}`);
      return;
    }
  }
}

main().catch(e => {
  console.error('错误:', e.message);
  process.exit(1);
});
