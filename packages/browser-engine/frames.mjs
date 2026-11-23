// Frames Module - iframe 穿透与跨框架操作
// 自动发现 iframe 树、在指定 frame 中执行命令、跨 frame 元素查找

export function displayFrameUrl(value) {
  try {
    const url=new URL(value);
    if(url.hostname.endsWith('kaggleusercontent.com') && url.pathname.startsWith('/kf/')) {
      const parts=url.pathname.split('/');
      return `${url.origin}/kf/${parts[2]}/[session]/${parts.at(-1)}`;
    }
    return url.origin==='null'?url.protocol+url.pathname:url.origin+url.pathname;
  } catch {return value;}
}

export class FrameManager {
  constructor(cdp) {
    this.cdp = cdp;
    this.frameTree = new Map(); // targetId -> frameTree
    this._autoAttached = new Set();
  }

  resetState() {
    this.frameTree.clear();
    this._autoAttached.clear();
  }

  // --- 获取页面所有 frame（含嵌套） ---
  async getFrameTree(targetId) {
    const frames = new Map();
    const walk = (node, ownerTargetId, depth = 0) => {
      const f = {
        frameId: node.frame.id,
        url: node.frame.url,
        name: node.frame.name || '',
        securityOrigin: node.frame.securityOrigin || '',
        depth,
        parentId: node.frame.parentId || null,
        ownerTargetId,
      };
      const old = frames.get(f.frameId);
      if (old && !f.parentId) { f.parentId = old.parentId; f.depth = old.depth; }
      frames.set(f.frameId, f);
      if (node.childFrames) {
        for (const child of node.childFrames) walk(child, ownerTargetId, depth + 1);
      }
    };
    const queue = [targetId];
    const visited = new Set();
    for (let i = 0; i < queue.length; i++) {
      const owner = queue[i];
      if (visited.has(owner)) continue;
      visited.add(owner);
      if (!this._autoAttached.has(owner)) {
        await this.cdp.sendToTarget(owner, 'Target.setAutoAttach', {autoAttach:true, waitForDebuggerOnStart:false, flatten:true});
        this._autoAttached.add(owner);
      }
      const resp = await this.cdp.sendToTarget(owner, 'Page.getFrameTree', {});
      if (resp.result?.frameTree) walk(resp.result.frameTree, owner, owner === targetId ? 0 : 1);
      for (const [child, parent] of this.cdp.targetParents) {
        if (parent === owner && this.cdp.targetInfo.get(child)?.type === 'iframe') queue.push(child);
      }
    }
    for (const f of frames.values()) {
      if (f.ownerTargetId !== targetId && !f.parentId) {
        const parentTarget = this.cdp.targetParents.get(f.ownerTargetId);
        f.parentId = [...frames.values()].find(x=>x.ownerTargetId===parentTarget)?.frameId || null;
      }
      let current = f, depth = 0;
      while (current.parentId && frames.has(current.parentId) && depth < frames.size) { depth++; current=frames.get(current.parentId); }
      f.depth = depth;
    }
    const result = [...frames.values()];
    this.frameTree.set(targetId, result);
    return result;
  }

  // --- 列出所有 iframe（简洁视图） ---
  async listFrames(targetId) {
    const frames = await this.getFrameTree(targetId);
    return frames.map((f, i) => ({
      index: i,
      frameId: f.frameId,
      url: displayFrameUrl(f.url),
      name: f.name,
      depth: f.depth,
    }));
  }

  // --- 解析 frame 定位参数，返回 frameId ---
  async resolveFrameId(targetId, opts) {
    // opts: { frameId, frameIndex, urlPattern }
    const frames = await this.getFrameTree(targetId);
    if (opts.frameId) {
      if (!frames.some(f=>f.frameId===opts.frameId)) throw new Error('Frame does not belong to selected page: ' + opts.frameId);
      return opts.frameId;
    }
    if (opts.frameIndex !== undefined) {
      if (opts.frameIndex < 0 || opts.frameIndex >= frames.length) {
        return { error: `Frame index ${opts.frameIndex} out of range (0-${frames.length - 1})` };
      }
      return frames[opts.frameIndex].frameId;
    }
    if (opts.urlPattern) {
      const re = new RegExp(opts.urlPattern, 'i');
      const matches = frames.filter(f => re.test(f.url));
      if (matches.length!==1) return { error: `Expected exactly one matching frame; found ${matches.length}` };
      return matches[0].frameId;
    }
    return { error: 'Must specify frameId, frameIndex, or urlPattern' };
  }
  async uploadInFrame(targetId,frameId,selector,files) {
    let frame=this.frameTree.get(targetId)?.find(f=>f.frameId===frameId);
    if(!frame)frame=(await this.getFrameTree(targetId)).find(f=>f.frameId===frameId);
    if(!frame)throw new Error('Frame does not belong to selected page');
    const world=await this.cdp.sendToTarget(frame.ownerTargetId,'Page.createIsolatedWorld',{frameId,worldName:'BrowserEngineFrame'});
    const result=await this.cdp.sendToTarget(frame.ownerTargetId,'Runtime.evaluate',{expression:`document.querySelector(${JSON.stringify(selector)})`,contextId:world.result.executionContextId,returnByValue:false});
    const objectId=result.result?.result?.objectId;
    if(!objectId)throw new Error('File input not found in selected frame');
    try {await this.cdp.sendToTarget(frame.ownerTargetId,'DOM.setFileInputFiles',{objectId,files});return {uploaded:files.length,frameId};}
    finally {await this.cdp.sendToTarget(frame.ownerTargetId,'Runtime.releaseObject',{objectId});}
  }

