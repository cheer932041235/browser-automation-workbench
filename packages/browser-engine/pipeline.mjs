// Pipeline Module
// 将多步浏览器操作编译为单个 JS 函数在页面内执行，零网络往返
// 参考 cdp-skill 的 Pipeline 设计

export class Pipeline {
  constructor(cdp) {
    this.cdp = cdp;
  }

  // 编译并执行一组步骤（在浏览器内一次性运行）
  async execute(targetId, steps, opts = {}) {
    if (!Array.isArray(steps) || !steps.length) return { error: '需要 steps 数组' };
    const timeout = opts.timeout || 30000;

    // 编译步骤为单个 async IIFE
    const compiled = this._compile(steps);
    const resp = await this.cdp.sendToTarget(targetId, 'Runtime.evaluate', {
      expression: compiled,
      returnByValue: true,
      awaitPromise: true,
      timeout,
    });

    if (resp.result?.exceptionDetails) {
      return {
        error: resp.result.exceptionDetails.text || resp.result.exceptionDetails.exception?.description,
        stepsTotal: steps.length,
      };
    }
    return resp.result?.result?.value || { error: 'No result' };
  }

  _compile(steps) {
    const lines = steps.map((step, i) => this._compileStep(step, i));
    return `(async () => {
  const _results = [];
  const _sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
${lines.join('\n')}
    return { ok: true, results: _results, stepsRun: _results.length };
  } catch (e) {
    return { ok: false, error: e.message, results: _results, stepsRun: _results.length };
  }
})()`;
  }

  _compileStep(step, idx) {
    const indent = '    ';
    switch (step.action) {
      case 'click':
        return `${indent}{
${indent}  const el = document.querySelector(${JSON.stringify(step.selector)});
${indent}  if (!el) throw new Error('Step ${idx}: 未找到 ' + ${JSON.stringify(step.selector)});
${indent}  el.scrollIntoView({block:'center',behavior:'instant'}); el.click();
${indent}  _results.push({step:${idx},action:'click',tag:el.tagName});
${indent}  ${step.wait ? `await _sleep(${step.wait});` : ''}
${indent}}`;

      case 'fill':
        return `${indent}{
${indent}  const el = document.querySelector(${JSON.stringify(step.selector)});
${indent}  if (!el) throw new Error('Step ${idx}: 未找到 ' + ${JSON.stringify(step.selector)});
${indent}  el.scrollIntoView({block:'center',behavior:'instant'}); el.focus();
${indent}  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set
${indent}    || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
${indent}  if (setter) setter.call(el, ${JSON.stringify(step.value || '')});
${indent}  else el.value = ${JSON.stringify(step.value || '')};
${indent}  el.dispatchEvent(new Event('input',{bubbles:true}));
${indent}  el.dispatchEvent(new Event('change',{bubbles:true}));
${indent}  _results.push({step:${idx},action:'fill',value:el.value.slice(0,100)});
${indent}  ${step.wait ? `await _sleep(${step.wait});` : ''}
${indent}}`;

      case 'type':
        return `${indent}{
${indent}  const el = ${step.selector ? `document.querySelector(${JSON.stringify(step.selector)})` : 'document.activeElement'};
${indent}  if (el) { el.focus(); }
${indent}  for (const ch of ${JSON.stringify(step.text || '')}) {
${indent}    el.dispatchEvent(new KeyboardEvent('keydown',{key:ch,bubbles:true}));
${indent}    el.dispatchEvent(new KeyboardEvent('keypress',{key:ch,bubbles:true}));
${indent}    document.execCommand('insertText',false,ch);
${indent}    el.dispatchEvent(new KeyboardEvent('keyup',{key:ch,bubbles:true}));
${indent}    await _sleep(${step.delay || 20});
${indent}  }
${indent}  _results.push({step:${idx},action:'type',len:${JSON.stringify(step.text || '').length - 2}});
${indent}}`;

      case 'wait':
        if (step.selector) {
          return `${indent}{
${indent}  const _t0 = Date.now();
${indent}  while (Date.now()-_t0 < ${step.timeout || 5000}) {
${indent}    if (document.querySelector(${JSON.stringify(step.selector)})) break;
${indent}    await _sleep(200);
${indent}  }
${indent}  const found = !!document.querySelector(${JSON.stringify(step.selector)});
${indent}  _results.push({step:${idx},action:'wait',found,ms:Date.now()-_t0});
${indent}  if (!found) throw new Error('Step ${idx}: 等待超时 ' + ${JSON.stringify(step.selector)});
${indent}}`;
        }
        return `${indent}{ await _sleep(${step.ms || 1000}); _results.push({step:${idx},action:'wait',ms:${step.ms || 1000}}); }`;

      case 'eval':
        return `${indent}{
${indent}  const _v = await (async () => { ${step.expression} })();
${indent}  _results.push({step:${idx},action:'eval',value:_v});
${indent}}`;

      case 'extract':
        return `${indent}{
${indent}  const el = document.querySelector(${JSON.stringify(step.selector || 'body')});
${indent}  const _v = el ? (el.${step.property || 'textContent'} || '').slice(0,${step.maxLength || 500}) : null;
${indent}  _results.push({step:${idx},action:'extract',value:_v});
${indent}}`;

      case 'select':
        return `${indent}{
${indent}  const el = document.querySelector(${JSON.stringify(step.selector)});
${indent}  if (!el) throw new Error('Step ${idx}: 未找到 select');
${indent}  el.value = ${JSON.stringify(step.value || '')}; el.dispatchEvent(new Event('change',{bubbles:true}));
${indent}  _results.push({step:${idx},action:'select',value:el.value});
${indent}}`;

      case 'check':
        return `${indent}{
${indent}  const el = document.querySelector(${JSON.stringify(step.selector)});
${indent}  if (!el) throw new Error('Step ${idx}: 未找到 checkbox');
${indent}  if (el.checked !== ${step.checked !== false}) el.click();
${indent}  _results.push({step:${idx},action:'check',checked:el.checked});
${indent}}`;

      case 'assert':
        return `${indent}{
${indent}  const el = document.querySelector(${JSON.stringify(step.selector || 'body')});
${indent}  const txt = el ? el.textContent : '';
${indent}  const ok = txt.includes(${JSON.stringify(step.text || '')});
${indent}  _results.push({step:${idx},action:'assert',ok,text:txt.slice(0,100)});
${indent}  if (!ok) throw new Error('Step ${idx}: 断言失败 - 未找到 ' + ${JSON.stringify(step.text || '')});
${indent}}`;

      default:
        return `${indent}_results.push({step:${idx},action:'unknown',type:${JSON.stringify(step.action)}});`;
    }
  }
}

export default Pipeline;
