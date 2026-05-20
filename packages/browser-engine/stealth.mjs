// Stealth Module - 反自动化检测
// 在每个新页面/frame 加载前注入脚本，隐藏 CDP 和自动化指纹

export class StealthManager {
  constructor(cdp) {
    this.cdp = cdp;
    this.injectedTargets = new Set();
  }

  // tab 关闭时清理（由 TabManager.onTabClose 调用）
  onTargetClosed(targetId) { this.injectedTargets.delete(targetId); }

  // 浏览器重连后重置
  resetState() { this.injectedTargets.clear(); }

  // --- 对指定 tab 注入反检测脚本 ---
  async inject(targetId) {
    if (this.injectedTargets.has(targetId)) return { already: true };

    // Page.addScriptToEvaluateOnNewDocument 在每次导航时自动重新注入
    await this.cdp.sendToTarget(targetId, 'Page.addScriptToEvaluateOnNewDocument', {
      source: STEALTH_SCRIPT,
      worldName: '', // 主世界
      runImmediately: true,
    });

    // 也立即在当前页面执行一次（不等导航）
    await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: STEALTH_SCRIPT,
      returnByValue: true,
    }).catch(() => {});

    this.injectedTargets.add(targetId);
    return { injected: true };
  }

  // --- 对所有托管 tab 注入 ---
  async injectAll(tabManager) {
    let count = 0;
    for (const [targetId] of tabManager.managedTabs) {
      try { await this.inject(targetId); count++; } catch {}
    }
    return { injected: count };
  }

  // --- 检查当前页面的检测状态 ---
  async check(targetId) {
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: CHECK_SCRIPT,
      returnByValue: true,
      awaitPromise: false,
    });
    return resp.result?.result?.value || {};
  }
}

// --- 反检测脚本 ---
const STEALTH_SCRIPT = `
(() => {
  // 防止重复注入（用 Symbol 避免被反爬脚本检测）
  const _key = Symbol.for('__b_e_s');
  if (window[_key]) return;
  Object.defineProperty(window, _key, { value: true, enumerable: false, configurable: false });

  // 1. navigator.webdriver → false
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true,
    });
  } catch {}

  // 2. 移除 CDP 运行时标记
  try {
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_JSON;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Object;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Proxy;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  } catch {}

  // 3. chrome.runtime 伪装（部分网站检测是否存在 chrome 对象）
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function() {},
        sendMessage: function() {},
        id: undefined,
      };
    }
  } catch {}

  // 4. 隐藏 Permissions API 的 notification 异常
  try {
    const origQuery = window.Permissions?.prototype?.query;
    if (origQuery) {
      window.Permissions.prototype.query = function(desc) {
        if (desc.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return origQuery.call(this, desc);
      };
    }
  } catch {}

  // 5. plugins/mimeTypes 长度伪装（headless 浏览器通常为 0）
  try {
    if (navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const arr = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
          ];
          arr.item = (i) => arr[i];
          arr.namedItem = (name) => arr.find(p => p.name === name);
          arr.refresh = () => {};
          return arr;
        },
        configurable: true,
      });
    }
  } catch {}

  // 6. languages 伪装
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true,
    });
  } catch {}

  // 7. WebGL vendor/renderer 伪装（仅在值可疑时覆盖，否则保留真实值）
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    // 先读取真实值
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const realVendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : '';
    const realRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    // 只有当值看起来像 headless/虚拟环境时才覆盖
    const suspicious = !realVendor || /SwiftShader|llvmpipe|Mesa/i.test(realRenderer);
    if (suspicious) {
      WebGLRenderingContext.prototype.getParameter = function(param) {
        if (param === 0x9245) return 'Google Inc. (Intel)';
        if (param === 0x9246) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return getParameter.call(this, param);
      };
    }
  } catch {}

  // 8. 防止 Error.stack 泄露 CDP 注入的调用栈
  try {
    const origToString = Error.prototype.toString;
    Error.prototype.toString = function() {
      const str = origToString.call(this);
      return str.replace(/\\n\\s+at\\s+.*__puppeteer_evaluation_script__.*/g, '');
    };
  } catch {}

  // 9. iframe contentWindow 检测绕过（部分网站检查 iframe.contentWindow 访问权限来判断自动化）
  try {
    const origContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (origContentWindow) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function() {
          const win = origContentWindow.get.call(this);
          if (win) {
            try { win.navigator; } catch {
              // 跨域 iframe，正常行为
            }
          }
          return win;
        },
        configurable: true,
      });
    }
  } catch {}

  // 10. console.debug 陷阱清理（部分网站在 console.debug 中放检测代码）
  try {
    const noop = () => {};
    // 不覆盖 console.log 等，只处理可能的陷阱
    if (typeof console.debug.__isTrapped !== 'undefined') {
      console.debug = noop;
    }
  } catch {}

})();
`;

// --- 检测状态检查脚本 ---
const CHECK_SCRIPT = `(() => {
  const results = {};
  results.webdriver = navigator.webdriver;
  results.languages = navigator.languages;
  results.pluginCount = navigator.plugins?.length || 0;
  results.chrome = typeof window.chrome !== 'undefined';
  results.chromeRuntime = typeof window.chrome?.runtime !== 'undefined';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    results.webglVendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'n/a';
    results.webglRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).slice(0, 60) : 'n/a';
  } catch { results.webgl = 'error'; }
  results.stealthActive = !!window[Symbol.for('__b_e_s')];
  return results;
})()`;

export default StealthManager;
