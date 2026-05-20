// Site Profiles Module
// 按域名存储站点特定知识（选择器、反爬策略、URL 模式、登录方式等）
// 参考 cdp-skill 的 Site Profiles 和 browser-harness 的 Domain Skills

import fs from 'node:fs';
import path from 'node:path';

export class SiteProfiles {
  constructor(opts = {}) {
    this._profileDir = opts.dir || path.join(process.cwd(), '.site-profiles');
    this._cache = new Map(); // domain -> profile
    if (!fs.existsSync(this._profileDir)) fs.mkdirSync(this._profileDir, { recursive: true });
  }

  // 从 URL 提取域名
  _getDomain(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }

  _filePath(domain) {
    return path.join(this._profileDir, domain.replace(/[^a-zA-Z0-9.-]/g, '_') + '.json');
  }

  // 获取站点 profile
  get(domain) {
    domain = this._getDomain(domain);
    if (this._cache.has(domain)) return this._cache.get(domain);
    const fp = this._filePath(domain);
    if (fs.existsSync(fp)) {
      try {
        const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        this._cache.set(domain, data);
        return data;
      } catch { return null; }
    }
    return null;
  }

  // 设置/更新站点 profile
  set(domain, profile) {
    domain = this._getDomain(domain);
    const existing = this.get(domain) || {};
    const merged = { ...existing, ...profile, domain, updatedAt: Date.now() };
    if (!merged.createdAt) merged.createdAt = Date.now();
    this._cache.set(domain, merged);
    fs.writeFileSync(this._filePath(domain), JSON.stringify(merged, null, 2), 'utf-8');
    return { saved: true, domain };
  }

  // 删除站点 profile
  delete(domain) {
    domain = this._getDomain(domain);
    this._cache.delete(domain);
    const fp = this._filePath(domain);
    try { fs.unlinkSync(fp); return { deleted: true, domain }; }
    catch { return { deleted: false, domain }; }
  }

  // 列出所有 profiles
  list() {
    try {
      const files = fs.readdirSync(this._profileDir).filter(f => f.endsWith('.json'));
      return files.map(f => {
        const domain = f.replace('.json', '');
        const profile = this.get(domain);
        return { domain, selectors: Object.keys(profile?.selectors || {}), updatedAt: profile?.updatedAt };
      });
    } catch { return []; }
  }

  // 添加选择器知识
  addSelector(domain, name, selector, description = '') {
    domain = this._getDomain(domain);
    const profile = this.get(domain) || {};
    if (!profile.selectors) profile.selectors = {};
    profile.selectors[name] = { selector, description, addedAt: Date.now() };
    return this.set(domain, profile);
  }

  // 添加反爬策略
  addAntiCrawl(domain, strategy) {
    domain = this._getDomain(domain);
    const profile = this.get(domain) || {};
    if (!profile.antiCrawl) profile.antiCrawl = [];
    profile.antiCrawl.push({ ...strategy, addedAt: Date.now() });
    return this.set(domain, profile);
  }

  // 添加备注
  addNote(domain, note) {
    domain = this._getDomain(domain);
    const profile = this.get(domain) || {};
    if (!profile.notes) profile.notes = [];
    profile.notes.push({ text: note, addedAt: Date.now() });
    return this.set(domain, profile);
  }

  // 匹配 URL 返回 profile（支持模糊匹配子域名）
  match(url) {
    const domain = this._getDomain(url);
    // 精确匹配
    const exact = this.get(domain);
    if (exact) return exact;
    // 尝试去掉 www.
    if (domain.startsWith('www.')) return this.get(domain.slice(4));
    return this.get('www.' + domain);
  }
}

export default SiteProfiles;
