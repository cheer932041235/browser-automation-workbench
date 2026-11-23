const {app,BrowserWindow,WebContentsView,ipcMain,Menu,session,shell}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);
const {pathToFileURL}=require('node:url');
const option=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const profile=option('workbench-profile');
if(!profile)throw new Error('Managed profile argument is required');
const hubMode=option('workbench-hub')==='1';
const registryPath=option('workbench-registry')||'';
const launcherPath=option('workbench-launcher')||'';
const pythonExe=option('workbench-python')||process.env.WORKBENCH_PYTHON||'python';
const label=option('workbench-label')||(hubMode?'单实例 · 按需懒加载':'专用会话');
const sessionId=option('workbench-session');
const downloadDir=option('workbench-downloads');
const workbench=process.env.BROWSER_WORKBENCH_URL||'http://127.0.0.1:3460';
const appTitle=hubMode?'启知工作台':'我的浏览器';
const topOffset=hubMode?76:118;
for(const dir of [profile,path.join(profile,'session-data'),path.join(profile,'crashes')])fs.mkdirSync(dir,{recursive:true});
app.setName(appTitle);
app.setPath('userData',profile);
app.setPath('sessionData',path.join(profile,'session-data'));
app.setPath('crashDumps',path.join(profile,'crashes'));
app.setAppUserModelId(hubMode?'local.browser.workbench.hub':'local.browser.workbench');
Menu.setApplicationMenu(null);
let win,active,quitting=false,tabSeq=0,boundsTimer;
let viewport={width:hubMode?1380:1280,height:900};
const tabs=new Map();
const hostUrl=pathToFileURL(path.join(__dirname,'shell.html')).href;
const boundsPath=path.join(profile,'window-bounds.json');
function loadHubSlots(){
  if(!hubMode)return [];
  const ports={projects:17325,personal:8769,media:3468};
  try{
    if(registryPath&&fs.existsSync(registryPath)){
      const cfg=JSON.parse(fs.readFileSync(registryPath,'utf8').replace(/^\uFEFF/,''));
      for(const row of cfg.apps||[]){if(row?.id&&Number.isInteger(row.port))ports[row.id]=row.port;}
    }
  }catch{}
  return [
    {key:'projects',appId:'projects',title:'📊 项目工作台',baseUrl:`http://127.0.0.1:${ports.projects}/`},
    {key:'personal',appId:'personal',title:'🏠 个人工作台',baseUrl:`http://127.0.0.1:${ports.personal}/`},
    {key:'media',appId:'media',title:'📱 自媒体工作台',baseUrl:`http://127.0.0.1:${ports.media}/`},
    {key:'hub',appId:'projects',title:'🎯 单窗口总控',baseUrl:`http://127.0.0.1:${ports.projects}/hub`},
  ];
}
const hubSlots=loadHubSlots();
function matchHubSlot(url){
  if(!hubMode)return null;
  for(const slot of [...hubSlots].sort((a,b)=>b.baseUrl.length-a.baseUrl.length)){
    if(url===slot.baseUrl||url.startsWith(slot.baseUrl))return slot;
  }
  return null;
}
function loadBounds(){
  if(!hubMode)return {width:1280,height:900};
  try{
    if(fs.existsSync(boundsPath)){
      const b=JSON.parse(fs.readFileSync(boundsPath,'utf8'));
      if(Number.isFinite(b?.width)&&Number.isFinite(b?.height)&&b.width>=700&&b.height>=480){
        const out={width:Math.round(b.width),height:Math.round(b.height)};
        if(Number.isFinite(b.x)&&Number.isFinite(b.y)){out.x=Math.round(b.x);out.y=Math.round(b.y);}
        return out;
      }
    }
  }catch{}
  return {width:1380,height:900};
}
function saveBounds(){
  if(!hubMode||!win||win.isDestroyed()||win.isMinimized()||win.isMaximized())return;
  clearTimeout(boundsTimer);
  boundsTimer=setTimeout(()=>{if(win&&!win.isDestroyed()){try{fs.writeFileSync(boundsPath,JSON.stringify(win.getBounds()));}catch{}}},250);
}
function pruneDestroyedTabs(){for(const [id,t] of [...tabs.entries()]){if(t.view.webContents.isDestroyed())tabs.delete(id);}}
const state=()=>{
  pruneDestroyedTabs();
  const base={
    name:appTitle,
    label,
    hub:hubMode,
    visible:win.isVisible(),
    minimized:win.isMinimized(),
    focused:win.isFocused(),
    title:win.getTitle(),
    active,
    pages:[...tabs.values()].map(t=>({targetId:t.targetId,url:t.view.webContents.getURL(),title:t.fixedTitle||t.view.webContents.getTitle()}))
  };
  if(hubMode){
    base.pid=process.pid;
    base.slots=hubSlots.map(s=>({key:s.key,title:s.title,baseUrl:s.baseUrl,loaded:tabs.has(s.key),active:active===s.key}));
  }
  return base;
};
function publish(){if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('browser-state',state());}
function layout(){if(!win||win.isDestroyed())return;const [width,height]=win.getContentSize();if(width>0&&height>topOffset)viewport={width,height};for(const t of tabs.values()){if(!t.view.webContents.isDestroyed())t.view.setBounds({x:0,y:topOffset,width:viewport.width,height:viewport.height-topOffset});}}
function select(id){const t=tabs.get(id);if(!t||t.view.webContents.isDestroyed())throw new Error('Unknown desktop page');for(const row of tabs.values()){if(row.view.webContents.isDestroyed())continue;const isActive=row===t;row.view.setVisible(isActive);row.view.webContents.setBackgroundThrottling(!isActive);}active=id;publish();}
function bringToFront(){
  if(!win||win.isDestroyed())return;
  win.setSkipTaskbar(false);
  if(win.isMinimized())win.restore();
  if(!win.isVisible())win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  if(typeof win.moveTop==='function')win.moveTop();
  setTimeout(()=>{if(win&&!win.isDestroyed())win.setAlwaysOnTop(false);},120);
  const cur=tabs.get(active)?.view?.webContents;
  if(cur&&!cur.isDestroyed())cur.focus();
}
async function ensureSlotBackend(appId){
  if(!hubMode||!launcherPath||!fs.existsSync(launcherPath)||!fs.existsSync(pythonExe))return;
  const {stdout}=await execFileAsync(pythonExe,['-B',launcherPath,'--action','ensure','--id',appId],{windowsHide:true,timeout:30000});
  const res=JSON.parse(String(stdout||'{}').trim()||'{}');
  if(!res.ok)throw new Error(res.error||'启动工作台服务失败');
}
function removeTab(targetId){
  const t=tabs.get(targetId);
  if(!t)return;
  tabs.delete(targetId);
  if(win&&!win.isDestroyed()){try{win.contentView.removeChildView(t.view);}catch{}}
  if(active===targetId){
    active=undefined;
    pruneDestroyedTabs();
    const next=tabs.keys().next().value;
    if(next){select(next);return;}
  }
  publish();
}
function webUrl(url){const u=new URL(url);if(!['https:','http:'].includes(u.protocol))throw new Error('Use an HTTP(S) address');return u.href;}
async function newPage(url,opts={}){
  url=webUrl(url);
  const view=new WebContentsView({webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.contentView.addChildView(view);
  const wc=view.webContents;
  let targetId;
  if(hubMode){
    targetId=opts.key||('extra-'+(++tabSeq));
    wc.on('before-input-event',(event,input)=>{
      if(input.type!=='keyDown')return;
      if(input.key==='F5'||((input.control||input.meta)&&!input.shift&&!input.alt&&input.key.toLowerCase()==='r')){
        event.preventDefault();wc.reload();
      }else if(input.alt&&!input.control&&!input.meta&&input.key==='ArrowLeft'){
        if(wc.navigationHistory.canGoBack()){event.preventDefault();wc.navigationHistory.goBack();}
      }
    });
  }else{
    wc.debugger.attach('1.3');
    const {targetInfo}=await wc.debugger.sendCommand('Target.getTargetInfo');
    wc.debugger.detach();
    targetId=targetInfo.targetId;
  }
  const row={targetId,view,fixedTitle:opts.fixedTitle||''};tabs.set(row.targetId,row);
  wc.once('destroyed',()=>removeTab(row.targetId));
  wc.on('render-process-gone',(_e,details)=>report(new Error('页面渲染进程退出：'+details.reason)));
  wc.on('will-prevent-unload',e=>{if(!win||win.isDestroyed()||!win.isVisible())e.preventDefault();});
  wc.setWindowOpenHandler(({url:nextUrl})=>{
    if(hubMode){
      const matched=matchHubSlot(nextUrl);
      if(matched){
        summon({key:matched.key,url:nextUrl,title:matched.title,navigate:nextUrl!==matched.baseUrl}).catch(report);
      }else if(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(nextUrl)){
        newPage(nextUrl).catch(report);
      }else if(/^https?:\/\//i.test(nextUrl)){
        shell.openExternal(nextUrl).catch(report);
      }
    }else{
      newPage(nextUrl).catch(report);
    }
    return {action:'deny'};
  });
  wc.on('will-navigate',(e,url)=>{if(!/^https?:/.test(url))e.preventDefault();});
  for(const event of ['did-navigate','did-navigate-in-page','page-title-updated','did-stop-loading'])wc.on(event,publish);
  layout();select(row.targetId);
  const loadDone=wc.loadURL(url).catch(err=>{
    if(err&&(err.code==='ERR_ABORTED'||err.errno===-3))return;
    throw err;
  });
  let domTimer,settleTimer;
  const domSettled=new Promise(resolve=>{
    domTimer=setTimeout(resolve,12000);
    wc.once('dom-ready',()=>{clearTimeout(domTimer);settleTimer=setTimeout(resolve,300);});
  });
  try{await Promise.race([loadDone,domSettled]);}
  finally{clearTimeout(domTimer);clearTimeout(settleTimer);}
  publish();return {targetId:row.targetId,url};
}
async function summon(data={}){
  const slot=hubSlots.find(s=>s.key===data.key);
  const key=data.key||slot?.key;
  const url=webUrl(data.url||slot?.baseUrl);
  const title=data.title||slot?.title||'';
  bringToFront();
  if(key&&tabs.has(key)&&!tabs.get(key).view.webContents.isDestroyed()){
    select(key);
    if(data.navigate&&tabs.get(key).view.webContents.getURL()!==url){
      await tabs.get(key).view.webContents.loadURL(url).catch(err=>{
        if(err&&(err.code==='ERR_ABORTED'||err.errno===-3))return;
        throw err;
      });
    }
  }else{
    await newPage(url,{key,fixedTitle:title});
  }
  bringToFront();
  publish();
  return state();
}
function report(error){if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('browser-error',error.message);}
async function dispatch(action,data){
  if(action==='state')return state();
  if(action==='open')return newPage(data.url);
  if(action==='summon')return summon(data);
  if(action==='human'){if(data.pageId)select(data.pageId);win.setSkipTaskbar(false);if(!win.isVisible()){const shown=new Promise(resolve=>win.once('show',resolve));win.show();await shown;}win.focus();return state();}
  if(action==='background'){win.hide();win.setSkipTaskbar(true);return state();}
  if(action==='tab-close'){
    const t=tabs.get(data.pageId);
    if(!t){if(hubMode&&data.ignoreMissing)return state();throw new Error('Unknown desktop page');}
    const wc=t.view.webContents;removeTab(data.pageId);try{if(!wc.isDestroyed())wc.close();}catch{}
    if(hubMode&&data.autoHideIfEmpty&&tabs.size===0&&win&&!win.isDestroyed()){win.hide();win.setSkipTaskbar(true);}
    return state();
  }
  if(action==='capture'){
    const t=tabs.get(data.pageId);if(!t||t.view.webContents.isDestroyed())throw new Error('Unknown desktop page');
    const wc=t.view.webContents;
    const prevBounds=t.view.getBounds();const wasActive=active===data.pageId;
    let w=Math.max(200,Math.min(3840,Math.round(data.width||prevBounds.width||viewport.width||1280)));
    let h=Math.max(200,Math.min(8000,Math.round(data.height||prevBounds.height||Math.max(300,viewport.height-topOffset))));
    let capturerHeld=false;
    try{
      t.view.setVisible(true);wc.setBackgroundThrottling(false);
      if(typeof wc.incrementCapturerCount==='function'){wc.incrementCapturerCount({width:w,height:h},true);capturerHeld=true;}
      t.view.setBounds({x:0,y:topOffset,width:w,height:h});
      await new Promise(r=>setTimeout(r,100));
      if(data.fullPage&&!data.selector){
        const doc=await wc.executeJavaScript('({w:Math.max(document.documentElement?.scrollWidth||0,window.innerWidth||0),h:Math.max(document.documentElement?.scrollHeight||0,document.body?.scrollHeight||0,window.innerHeight||0)})');
        if(!data.width&&doc?.w)w=Math.max(320,Math.min(3840,Math.ceil(doc.w)));
        h=Math.max(h,Math.min(Math.ceil(doc?.h||h),8000));
        t.view.setBounds({x:0,y:topOffset,width:w,height:h});
        await new Promise(r=>setTimeout(r,100));
      }
      let rect;
      if(data.selector){
        const box=await wc.executeJavaScript(`(()=>{const el=document.querySelector(${JSON.stringify(data.selector)});if(!el)return null;el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();return {x:Math.max(0,Math.round(r.x)),y:Math.max(0,Math.round(r.y)),width:Math.round(r.width),height:Math.round(r.height)};})()`);
        if(!box||box.width<=0||box.height<=0)throw new Error('Target selector not visible for screenshot: '+data.selector);
        rect=box;
      }
      const img=rect?await wc.capturePage(rect):await wc.capturePage();
      const buf=data.format==='jpeg'?img.toJPEG(data.quality??80):img.toPNG();
      return {data:buf.toString('base64')};
    }finally{
      try{t.view.setBounds(prevBounds);}catch{}
      try{if(!wasActive&&!wc.isDestroyed()){t.view.setVisible(false);wc.setBackgroundThrottling(true);}}catch{}
      try{if(capturerHeld&&!wc.isDestroyed())wc.decrementCapturerCount(true);}catch{}
    }
  }
  if(action==='close'){quitting=true;setImmediate(()=>app.quit());return {closed:true};}
  throw new Error('Unknown desktop action');
}
app.whenReady().then(async()=>{
  if(hubMode){
    if(!app.requestSingleInstanceLock()){app.exit(0);return;}
    app.on('second-instance',()=>bringToFront());
  }
  session.defaultSession.setPermissionRequestHandler((_contents,permission,callback)=>{callback(false);report(new Error('当前任务未授权网站设备权限：'+permission));});
  const initialBounds=loadBounds();
  viewport={width:initialBounds.width,height:initialBounds.height};
  win=new BrowserWindow({title:hubMode?'启知工作台':('我的浏览器 · '+label),...initialBounds,minWidth:700,minHeight:480,show:false,skipTaskbar:true,frame:false,backgroundColor:'#f3f6f5',icon:path.join(__dirname,'assets/browser.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.on('close',e=>{if(!quitting){e.preventDefault();saveBounds();win.hide();win.setSkipTaskbar(true);}});
  win.on('resize',()=>{layout();saveBounds();});
  if(hubMode)win.on('move',saveBounds);
  win.webContents.on('will-navigate',e=>e.preventDefault());
  win.webContents.on('page-title-updated',e=>{e.preventDefault();win.setTitle(hubMode?'启知工作台':('我的浏览器 · '+label));});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('did-finish-load',publish);
  ipcMain.handle('browser-command',async(event,action,data={})=>{
    if(event.sender!==win.webContents||event.senderFrame.url!==hostUrl)throw new Error('Desktop controls require the local shell');
    if(action==='minimize'){win.minimize();return;}
    if(action==='maximize'){win.isMaximized()?win.unmaximize():win.maximize();return;}
    if(action==='hide'){win.hide();win.setSkipTaskbar(true);return;}
    if(action==='background'){
      const response=await fetch(workbench+'/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'browser_session_resume_background',arguments:{sessionId}}),signal:AbortSignal.timeout(20000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error);return result.result;
    }
    if(action==='state')return state();
    if(action==='select'){select(data.pageId);return;}
    if(action==='open-slot'){
      const slot=hubSlots.find(x=>x.key===data.key);
      if(!slot)throw new Error('未知工作台页签');
      if(!tabs.has(slot.key))await ensureSlotBackend(slot.appId);
      return summon({key:slot.key,url:slot.baseUrl,title:slot.title});
    }
    if(action==='open')return newPage(data.url);
    if(action==='close-tab')return dispatch('tab-close',data);
    const wc=tabs.get(active)?.view.webContents;if(!wc)throw new Error('Open a page first');
    if(action==='navigate')return wc.loadURL(webUrl(data.url));
    if(action==='back'){if(wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();return;}
    if(action==='forward'){if(wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();return;}
    if(action==='reload'){wc.reload();return;}
    throw new Error('Unknown desktop control');
  });
  await win.loadFile(path.join(__dirname,'shell.html'));
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.method!=='POST'||req.headers.origin||req.headers.host!==`127.0.0.1:${server.address().port}`)throw new Error('Local desktop control required');
      let body='';for await(const part of req){body+=part;if(body.length>65536)throw new Error('Request too large');}
      const result=await dispatch(req.url.slice(1),JSON.parse(body));
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
    }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  fs.writeFileSync(path.join(profile,'desktop-control.json'),JSON.stringify({port:server.address().port,pid:process.pid}));
}).catch(error=>{console.error(error);app.exit(1);});