  // --- 在指定 frame 中执行 JS（通过 createIsolatedWorld 真正穿透） ---
  async evalInFrame(targetId, frameId, expression, opts = {}) {
    let frame = this.frameTree.get(targetId)?.find(f=>f.frameId===frameId);
    if (!frame) frame = (await this.getFrameTree(targetId)).find(f=>f.frameId===frameId);
    if (!frame) throw new Error('Frame does not belong to selected page: ' + frameId);
    const worldResp = await this.cdp.sendToTarget(frame.ownerTargetId, 'Page.createIsolatedWorld', {
      frameId,
      worldName: 'BrowserEngineFrame',
    });
    const contextId = worldResp.result?.executionContextId;
    if (!contextId) {
      return { error: 'Failed to create execution context for frame: ' + frameId };
    }
    const resp = await this.cdp.sendToTarget(frame.ownerTargetId, 'Runtime.evaluate', {
      expression: `(() => { with(document) { return (${expression}); } })()`,
      contextId,
      returnByValue: true,
      awaitPromise: opts.awaitPromise !== false,
      timeout: opts.timeout || 30000,
    });
    if (resp.result?.exceptionDetails) {
      return { error: resp.result.exceptionDetails.text || resp.result.exceptionDetails.exception?.description };
    }
    return { value: resp.result?.result?.value };
  }

  // --- 便捷方法：通过索引执行 ---
  async evalInFrameByIndex(targetId, frameIndex, expression, opts = {}) {
    const fid = await this.resolveFrameId(targetId, { frameIndex });
    if (fid?.error) return fid;
    return this.evalInFrame(targetId, fid, expression, opts);
  }

  // --- 便捷方法：通过 URL 匹配执行 ---
  async evalInFrameByUrl(targetId, urlPattern, expression, opts = {}) {
    const fid = await this.resolveFrameId(targetId, { urlPattern });
    if (fid?.error) return fid;
    return this.evalInFrame(targetId, fid, expression, opts);
  }

  // --- 跨所有 frame 搜索文本（深度遍历） ---
  async findTextAcrossFrames(targetId, text) {
    const frames = await this.getFrameTree(targetId);
    const results = [];
    for (const frame of frames) {
      try {
        const r = await this.evalInFrame(targetId, frame.frameId,
          `document.body?.innerText?.includes(${JSON.stringify(text)}) ? {
            found: true,
            snippet: document.body.innerText.substring(
              Math.max(0, document.body.innerText.indexOf(${JSON.stringify(text)}) - 50),
              document.body.innerText.indexOf(${JSON.stringify(text)}) + ${text.length} + 50
            )
          } : { found: false }`
        );
        if (r.value?.found) {
          results.push({
            frameId: frame.frameId,
            frameUrl: frame.url.slice(0, 200),
            frameName: frame.name,
            depth: frame.depth,
            snippet: r.value.snippet,
          });
        }
      } catch { /* frame may not be accessible */ }
    }
    return results;
  }

