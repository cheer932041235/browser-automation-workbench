// Page Analysis Module
// 页面结构化分析、元素发现、可访问性树、内容提取

export class PageAnalyzer {
  constructor(cdp, waiter) {
    this.cdp = cdp;
    this.waiter = waiter;      // SmartWaiter 实例（委托等待方法）
    this.consoleLogs = [];     // 捕获的 console 日志
    this._consoleTargets = new Set();
    // 按 targetId 追踪 console 事件
    this._consoleEvents = new Map(); // targetId -> [{method, entry}]
    this.maxConsoleLogs = 500;
  }

  // --- 获取页面交互元素摘要（类似 Playwright snapshot 但更轻量） ---
  async getInteractiveElements(targetId, opts = {}) {
    const maxItems = opts.maxItems || 80;
    const js = `(() => {
      const results = [];
      const selectors = 'a,button,input,textarea,select,[role="button"],[role="link"],[role="tab"],[onclick],[tabindex]';
      const elements = document.querySelectorAll(selectors);
      for (let i = 0; i < elements.length && results.length < ${maxItems}; i++) {
        const el = elements[i];
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.top > window.innerHeight * 3) continue; // 超出3屏的忽略
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const item = {
          idx: results.length,
          tag: el.tagName.toLowerCase(),
          type: el.type || el.getAttribute('role') || '',
          text: (el.textContent || el.value || el.placeholder || el.title || el.alt || '').trim().slice(0, 80),
          selector: genSelector(el),
          visible: rect.top >= 0 && rect.top < window.innerHeight,
        };
        if (el.href) item.href = el.href;
        if (el.name) item.name = el.name;
        if (el.id) item.id = el.id;
        if (el.disabled) item.disabled = true;
        if (el.checked) item.checked = true;
        results.push(item);
      }
      return results;

      function genSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        let sel = el.tagName.toLowerCase();
        if (el.name) sel += '[name="' + el.name + '"]';
        else if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\\s+/).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
          sel += cls;
        }
        // 确保唯一性
        if (document.querySelectorAll(sel).length > 1) {
          const parent = el.parentElement;
          if (parent) {
            const siblings = [...parent.children].filter(c => c.matches(sel));
            const idx = siblings.indexOf(el);
            if (idx >= 0) sel += ':nth-child(' + (idx + 1) + ')';
          }
        }
        return sel;
      }
    })()`;
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
    });
    return resp.result?.result?.value || [];
  }

  // --- 获取页面文本内容（带结构） ---
  async getTextContent(targetId, opts = {}) {
    const maxLen = opts.maxLength || 5000;
    const js = `(() => {
      const ignore = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','PATH']);
      let text = '';
      function walk(node, depth) {
        if (text.length > ${maxLen}) return;
        if (node.nodeType === 3) {
          const t = node.textContent.trim();
          if (t) text += t + '\\n';
          return;
        }
        if (node.nodeType !== 1) return;
        if (ignore.has(node.tagName)) return;
        const tag = node.tagName;
        if (['H1','H2','H3','H4','H5','H6'].includes(tag)) {
          text += '\\n' + '#'.repeat(parseInt(tag[1])) + ' ' + node.textContent.trim() + '\\n';
          return;
        }
        if (tag === 'LI') text += '- ';
        if (tag === 'BR') { text += '\\n'; return; }
        if (tag === 'P' || tag === 'DIV') text += '\\n';
        for (const child of node.childNodes) walk(child, depth + 1);
        if (tag === 'P' || tag === 'DIV' || tag === 'TR') text += '\\n';
      }
      walk(document.body, 0);
      return text.replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, ${maxLen});
    })()`;
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
    });
    return resp.result?.result?.value || '';
  }

  // --- 获取表单字段信息 ---
  async getFormFields(targetId, formSelector = 'form') {
    const js = `(() => {
      const form = document.querySelector(${JSON.stringify(formSelector)}) || document.body;
      const inputs = form.querySelectorAll('input,textarea,select');
      return [...inputs].map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        id: el.id || '',
        value: el.value || '',
        placeholder: el.placeholder || '',
        label: el.labels?.[0]?.textContent?.trim() || '',
        required: el.required,
        disabled: el.disabled,
        options: el.tagName === 'SELECT' ? [...el.options].map(o => ({value: o.value, text: o.textContent.trim()})) : undefined,
        selector: el.id ? '#'+el.id : el.name ? el.tagName.toLowerCase()+'[name="'+el.name+'"]' : null,
      }));
    })()`;
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
    });
    return resp.result?.result?.value || [];
  }

  // --- 获取链接列表 ---
  async getLinks(targetId, opts = {}) {
    const maxItems = opts.maxItems || 100;
    const filter = opts.filter || '';
    const js = `(() => {
      const links = document.querySelectorAll('a[href]');
      const results = [];
      const filter = ${JSON.stringify(filter)}.toLowerCase();
      for (const a of links) {
        if (results.length >= ${maxItems}) break;
        const text = a.textContent.trim().slice(0, 100);
        const href = a.href;
        if (!href || href.startsWith('javascript:')) continue;
        if (filter && !text.toLowerCase().includes(filter) && !href.toLowerCase().includes(filter)) continue;
        results.push({ text, href, target: a.target || '_self' });
      }
      return results;
    })()`;
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
    });
    return resp.result?.result?.value || [];
  }

  // --- 获取表格数据 ---
  async getTableData(targetId, tableSelector = 'table') {
    const js = `(() => {
      const table = document.querySelector(${JSON.stringify(tableSelector)});
      if (!table) return { error: '未找到表格' };
      const rows = [];
      for (const tr of table.querySelectorAll('tr')) {
        const cells = [...tr.querySelectorAll('th,td')].map(c => c.textContent.trim());
        if (cells.some(c => c)) rows.push(cells);
      }
      return { rows: rows.length, data: rows.slice(0, 50) };
    })()`;
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
    });
    return resp.result?.result?.value || {};
  }

  // --- 等待元素出现（委托给 SmartWaiter，MutationObserver 驱动） ---
  async waitForElement(targetId, selector, timeoutMs = 10000) {
    if (this.waiter) return this.waiter.waitForElement(targetId, selector, timeoutMs);
    // fallback: 无 waiter 时简单轮询
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
        expression: `!!document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: true,
      });
      if (resp.result?.result?.value === true) return { found: true, elapsed: Date.now() - start };
      await sleep(300);
    }
    return { found: false, elapsed: Date.now() - start };
  }

  // --- 等待文本出现（委托给 SmartWaiter） ---
  async waitForText(targetId, text, timeoutMs = 10000) {
    if (this.waiter) return this.waiter.waitForText(targetId, text, timeoutMs);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
        expression: `document.body.innerText.includes(${JSON.stringify(text)})`,
        returnByValue: true,
      });
      if (resp.result?.result?.value === true) return { found: true, elapsed: Date.now() - start };
      await sleep(300);
    }
    return { found: false, elapsed: Date.now() - start };
  }

  // --- 等待网络空闲（委托给 SmartWaiter） ---
  async waitForNetworkIdle(targetId, timeoutMs = 15000, idleTime = 2000) {
    if (this.waiter) return this.waiter.waitForNetworkIdle(targetId, timeoutMs, { idleTime });
    // fallback: 简单等待
    await sleep(idleTime);
    return { idle: true, elapsed: idleTime, method: 'fallback-sleep' };
  }

  // --- Console 日志捕获 ---
  async enableConsoleCapture(targetId) {
    if (this._consoleTargets.has(targetId)) return { enabled: true, alreadyActive: true };
    this._consoleTargets.add(targetId);

    await this.cdp.sendToTarget(targetId, 'Runtime.enable', {});

    const entry = this.cdp.on('Runtime.consoleAPICalled', (params) => {
      this.consoleLogs.push({
        type: params.type,
        text: (params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 500),
        time: Date.now(),
        url: params.stackTrace?.callFrames?.[0]?.url || '',
      });
      if (this.consoleLogs.length > this.maxConsoleLogs) this.consoleLogs.shift();
    });

    const exEntry = this.cdp.on('Runtime.exceptionThrown', (params) => {
      this.consoleLogs.push({
        type: 'error',
        text: params.exceptionDetails?.text || params.exceptionDetails?.exception?.description || 'Unknown error',
        time: Date.now(),
        url: params.exceptionDetails?.url || '',
        exception: true,
      });
      if (this.consoleLogs.length > this.maxConsoleLogs) this.consoleLogs.shift();
    });

    if (!this._consoleEvents.has(targetId)) this._consoleEvents.set(targetId, []);
    this._consoleEvents.get(targetId).push(
      { method: 'Runtime.consoleAPICalled', entry },
      { method: 'Runtime.exceptionThrown', entry: exEntry },
    );
    return { enabled: true };
  }

  getConsoleLogs(opts = {}) {
    let logs = [...this.consoleLogs];
    if (opts.level) logs = logs.filter(l => l.type === opts.level);
    if (opts.filter) {
      const re = new RegExp(opts.filter, 'i');
      logs = logs.filter(l => re.test(l.text));
    }
    return logs.slice(-(opts.limit || 100));
  }

  clearConsoleLogs() {
    this.consoleLogs = [];
    return { cleared: true };
  }

  stopConsoleCapture(targetId) {
    this._consoleTargets.delete(targetId);
    const events = this._consoleEvents.get(targetId);
    if (events) {
      for (const { method, entry } of events) this.cdp.off(method, entry);
      this._consoleEvents.delete(targetId);
    }
  }

  // tab 关闭时清理（由 TabManager.onTabClose 调用）
  onTargetClosed(targetId) {
    this.stopConsoleCapture(targetId);
  }

  // 浏览器重连后重置所有状态
  resetState() {
    for (const [targetId] of this._consoleEvents) this.stopConsoleCapture(targetId);
    this._consoleTargets.clear();
    this._consoleEvents.clear();
    this.consoleLogs = [];
  }

  // --- Shadow DOM 穿透查询 ---
  async queryShadowDOM(targetId, selector, opts = {}) {
    const maxItems = opts.maxItems || 50;
    const js = `(() => {
      const results = [];
      function searchShadow(root, depth) {
        if (depth > 10 || results.length >= ${maxItems}) return;
        const els = root.querySelectorAll(${JSON.stringify(selector)});
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          results.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, 100),
            id: el.id || '',
            visible: rect.width > 0 && rect.height > 0,
            inShadow: root !== document,
            depth,
          });
        }
        // 递归穿透所有 shadowRoot
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) searchShadow(el.shadowRoot, depth + 1);
        }
      }
      searchShadow(document, 0);
      return results;
    })()`;
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
    });
    return resp.result?.result?.value || [];
  }

  // --- Shadow DOM 穿透点击 ---
  async clickInShadowDOM(targetId, selector) {
    const js = `(() => {
      function findInShadow(root) {
        const el = root.querySelector(${JSON.stringify(selector)});
        if (el) return el;
        for (const child of root.querySelectorAll('*')) {
          if (child.shadowRoot) {
            const found = findInShadow(child.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      }
      const el = findInShadow(document);
      if (!el) return { error: '未在 Shadow DOM 中找到: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      return { clicked: true, tag: el.tagName, text: (el.textContent || '').slice(0, 120), inShadow: true };
    })()`;
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
    });
    return resp.result?.result?.value || { error: 'eval failed' };
  }

  // --- Shadow DOM 穿透填值 ---
  async fillInShadowDOM(targetId, selector, value) {
    const js = `(() => {
      function findInShadow(root) {
        const el = root.querySelector(${JSON.stringify(selector)});
        if (el) return el;
        for (const child of root.querySelectorAll('*')) {
          if (child.shadowRoot) {
            const found = findInShadow(child.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      }
      const el = findInShadow(document);
      if (!el) return { error: '未在 Shadow DOM 中找到: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (nativeSetter) nativeSetter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { filled: true, tag: el.tagName, value: el.value.slice(0, 100), inShadow: true };
    })()`;
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: js, returnByValue: true, awaitPromise: true,
    });
    return resp.result?.result?.value || { error: 'eval failed' };
  }

  // --- 截图 ---
  async screenshot(targetId, filePath = null, opts = {}) {
    const params = { format: opts.format || 'png' };
    if (params.format === 'jpeg') params.quality = opts.quality || 80;
    if (opts.fullPage) {
      // 获取页面尺寸并设置 clip
      const metrics = await this.cdp.sendToTarget(targetId, 'Page.getLayoutMetrics', {});
      params.clip = {
        x: 0, y: 0,
        width: metrics.result.cssContentSize?.width || metrics.result.contentSize?.width || 1920,
        height: metrics.result.cssContentSize?.height || metrics.result.contentSize?.height || 1080,
        scale: 1,
      };
    }
    if (opts.selector) {
      const coordResp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(opts.selector)}); if(!el) return null; const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`,
        returnByValue: true,
      });
      if (coordResp.result?.result?.value) {
        params.clip = { ...coordResp.result.result.value, scale: 1 };
      }
    }
    const resp = await this.cdp.sendToTarget(targetId, 'Page.captureScreenshot', params);
    if (filePath) {
      const fs = await import('node:fs');
      fs.default.writeFileSync(filePath, Buffer.from(resp.result.data, 'base64'));
      return { saved: filePath };
    }
    return { base64: resp.result.data, size: resp.result.data.length };
  }

  // --- PDF 生成 ---
  async generatePDF(targetId, filePath, opts = {}) {
    const resp = await this.cdp.sendToTarget(targetId, 'Page.printToPDF', {
      landscape: opts.landscape || false,
      printBackground: opts.printBackground !== false,
      paperWidth: opts.paperWidth || 8.27,
      paperHeight: opts.paperHeight || 11.69,
      marginTop: opts.marginTop || 0.4,
      marginBottom: opts.marginBottom || 0.4,
      marginLeft: opts.marginLeft || 0.4,
      marginRight: opts.marginRight || 0.4,
    });
    const fs = await import('node:fs');
    fs.default.writeFileSync(filePath, Buffer.from(resp.result.data, 'base64'));
    return { saved: filePath };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default PageAnalyzer;
