// Batch Module - 并行 Tab 批量操作
// 同时打开多个 URL、并行提取数据、批量执行操作

export class BatchProcessor {
  constructor(cdp, tabs, interact, page, stealth, waiter) {
    this.cdp = cdp;
    this.tabs = tabs;
    this.interact = interact;
    this.page = page;
    this.stealth = stealth;
    this.waiter = waiter;
  }

  // --- 批量打开 URL（并发控制） ---
  async openAll(urls, opts = {}) {
    const concurrency = opts.concurrency || 3;
    const group = opts.group || 'batch';
    const injectStealth = opts.stealth !== false;
    const delayBetween = opts.delay || 1000; // 防风控间隔 ms

    const results = [];
    const queue = [...urls.map((url, i) => ({ url, index: i }))];
    const running = new Set();

    const runOne = async (item) => {
      running.add(item.index);
      try {
        const targetId = await this.tabs.create(item.url, group);
        if (injectStealth && this.stealth) {
          try { await this.stealth.inject(targetId); } catch {}
        }
        // 等待加载（优先用 SmartWaiter，回退到固定等待）
        if (this.waiter) {
          try { await this.waiter.waitForStable(targetId, 10000); } catch {}
        } else {
          await new Promise(r => setTimeout(r, 2000));
        }
        results[item.index] = { targetId, url: item.url, ok: true };
      } catch (e) {
        results[item.index] = { url: item.url, ok: false, error: e.message };
      }
      running.delete(item.index);
    };

    // 分批执行
    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      await Promise.all(batch.map(item => runOne(item)));
      if (queue.length > 0 && delayBetween > 0) {
        await new Promise(r => setTimeout(r, delayBetween));
      }
    }

    return results;
  }

  // --- 对多个 tab 并行执行同一 JS ---
  async evalAll(targetIds, expression, opts = {}) {
    const results = await Promise.all(
      targetIds.map(async (id) => {
        try {
          const r = await this.interact.eval(id, expression, opts);
          return { targetId: id, ...r };
        } catch (e) {
          return { targetId: id, error: e.message };
        }
      })
    );
    return results;
  }

  // --- 对多个 tab 并行提取文本 ---
  async extractTextAll(targetIds, opts = {}) {
    const maxLen = opts.maxLength || 3000;
    const results = await Promise.all(
      targetIds.map(async (id) => {
        try {
          const text = await this.page.getTextContent(id, { maxLength: maxLen });
          const info = await this.tabs.getInfo(id);
          return { targetId: id, url: info.url, title: info.title, text };
        } catch (e) {
          return { targetId: id, error: e.message };
        }
      })
    );
    return results;
  }

  // --- 对多个 tab 并行截图 ---
  async screenshotAll(targetIds, dirPath, opts = {}) {
    const results = await Promise.all(
      targetIds.map(async (id, i) => {
        try {
          const file = `${dirPath}/shot_${i}_${id.slice(0, 8)}.png`;
          const r = await this.page.screenshot(id, file, opts);
          return { targetId: id, file, ok: true };
        } catch (e) {
          return { targetId: id, ok: false, error: e.message };
        }
      })
    );
    return results;
  }

  // --- 对多个 tab 并行提取链接 ---
  async extractLinksAll(targetIds, opts = {}) {
    const results = await Promise.all(
      targetIds.map(async (id) => {
        try {
          const links = await this.page.getLinks(id, opts);
          return { targetId: id, links };
        } catch (e) {
          return { targetId: id, error: e.message };
        }
      })
    );
    return results;
  }

  // --- 批量关闭 ---
  async closeAll(targetIds) {
    let closed = 0;
    for (const id of targetIds) {
      try { await this.tabs.close(id); closed++; } catch {}
    }
    return { closed, total: targetIds.length };
  }

  // --- 批量采集流程：打开 → 提取 → 关闭 ---
  async scrape(urls, extractExpr, opts = {}) {
    const opened = await this.openAll(urls, opts);
    const successIds = opened.filter(r => r.ok).map(r => r.targetId);

    let data;
    if (extractExpr) {
      data = await this.evalAll(successIds, extractExpr);
    } else {
      data = await this.extractTextAll(successIds, opts);
    }

    // 合并结果
    const results = opened.map((o, i) => {
      if (!o.ok) return { url: o.url, error: o.error };
      const d = data.find(d => d.targetId === o.targetId);
      return { url: o.url, targetId: o.targetId, ...(d || {}) };
    });

    // 可选关闭
    if (opts.autoClose !== false) {
      await this.closeAll(successIds);
    }

    return results;
  }
}

export default BatchProcessor;
