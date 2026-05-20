// Interaction Module
// 点击、输入、键盘、鼠标、表单填写、文件上传

export class Interactor {
  constructor(cdp) {
    this.cdp = cdp;
  }

  // --- 执行 JS ---
  async eval(targetId, expression, opts = {}) {
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: opts.awaitPromise !== false,
      timeout: opts.timeout || 30000,
    });
    if (resp.result?.exceptionDetails) {
      return { error: resp.result.exceptionDetails.text || resp.result.exceptionDetails.exception?.description };
    }
    return { value: resp.result?.result?.value };
  }

  // --- JS 层点击 ---
  async click(targetId, selector) {
    const js = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: '未找到元素: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      return { clicked: true, tag: el.tagName, text: (el.textContent || '').slice(0, 120) };
    })()`;
    return this.eval(targetId, js);
  }

  // --- 通过文本内容点击 ---
  async clickByText(targetId, text, tagFilter = '') {
    const js = `(() => {
      const filter = ${JSON.stringify(tagFilter)}.toUpperCase();
      const all = document.querySelectorAll(filter || '*');
      for (const el of all) {
        if (el.children.length > 3) continue;
        const t = (el.textContent || '').trim();
        if (t === ${JSON.stringify(text)} || t.includes(${JSON.stringify(text)})) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          el.click();
          return { clicked: true, tag: el.tagName, text: t.slice(0, 120) };
        }
      }
      return { error: '未找到包含文本的元素: ' + ${JSON.stringify(text)} };
    })()`;
    return this.eval(targetId, js);
  }

  // --- CDP 真实鼠标点击（触发用户手势） ---
  async clickAt(targetId, selector) {
    const coordJs = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: '未找到元素: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName };
    })()`;
    const coordResp = await this.eval(targetId, coordJs);
    if (coordResp.value?.error) return coordResp.value;
    const { x, y, tag } = coordResp.value;
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return { clicked: true, x, y, tag };
  }

  // --- 坐标点击 ---
  async clickXY(targetId, x, y, opts = {}) {
    const button = opts.button || 'left';
    const clickCount = opts.double ? 2 : 1;
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount });
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount });
    return { clicked: true, x, y };
  }

  // --- 双击（CDP 真实鼠标） ---
  async doubleClick(targetId, selector) {
    const coordJs = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: '未找到元素: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName };
    })()`;
    const coordResp = await this.eval(targetId, coordJs);
    if (coordResp.value?.error) return coordResp.value;
    const { x, y, tag } = coordResp.value;
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 });
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 });
    return { doubleClicked: true, x, y, tag };
  }

  // --- 右键点击（触发上下文菜单） ---
  async rightClick(targetId, selector) {
    const coordJs = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: '未找到元素: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName };
    })()`;
    const coordResp = await this.eval(targetId, coordJs);
    if (coordResp.value?.error) return coordResp.value;
    const { x, y, tag } = coordResp.value;
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
    return { rightClicked: true, x, y, tag };
  }

  // --- 键盘输入文本（逐字符，触发所有键盘事件） ---
  async type(targetId, text, opts = {}) {
    // 可选：先聚焦指定元素
    if (opts.selector) {
      const focusJs = `(() => {
        const el = document.querySelector(${JSON.stringify(opts.selector)});
        if (!el) return { error: '未找到元素: ' + ${JSON.stringify(opts.selector)} };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.focus();
        return { focused: true };
      })()`;
      const fr = await this.eval(targetId, focusJs);
      if (fr.value?.error) return fr.value;
    }
    const delay = opts.delay || 30;
    for (const char of text) {
      await this.cdp.sendToTarget(targetId, 'Input.dispatchKeyEvent', {
        type: 'keyDown', text: char, unmodifiedText: char, key: char,
      });
      await this.cdp.sendToTarget(targetId, 'Input.dispatchKeyEvent', {
        type: 'keyUp', text: char, unmodifiedText: char, key: char,
      });
      if (delay > 0) await sleep(delay);
    }
    return { typed: text.length };
  }

  // --- 快速文本插入（Input.insertText，一次性插入，跨域 iframe 兼容） ---
  async insertText(targetId, text, opts = {}) {
    if (opts.selector) {
      const focusJs = `(() => {
        const el = document.querySelector(${JSON.stringify(opts.selector)});
        if (!el) return { error: '未找到元素: ' + ${JSON.stringify(opts.selector)} };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.focus();
        return { focused: true };
      })()`;
      const fr = await this.eval(targetId, focusJs);
      if (fr.value?.error) return fr.value;
    }
    await this.cdp.sendToTarget(targetId, 'Input.insertText', { text });
    return { inserted: text.length };
  }

  // --- 快速填充（直接设值，不逐字符） ---
  async fill(targetId, selector, value) {
    const js = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: '未找到元素: ' + ${JSON.stringify(selector)} };
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
      return { filled: true, tag: el.tagName, value: el.value.slice(0, 100) };
    })()`;
    return this.eval(targetId, js);
  }

  // --- 批量填写表单 ---
  async fillForm(targetId, fields) {
    // fields: [{ selector, value }]
    const results = [];
    for (const { selector, value } of fields) {
      const r = await this.fill(targetId, selector, value);
      results.push({ selector, ...r.value || r });
    }
    return results;
  }

  // --- 按键（Enter, Tab, Escape, ArrowDown 等） ---
  async pressKey(targetId, key, modifiers = {}) {
    const keyDef = KEY_DEFINITIONS[key] || { key, code: key, keyCode: 0 };
    let mod = 0;
    if (modifiers.alt) mod |= 1;
    if (modifiers.ctrl) mod |= 2;
    if (modifiers.meta) mod |= 4;
    if (modifiers.shift) mod |= 8;
    await this.cdp.sendToTarget(targetId, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: keyDef.key, code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode, nativeVirtualKeyCode: keyDef.keyCode,
      modifiers: mod,
    });
    await this.cdp.sendToTarget(targetId, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: keyDef.key, code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode, nativeVirtualKeyCode: keyDef.keyCode,
      modifiers: mod,
    });
    return { pressed: key };
  }

  // --- 键盘快捷键组合 ---
  async hotkey(targetId, ...keys) {
    // 按下所有键
    for (const key of keys) {
      const keyDef = KEY_DEFINITIONS[key] || { key, code: key, keyCode: 0 };
      await this.cdp.sendToTarget(targetId, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: keyDef.key, code: keyDef.code,
        windowsVirtualKeyCode: keyDef.keyCode, nativeVirtualKeyCode: keyDef.keyCode,
      });
    }
    // 释放所有键（逆序，不修改原数组）
    for (const key of [...keys].reverse()) {
      const keyDef = KEY_DEFINITIONS[key] || { key, code: key, keyCode: 0 };
      await this.cdp.sendToTarget(targetId, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: keyDef.key, code: keyDef.code,
        windowsVirtualKeyCode: keyDef.keyCode, nativeVirtualKeyCode: keyDef.keyCode,
      });
    }
    return { hotkey: keys.join('+') };
  }

  // --- 鼠标悬停 ---
  async hover(targetId, selector) {
    const coordJs = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: '未找到' };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`;
    const r = await this.eval(targetId, coordJs);
    if (r.value?.error) return r.value;
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.value.x, y: r.value.y });
    return { hovered: true, ...r.value };
  }

  // --- 滚动 ---
  async scroll(targetId, opts = {}) {
    let js;
    if (opts.direction === 'top') js = 'window.scrollTo(0,0);"top"';
    else if (opts.direction === 'bottom') js = 'window.scrollTo(0,document.body.scrollHeight);"bottom"';
    else if (opts.selector) {
      js = `(() => {
        const el = document.querySelector(${JSON.stringify(opts.selector)});
        if (!el) return 'not found';
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return 'scrolled to element';
      })()`;
    } else {
      const y = opts.y || 600;
      js = `window.scrollBy(0,${y});"scrolled ${y}px"`;
    }
    const resp = await this.eval(targetId, js);
    await sleep(800); // 等待懒加载
    return resp;
  }

  // --- 选择下拉框选项 ---
  async select(targetId, selector, value) {
    const js = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || el.tagName !== 'SELECT') return { error: '未找到 select 元素' };
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { selected: el.value };
    })()`;
    return this.eval(targetId, js);
  }

  // --- 勾选/取消复选框 ---
  async checkbox(targetId, selector, checked = true) {
    const js = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: '未找到元素' };
      if (el.checked !== ${checked}) el.click();
      return { checked: el.checked };
    })()`;
    return this.eval(targetId, js);
  }

  // --- 文件上传 ---
  async setFiles(targetId, selector, files) {
    await this.cdp.sendToTarget(targetId, 'DOM.enable', {});
    const doc = await this.cdp.sendToTarget(targetId, 'DOM.getDocument', {});
    const node = await this.cdp.sendToTarget(targetId, 'DOM.querySelector', {
      nodeId: doc.result.root.nodeId, selector
    });
    if (!node.result?.nodeId) return { error: '未找到文件输入元素' };
    await this.cdp.sendToTarget(targetId, 'DOM.setFileInputFiles', { nodeId: node.result.nodeId, files });
    return { uploaded: files.length };
  }

  // --- Smart Actionability 检查 ---
  async checkActionability(targetId, selector, opts = {}) {
    const timeout = opts.timeout || 5000;
    const js = `(async () => {
      const sel = ${JSON.stringify(selector)};
      const el = document.querySelector(sel);
      if (!el) return { actionable: false, reason: 'not_found', selector: sel };

      const checks = {};

      // 1. Visible: 在 DOM 中且有尺寸
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      checks.visible = rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden'
        && parseFloat(style.opacity) > 0;

      // 2. In viewport (or scrollable to)
      checks.inViewport = rect.top < window.innerHeight && rect.bottom > 0
        && rect.left < window.innerWidth && rect.right > 0;

      // 3. Enabled: 非 disabled
      checks.enabled = !el.disabled && el.getAttribute('aria-disabled') !== 'true';

      // 4. Pointer events: CSS pointer-events 未禁用
      checks.pointerEvents = style.pointerEvents !== 'none';

      // 5. Unobscured: 元素中心点未被其他元素遮挡
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      checks.unobscured = topEl === el || el.contains(topEl) || (topEl && topEl.contains && topEl.contains(el));

      // 6. Stable: 位置在短时间内未变化
      const pos1 = { x: rect.x, y: rect.y };
      await new Promise(r => setTimeout(r, 100));
      const rect2 = el.getBoundingClientRect();
      const pos2 = { x: rect2.x, y: rect2.y };
      checks.stable = Math.abs(pos1.x - pos2.x) < 2 && Math.abs(pos1.y - pos2.y) < 2;

      const actionable = Object.values(checks).every(v => v === true);
      const failedChecks = Object.entries(checks).filter(([,v]) => !v).map(([k]) => k);

      return {
        actionable,
        checks,
        failedChecks,
        selector: sel,
        tag: el.tagName,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      };
    })()`;
    return this.eval(targetId, js, { timeout });
  }

  // --- 带 actionability 检查的安全点击 ---
  async safeClick(targetId, selector, opts = {}) {
    const maxRetries = opts.retries || 3;
    const retryDelay = opts.retryDelay || 500;

    for (let i = 0; i < maxRetries; i++) {
      const check = await this.checkActionability(targetId, selector, opts);
      if (check.value?.actionable) {
        // 如果不在视口内，先滚动
        if (!check.value.checks.inViewport) {
          await this.eval(targetId, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);
          await sleep(200);
        }
        return this.click(targetId, selector);
      }
      if (i < maxRetries - 1) await sleep(retryDelay);
    }

    // 最后一次尝试，强制点击（fallback）
    if (opts.force) return this.click(targetId, selector);

    const finalCheck = await this.checkActionability(targetId, selector, opts);
    return { error: 'Element not actionable', ...finalCheck.value };
  }

  // --- 拖拽 ---
  async drag(targetId, fromSelector, toSelector) {
    const coordJs = `(() => {
      const from = document.querySelector(${JSON.stringify(fromSelector)});
      const to = document.querySelector(${JSON.stringify(toSelector)});
      if (!from || !to) return { error: '元素未找到' };
      const r1 = from.getBoundingClientRect();
      const r2 = to.getBoundingClientRect();
      return { x1: r1.x+r1.width/2, y1: r1.y+r1.height/2, x2: r2.x+r2.width/2, y2: r2.y+r2.height/2 };
    })()`;
    const r = await this.eval(targetId, coordJs);
    if (r.value?.error) return r.value;
    const { x1, y1, x2, y2 } = r.value;
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left' });
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2, y: y2, button: 'left' });
    await this.cdp.sendToTarget(targetId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left' });
    return { dragged: true };
  }
}

// --- 键盘定义 ---
const KEY_DEFINITIONS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  Shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  Alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  Meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  F1: { key: 'F1', code: 'F1', keyCode: 112 },
  F5: { key: 'F5', code: 'F5', keyCode: 116 },
  F12: { key: 'F12', code: 'F12', keyCode: 123 },
  a: { key: 'a', code: 'KeyA', keyCode: 65 },
  c: { key: 'c', code: 'KeyC', keyCode: 67 },
  v: { key: 'v', code: 'KeyV', keyCode: 86 },
  x: { key: 'x', code: 'KeyX', keyCode: 88 },
  z: { key: 'z', code: 'KeyZ', keyCode: 90 },
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default Interactor;
