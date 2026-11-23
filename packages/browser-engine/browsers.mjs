import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const defaultBrowser = process.env.ENGINE_BROWSER || 'edge';

export function browserProfile(browser, userDataDir) {
  if (!['edge', 'chrome'].includes(browser)) throw new Error(`Unknown browser: ${browser}. Use edge or chrome.`);
  if (userDataDir) return userDataDir;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA, browser === 'edge' ? 'Microsoft/Edge/User Data' : 'Google/Chrome/User Data');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support', browser === 'edge' ? 'Microsoft Edge' : 'Google/Chrome');
  return path.join(os.homedir(), '.config', browser === 'edge' ? 'microsoft-edge' : 'google-chrome');
}

export function urlMatchesScope(allowedUrl, candidateUrl) {
  if (!/^https?:\/\//.test(candidateUrl || '')) return false;
  let a, u;
  try { a = new URL(allowedUrl); u = new URL(candidateUrl); } catch { return false; }
  if (a.origin !== u.origin) return false;
  if (a.pathname.endsWith('/*')) {
    const base = a.pathname.slice(0, -2);
    return !base || u.pathname === base || u.pathname.startsWith(base + '/');
  }
  if (a.pathname === '/') return u.pathname === '/';
  const prefix = a.pathname.endsWith('/') ? a.pathname : a.pathname + '/';
  return u.pathname === a.pathname || u.pathname.startsWith(prefix);
}

export function inspectBrowserEndpoint(browser, userDataDir) {
  const profile = browserProfile(browser, userDataDir);
  const file = path.join(profile, 'DevToolsActivePort');
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      browser,
      profile,
      port: null,
      wsPath: null,
      error: `${browser}: DevToolsActivePort not found`,
      hint: `请在 ${browser} 中打开 ${browser}://inspect/#remote-debugging 并开启远程调试（不自动启动浏览器）`,
    };
  }
  const [portText, wsPath] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !wsPath?.startsWith('/devtools/browser/')) {
    return {
      ok: false,
      browser,
      profile,
      port: Number.isInteger(port) ? port : null,
      wsPath: wsPath || null,
      error: `${browser}: invalid DevToolsActivePort in ${profile}`,
      hint: `请重启 ${browser} 或重新开启 ${browser}://inspect/#remote-debugging`,
    };
  }
  return { ok: true, browser, profile, port, wsPath, error: null, hint: null };
}

export function readBrowserEndpoint(browser, userDataDir) {
  const profile = browserProfile(browser, userDataDir);
  const file = path.join(profile, 'DevToolsActivePort');
  if (!fs.existsSync(file)) throw new Error(`${browser}: enable remote debugging in ${browser}://inspect/#remote-debugging. No browser will be launched.`);
  const [portText, wsPath] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !wsPath?.startsWith('/devtools/browser/')) throw new Error(`${browser}: invalid DevToolsActivePort in ${profile}`);
  return { port, wsPath, profile };
}
