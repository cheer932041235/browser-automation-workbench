import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

const execFileAsync = promisify(execFile);
import CDPConnection from './core.mjs';
import TabManager from './tabs.mjs';
import FrameManager from './frames.mjs';
import Interactor from './interact.mjs';
import NetworkManager from './network.mjs';
import { browserProfile, urlMatchesScope } from './browsers.mjs';
import { configureManagedChrome } from './managed-appearance.mjs';
import { desktopControl, DesktopTabs } from './desktop-control.mjs';

export class ScopedTabs extends TabManager {
  constructor(cdp, urls) { super(cdp); this.allowedUrls = urls; }
  allows(url) { return this.allowedUrls.some(a => urlMatchesScope(a, url)); }
  async listAll() {return (await super.listAll()).filter(p=>this.allows(p.url));}
  async create(url,group) {if(!this.allows(url))throw new Error('URL is outside this attached session scope');return super.create(url,group);}
  async navigate(target,url) {await this.requirePage(target);if(!this.allows(url))throw new Error('URL is outside this attached session scope');return super.navigate(target,url);}
  async close(target) {await this.requirePage(target);return super.close(target);}
}

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function readableId(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(value || '')) throw new Error('ID must use lowercase letters, numbers and hyphens');
  return value;
}
export class SessionManager extends EventEmitter {
  constructor({
    root = path.join(projectRoot, 'runtime'),
    executable,
    headless = true,
    idleTimeoutMs = Number(process.env.WORKBENCH_IDLE_TIMEOUT_MS ?? 30 * 60 * 1000),
    now = () => Date.now(),
  } = {}) {
    super();
    this.root = path.resolve(root);
    this.executable = executable;
    this.headless = headless;
    this.idleTimeoutMs = Number.isFinite(idleTimeoutMs) ? idleTimeoutMs : 30 * 60 * 1000;
    this.now = now;
    this.contexts = new Map();
    this.starting = new Map();
    this.closing = new Set();
    this._metricsCache = new Map();
    this._lastSampleAt = 0;
    fs.mkdirSync(this.root, {recursive:true});
    this.registry = path.join(this.root, 'sessions.json');
    this._registryCache = { mtimeMs: -1, size: -1, list: [] };
    this._reconcileStale();
  }
  _load() {
    if (!fs.existsSync(this.registry)) {
      this._registryCache = { mtimeMs: -1, size: -1, list: [] };
      return [];
    }
    const st = fs.statSync(this.registry);
    if (st.mtimeMs === this._registryCache.mtimeMs && st.size === this._registryCache.size) {
      return structuredClone(this._registryCache.list);
    }
    const list = JSON.parse(fs.readFileSync(this.registry, 'utf8'));
    this._registryCache = { mtimeMs: st.mtimeMs, size: st.size, list };
    return structuredClone(list);
  }
  _save(list) {
    fs.writeFileSync(this.registry+'.pending', JSON.stringify(list, null, 2));
    fs.renameSync(this.registry+'.pending', this.registry);
    const st = fs.statSync(this.registry);
    this._registryCache = { mtimeMs: st.mtimeMs, size: st.size, list: structuredClone(list) };
  }
  _isPidLive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
  }
  _reconcileStale() {
    const list = this._load();
    let changed = false;
    for (const s of list) {
      if (s.mode !== 'managed') continue;
      if (!['running', 'starting', 'closing'].includes(s.state)) {
        if (s.state === 'waiting_human' && s.pid && !this._isPidLive(s.pid)) {
          s.pid = null;
          changed = true;
        }
        continue;
      }
      if (!this._isPidLive(s.pid)) {
        s.state = s.needsHuman ? 'waiting_human' : 'closed';
        s.pid = null;
        changed = true;
      }
    }
    if (changed) this._save(list);
  }
  get(id) { const s=this._load().find(s=>s.id===readableId(id)); if (!s) throw new Error('Unknown session: '+id); return s; }
  _idleMsFor(s) {
    return s?.idleTimeoutMinutes !== undefined ? Math.round(s.idleTimeoutMinutes * 60_000) : this.idleTimeoutMs;
  }
  async sampleMetrics({ ttlMs = 10_000 } = {}) {
    const now = this.now();
    if (now - this._lastSampleAt < ttlMs && this._metricsCache.size > 0) return;
    this._lastSampleAt = now;
    const list = this._load();
    const pidMap = new Map();
    const livePids = [];
    for (const s of list) {
      if (s.pid && ['running', 'starting', 'waiting_human'].includes(s.state)) {
        livePids.push(s.pid);
      }
    }
    if (livePids.length > 0 && process.platform === 'win32') {
      try {
        const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
        const wanted = new Set(livePids.map(String));
        for (const line of stdout.split(/\r?\n/)) {
          if (!line.startsWith('"')) continue;
          const cols = line.slice(1, -1).split('","');
          if (cols.length < 5) continue;
          if (!wanted.has(cols[1])) continue;
          const memDigits = cols[4].replace(/[^\d]/g, '');
          if (memDigits) pidMap.set(Number(cols[1]), Math.round((Number(memDigits) / 1024) * 10) / 10);
        }
      } catch {}
    } else if (livePids.length > 0) {
      try {
        const { stdout } = await execFileAsync('ps', ['-o', 'pid=,rss=', '-p', livePids.join(',')], { timeout: 3000 });
        for (const line of stdout.split(/\r?\n/)) {
          const m = line.trim().match(/^(\d+)\s+(\d+)$/);
          if (m) pidMap.set(Number(m[1]), Math.round((Number(m[2]) / 1024) * 10) / 10);
        }
      } catch {}
    }
    await Promise.all(list.map(async (s) => {
      const ctx = this.contexts.get(s.id);
      let pageCount = Array.isArray(s.pages) ? s.pages.length : null;
      if (ctx?.cdp.connected) {
        try {
          const pages = await Promise.race([
            ctx.tabs.listAll(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
          ]);
          pageCount = pages.length;
        } catch {}
      }
      const memoryMB = s.pid ? (pidMap.get(s.pid) ?? null) : null;
      this._metricsCache.set(s.id, { pageCount, memoryMB, sampledAt: now });
    }));
  }
  list() {
    return this._load().map(s => {
      const ctx = this.contexts.get(s.id);
      const cached = this._metricsCache.get(s.id);
      return {
        ...s,
        connected: Boolean(ctx?.cdp.connected),
        idleClosed: Boolean(s.idleClosed),
        pageCount: cached?.pageCount ?? (Array.isArray(s.pages) ? s.pages.length : null),
        memoryMB: ctx?.cdp.connected ? (cached?.memoryMB ?? null) : null,
        idleTimeoutMs: this._idleMsFor(s),
        lastActiveAt: ctx?.lastActiveAt ? new Date(ctx.lastActiveAt).toISOString() : null,
      };
    });
  }
  touch(id) {
    const ctx = this.contexts.get(id);
    if (ctx) ctx.lastActiveAt = this.now();
  }
  create({id, label, browser='chrome', engine='native', project='', allowedUrls, identity, idleTimeoutMinutes}) {
    readableId(id);
    if (!['chrome','edge'].includes(browser)) throw new Error('Supported browsers: chrome, edge');
    if(!['native','desktop'].includes(engine)||engine==='desktop'&&browser!=='chrome')throw new Error('Desktop sessions use the bundled Chromium runtime');
    if (idleTimeoutMinutes !== undefined && (typeof idleTimeoutMinutes !== 'number' || !Number.isFinite(idleTimeoutMinutes) || idleTimeoutMinutes < 0)) {
      throw new Error('idleTimeoutMinutes must be a non-negative number');
    }
    const list=this._load();
    if (list.some(s=>s.id===id)) throw new Error('Session already exists: '+id);
    const s={id,label:label||id,browser,engine,project,mode:'managed',execution:'background',allowedUrls,identity,profile:path.join(this.root,'profiles',id),downloads:path.join(this.root,'downloads',id),pages:[],state:'closed'};
    if (idleTimeoutMinutes !== undefined) s.idleTimeoutMinutes = idleTimeoutMinutes;
    for (const dir of [s.profile,s.downloads]) fs.mkdirSync(dir,{recursive:true});
    list.push(s); this._save(list); return s;
  }
  attach({id,label,browser='chrome',project='',allowedUrls,identity}) {
    readableId(id);
    if(!Array.isArray(allowedUrls)||!allowedUrls.length)throw new Error('Attached session requires explicit page URLs');
    const profile=browserProfile(browser);
    const list=this._load();if(list.some(s=>s.id===id))throw new Error('Session already exists: '+id);
    const session={id,label:label||id,browser,project,profile,mode:'attached',allowedUrls:allowedUrls.map(url=>new URL(url).href),identity,state:'disconnected',manualDisconnect:false};
    list.push(session);this._save(list);return session;
  }
  update(id, fields) {
    const list=this._load();
    const s=list.find(s=>s.id===id);
    Object.assign(s, fields);
    this._save(list);
    const ctx=this.contexts.get(id);
    if (ctx) Object.assign(ctx.session, fields);
    return s;
  }
  async start(id) {
    if (this.starting.has(id)) return this.starting.get(id);
    const pending=this._start(id);
    this.starting.set(id,pending);
    try { return await pending; } finally { this.starting.delete(id); }
  }
  async _start(id) {
    const s=this.get(id);
    if (this.contexts.get(id)?.cdp.connected) { this.touch(id); return this.contexts.get(id); }
    const debugProfile=s.engine==='desktop'?path.join(s.profile,'session-data'):s.profile;
    const cdp=new CDPConnection({browser:s.browser,userDataDir:debugProfile,connectTimeout:s.mode==='attached'?300000:10000});
    if(s.mode==='attached') {
      await cdp.connect();
      const context={session:s,cdp,tabs:new ScopedTabs(cdp,s.allowedUrls),network:new NetworkManager(cdp),frames:new FrameManager(cdp),interact:new Interactor(cdp),lastActiveAt:this.now()};
      this.contexts.set(id,context);
      cdp.ws?.addEventListener('close',()=>{
        if(this.closing.has(id))return;
        if(this.contexts.get(id)===context)this.contexts.delete(id);
        try{this.update(id,{state:'disconnected'});}catch{}
      },{once:true});
      this.update(id,{state:'connected',everConnected:true,manualDisconnect:false});
      return context;
    }
    let ownedProcess, exitPromise;
    if (this._isPidLive(s.pid)) {
      try { await cdp.connect(); } catch {}
    }
    if (!cdp.connected) {
      const executable=s.engine==='desktop'?path.join(projectRoot,'runtime/desktop-runtime/my-browser.exe'):this.executable || (s.browser==='chrome' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
      if (!fs.existsSync(executable)) throw new Error('Browser executable not found: '+executable);
      fs.rmSync(path.join(debugProfile,'DevToolsActivePort'),{force:true});
      const temp=path.join(this.root,'temp',id); fs.mkdirSync(temp,{recursive:true});
      const args=[`--user-data-dir=${s.profile}`,`--disk-cache-dir=${path.join(s.profile,'Cache')}`,`--crash-dumps-dir=${path.join(temp,'crashes')}`,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check'];
      if(s.engine==='desktop'){
        fs.rmSync(path.join(s.profile,'desktop-control.json'),{force:true});
        args.unshift(path.join(projectRoot,'packages/browser-desktop'));
        args.push(`--workbench-profile=${s.profile}`,`--workbench-label=${s.label}`,`--workbench-session=${s.id}`,`--workbench-downloads=${s.downloads}`);
      }else{
        args.push(...configureManagedChrome(s));
        if (s.execution!=='human' && this.headless) args.push('--headless=new');
        args.push('about:blank');
      }
      const env={...process.env,TEMP:temp,TMP:temp};
      if(s.engine==='desktop')delete env.ELECTRON_RUN_AS_NODE;
      const log=s.engine==='desktop'?fs.openSync(path.join(s.profile,'desktop.log'),'a'):null;
      ownedProcess=spawn(executable,args,{windowsHide:s.engine!=='desktop',detached:true,stdio:log===null?'ignore':['ignore',log,log],env});
      if(log!==null)fs.closeSync(log);
      exitPromise=new Promise(resolve=>ownedProcess.once('exit',resolve));
      ownedProcess.unref();
      let spawnError; ownedProcess.once('error',error=>{spawnError=error;});
      this.update(id,{pid:ownedProcess.pid,state:'starting'});
      const deadline=Date.now()+15000;
      while (!fs.existsSync(path.join(debugProfile,'DevToolsActivePort')) || s.engine==='desktop'&&!fs.existsSync(path.join(s.profile,'desktop-control.json'))) {
        if (spawnError) throw spawnError;
        if (ownedProcess.exitCode!==null || Date.now()>deadline) { this.update(id,{state:'failed'}); throw new Error('Browser did not publish its debugging endpoint'); }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      await cdp.connect();
    }
    const tabs=s.engine==='desktop'?new DesktopTabs(cdp,s):s.allowedUrls?.length?new ScopedTabs(cdp,s.allowedUrls):new TabManager(cdp), network=new NetworkManager(cdp);
    const interact=new Interactor(cdp);
    interact.isHiddenDesktop=()=>s.engine==='desktop'&&this.get(id).execution!=='human';
    const context={session:this.get(id),cdp,tabs,network,frames:new FrameManager(cdp),interact,ownedProcess,exitPromise,lastActiveAt:this.now()};
    this.contexts.set(id,context);
    if (ownedProcess) {
      ownedProcess.once('exit',()=>{
        if(this.closing.has(id))return;
        if(this.contexts.get(id)===context)this.contexts.delete(id);
        try{
          const current=this.get(id);
          if(current.pid===ownedProcess.pid&&current.state!=='closed'&&current.state!=='failed'){
            this.update(id,{state:current.needsHuman?'waiting_human':'closed',pid:null});
          }
        }catch{}
      });
    }
    cdp.ws?.addEventListener?.('close',()=>{
      if(this.closing.has(id))return;
      if(this.contexts.get(id)===context)this.contexts.delete(id);
      if(!ownedProcess){
        try{
          const current=this.get(id);
          if(current.mode==='managed'&&current.state==='running'&&!this._isPidLive(current.pid)){
            this.update(id,{state:current.needsHuman?'waiting_human':'closed',pid:null});
          }
        }catch{}
      }
    },{once:true});
    network.downloadDir=s.downloads;
    await network.enableDownloads();
    this.update(id,{state:'running',idleClosed:false});
    if (s.pages?.length && (await tabs.listAll()).every(p=>p.url==='about:blank')) {
      for (const url of s.pages) await tabs.openExact(url);
    }
    this.touch(id);
    return context;
  }
  async context(id) {
    const context=this.contexts.get(id);
    if (context?.cdp.connected) {
      this.touch(id);
      return context;
    }
    const s=this._load().find(item=>item.id===id);
    if (s?.mode==='managed' && s.idleClosed && !s.needsHuman) {
      return this.start(id);
    }
    if (s?.mode==='attached' && s.everConnected && !s.manualDisconnect) {
      return this.start(id);
    }
    throw Object.assign(new Error('Session is closed or disconnected; start it explicitly: '+id),{code:'SESSION_DISCONNECTED',outcome:'not_sent'});
  }
  async close(id, { idle = false } = {}) {
    const c=this.contexts.get(id);
    if (!c?.cdp.connected) {
      if (!idle) {
        const s=this.get(id);
        if (s.mode==='managed' && s.idleClosed) {
          this.update(id,{idleClosed:false});
          return {id,state:'closed'};
        }
      }
      throw Object.assign(new Error('Session is closed or disconnected; start it explicitly: '+id),{code:'SESSION_DISCONNECTED',outcome:'not_sent'});
    }
    this.closing.add(id);
    try {
      if(c.session.mode==='attached') {
        c.cdp.ws.close();this.contexts.delete(id);this.update(id,{state:'disconnected',manualDisconnect:true});return {id,state:'disconnected',browserClosed:false};
      }
      const pages=(await c.tabs.listAll()).map(p=>p.url).filter(url=>/^https?:/.test(url));
      this.update(id,{pages,state:'closing'});
      c.ownedProcess?.ref();
      if(c.session.engine==='desktop')await desktopControl(c.session,'close');
      else await c.cdp.send('Browser.close');
      if (c.exitPromise) await c.exitPromise;
      else if (c.cdp.connected) await new Promise(resolve=>c.cdp.ws.addEventListener('close',resolve,{once:true}));
      this.contexts.delete(id);
      this._metricsCache.delete(id);
      this.update(id, idle
        ? {state:'closed',pid:null,idleClosed:true,idleClosedAt:new Date(this.now()).toISOString()}
        : {state:'closed',pid:null,idleClosed:false}
      );
      return {id,state:'closed',idleClosed:Boolean(idle)};
    } finally {
      this.closing.delete(id);
    }
  }
  async reapIdle({ isBusy } = {}) {
    const closed=[];
    const snapshot=new Map(this._load().map(s=>[s.id,s]));
    for (const [id, ctx] of Array.from(this.contexts.entries())) {
      if (this.closing.has(id) || this.starting.has(id) || !ctx?.cdp?.connected) continue;
      const s=snapshot.get(id);
      if (!s) continue;
      const timeoutMs = this._idleMsFor(s);
      if (!(timeoutMs > 0)) continue;
      if (s.mode!=='managed' || s.execution!=='background' || s.needsHuman || s.state!=='running') continue;
      if (isBusy?.(id)) { this.touch(id); continue; }
      if (ctx.network?.getDownloadStatus?.().inProgress > 0) { this.touch(id); continue; }
      if (s.engine==='desktop') {
        try {
          const st=await desktopControl(s,'state');
          if (st?.visible) { this.touch(id); continue; }
        } catch {}
      }
      if (this.now() - (ctx.lastActiveAt ?? 0) < timeoutMs) continue;
      try {
        await this.close(id,{idle:true});
        closed.push(id);
      } catch {}
    }
    return closed;
  }
  async checkIdentity(context,pageId) {
    const identity=context.session.identity;
    if(!identity)return;
    const check=`const e=document.querySelector(${JSON.stringify(identity.selector)});return !!e?.getClientRects().length && e.getAttribute(${JSON.stringify(identity.attribute)})===${JSON.stringify(identity.value)}`;
    const expression=identity.pageUrl?`new Promise(resolve=>{const check=()=>{${check}};if(check())return resolve(true);const observer=new MutationObserver(()=>{if(check()){observer.disconnect();clearTimeout(timer);resolve(true)}});const timer=setTimeout(()=>{observer.disconnect();resolve(false)},10000);observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true})})`:`(()=>{${check}})()`;
    const targets=await context.cdp.send('Target.getTargets');
    const matching=identity.pageUrl?targets.result.targetInfos.filter(t=>t.type==='page'&&t.url===identity.pageUrl):[];
    if(identity.pageUrl && matching.length!==1)throw new Error('Open the single designated account identity page in this session');
    const identityPage=identity.pageId||matching[0]?.targetId||pageId;
    if(!targets.result.targetInfos.some(t=>t.targetId===identityPage&&t.type==='page'))throw new Error('Bound visible identity page is closed');
    const r=await context.cdp.sendToTarget(identityPage,'Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.result?.result?.value!==true)throw Object.assign(new Error('Visible account identity does not match the bound session'),{code:'IDENTITY_MISMATCH',outcome:'not_sent'});
  }
  requestHuman(id,reason,url) {
    const s=this.get(id);
    if(s.mode==='attached')throw new Error('Human handoff is only available for dedicated managed sessions');
    if(!reason || !url)throw new Error('A reason and an explicit human-action URL are required');
    if(s.allowedUrls?.length && !s.allowedUrls.some(a=>urlMatchesScope(a,url)))throw new Error('Human-action URL is outside this session scope');
    const same=s.needsHuman?.reason===reason&&s.needsHuman?.url===url;
    const updated=this.update(id,{needsHuman:{reason,url},state:'waiting_human'});
    this.touch(id);
    if(!same)this.emit('human',{type:'browser.session.waiting_human',sessionId:id,project:s.project,status:'waiting_human',message:reason});
    return updated;
  }
  async showHuman(id) {
    const s=this.get(id);
    if(s.mode==='attached'||!s.needsHuman)throw new Error('A managed session must request human action before opening a window');
    if(s.engine==='desktop'){
      const c=await this.start(id);
      const pages=await c.tabs.listAll();
      let page=pages.find(p=>p.url===s.needsHuman.url);
      const identityPage=pages.find(p=>p.url===s.identity?.pageUrl);
      if(!page&&identityPage){await c.tabs.navigate(identityPage.targetId,s.needsHuman.url);page=identityPage;}
      if(!page)page=await c.tabs.openExact(s.needsHuman.url);
      await desktopControl(s,'human',{pageId:page.targetId});
      this.update(id,{execution:'human'});c.session.execution='human';
      this.touch(id);
      this.emit('human',{type:'browser.session.visible',sessionId:id,project:s.project,status:'waiting_human',message:s.label+' 已打开专用窗口'});return c;
    }
    if(s.execution==='human'&&this.contexts.get(id)?.cdp.connected){this.touch(id);return this.contexts.get(id);}
    if(this.contexts.get(id)?.cdp.connected)await this.close(id);
    this.update(id,{execution:'human'});
    const c=await this.start(id);
    const pages=await c.tabs.listAll();
    let page=pages.find(p=>p.url===s.needsHuman.url);
    if(!page&&pages.length){await c.tabs.navigate(pages[0].targetId,s.needsHuman.url);page=pages[0];}
    if(!page)page=await c.tabs.openExact(s.needsHuman.url);
    await c.cdp.send('Target.activateTarget',{targetId:page.targetId});
    await c.cdp.sendToTarget(page.targetId,'Page.bringToFront');
    this.touch(id);
    return c;
  }
  async resumeBackground(id) {
    const s=this.get(id);
    if(s.mode==='attached')throw new Error('Only dedicated sessions can switch to background');
    const c=await this.context(id);
    if(s.identity)await this.checkIdentity(c);
    if(s.engine==='desktop'){
      await desktopControl(s,'background');
      this.update(id,{needsHuman:null,execution:'background',state:'running'});c.session.execution='background';
      this.touch(id);
      this.emit('human',{type:'browser.session.background',sessionId:id,project:s.project,status:'completed',message:s.label+' 已回到后台'});
      return this.get(id);
    }
    if(s.execution==='human') {
      await this.close(id);this.update(id,{execution:'background'});await this.start(id);
    }
    const current=await this.context(id);
    if(s.identity)await this.checkIdentity(current);
    this.update(id,{needsHuman:null,execution:'background',state:'running'});
    this.touch(id);
    this.emit('human',{type:'browser.session.background',sessionId:id,project:s.project,status:'completed',message:s.label+' 已回到后台'});
    return this.get(id);
  }
}