  // --- 跨所有 frame 搜索元素 ---
  async findElementAcrossFrames(targetId, selector) {
    const frames = await this.getFrameTree(targetId);
    const results = [];
    for (const frame of frames) {
      try {
        const r = await this.evalInFrame(targetId, frame.frameId,
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            return {
              tag: el.tagName,
              text: (el.textContent || '').trim().slice(0, 100),
              id: el.id || '',
              classes: el.className || '',
            };
          })()`
        );
        if (r.value) {
          results.push({
            frameId: frame.frameId,
            frameUrl: frame.url.slice(0, 200),
            frameName: frame.name,
            depth: frame.depth,
            element: r.value,
          });
        }
      } catch { /* skip inaccessible frames */ }
    }
    return results;
  }

  // --- 在 frame 中点击元素 ---
  async clickInFrame(targetId, frameId, selector) {
    return this.evalInFrame(targetId, frameId,
      `(() => {
        const matches=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden');
        if(matches.length!==1)return {error:'Expected exactly one visible frame click target; found '+matches.length};
        const el=matches[0];
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.click();
        return { clicked: true, tag: el.tagName, text: (el.textContent || '').slice(0, 120) };
      })()`
    );
  }

  // --- 在 frame 中填充输入框 ---
  async fillInFrame(targetId, frameId, selector, value, opts = {}) {
    const sensitive = Boolean(opts.sensitive);
    return this.evalInFrame(targetId, frameId,
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { error: 'Not found: ' + ${JSON.stringify(selector)} };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(
          el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value'
        )?.set;
        if (nativeSetter) nativeSetter.call(el, ${JSON.stringify(value)});
        else el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        const redact = ${sensitive} || el.type === 'password' || el.autocomplete === 'one-time-code';
        return { filled: true, tag: el.tagName, value: redact ? '[REDACTED]' : el.value.slice(0, 100) };
      })()`
    );
  }

  // --- 获取 frame 中的交互元素 ---
  async getElementsInFrame(targetId, frameId, maxItems = 50) {
    return this.evalInFrame(targetId, frameId,
      `(() => {
        const results = [];
        const selectors = 'a,button,input,textarea,select,[role="button"],[role="link"],[role="menuitem"],[role="option"],[onclick]';
        const elements = document.querySelectorAll(selectors);
        for (let i = 0; i < elements.length && results.length < ${maxItems}; i++) {
          const el = elements[i];
          const rect = el.getBoundingClientRect();
          if ((rect.width === 0 || rect.height === 0) && !(el.tagName==='INPUT'&&el.type==='file')) continue;
          const style = getComputedStyle(el);
          if ((style.display === 'none' || style.visibility === 'hidden') && !(el.tagName==='INPUT'&&el.type==='file')) continue;
          let selector='';
          if(el.id)selector='#'+CSS.escape(el.id);
          for(const attr of ['data-testid','aria-label','title']){
            if(selector)break;
            const value=el.getAttribute(attr);
            if(value){const candidate=el.tagName.toLowerCase()+'['+attr+'='+JSON.stringify(value)+']';if(document.querySelectorAll(candidate).length===1)selector=candidate;}
          }
          if(!selector){let node=el;const parts=[];while(node&&node!==document.body){const siblings=[...node.parentElement.children].filter(n=>n.tagName===node.tagName);parts.unshift(node.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(node)+1)+')');node=node.parentElement;}selector='body>'+parts.join('>');}
          const secret=el.type==='password'||el.autocomplete==='one-time-code';
          results.push({
            idx: results.length,
            tag: el.tagName.toLowerCase(),
            type: el.type || el.getAttribute('role') || '',
            text: (secret?(el.getAttribute('aria-label')||el.placeholder||''):(el.textContent || el.value || el.placeholder || '')).trim().slice(0, 80),
            selector,
            label:el.getAttribute('aria-label')||'',
            title:el.getAttribute('title')||'',
            id: el.id || '',
            name: el.name || '',
            href: el.href || '',
          });
        }
        return results;
      })()`
    );
  }

  // --- 获取 frame 中的文本内容 ---
  async getTextInFrame(targetId, frameId, maxLen = 5000) {
    return this.evalInFrame(targetId, frameId,
      `(() => {
        const ignore = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG']);
        let text = '';
        function walk(node) {
          if (text.length > ${maxLen}) return;
          if (node.nodeType === 3) { const t = node.textContent.trim(); if (t) text += t + '\\n'; return; }
          if (node.nodeType !== 1 || ignore.has(node.tagName)) return;
          const tag = node.tagName;
          if (['H1','H2','H3','H4','H5','H6'].includes(tag)) { text += '\\n' + '#'.repeat(parseInt(tag[1])) + ' ' + node.textContent.trim() + '\\n'; return; }
          if (tag === 'LI') text += '- ';
          for (const child of node.childNodes) walk(child);
          if (['P','DIV','TR'].includes(tag)) text += '\\n';
        }
        walk(document.body);
        return text.replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, ${maxLen});
      })()`
    );
  }
}

export default FrameManager;
