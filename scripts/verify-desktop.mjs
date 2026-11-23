import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {SessionManager,projectRoot} from '../packages/browser-engine/sessions.mjs';
import {createWorkbench} from '../packages/browser-engine/workbench.mjs';
import {desktopControl} from '../packages/browser-engine/desktop-control.mjs';
import {execFileSync} from 'node:child_process';

const root=path.join(projectRoot,'work/desktop-acceptance');
const manager=new SessionManager({root});
const app=createWorkbench({sessions:manager});
let uploads=0;
const fixture=http.createServer(async(req,res)=>{
  if(req.url==='/upload'){for await(const part of req){}uploads++;res.end('received');return;}
  if(req.url==='/download'){res.setHeader('Content-Disposition','attachment; filename="desktop-result.txt"');res.end('desktop-download');return;}
  res.setHeader('Content-Type','text/html');res.end('<title>Desktop fixture</title><h1>Desktop fixture</h1><input id="file" type="file" onchange="fetch(\'/upload\',{method:\'POST\',body:this.files[0]}).then(()=>document.querySelector(\'#result\').textContent=\'uploaded\')"><div id="result"></div><a id="download" href="/download">Download</a>');
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const oldEndpoint=process.env.BROWSER_WORKBENCH_URL;
process.env.BROWSER_WORKBENCH_URL=`http://127.0.0.1:${app.server.address().port}`;
const url=`http://127.0.0.1:${fixture.address().port}/`;
const id='desktop-fixture',checks=[];
try{
  manager.create({id,label:'外壳验收',engine:'desktop',project:projectRoot,allowedUrls:[url]});
  await app.dispatch('browser_session_start',{sessionId:id});
  const page=await app.dispatch('browser_page_open',{sessionId:id,url});
  const c=await manager.context(id);
  assert.equal((await desktopControl(manager.get(id),'state')).visible,false);
  assert.equal((await app.dispatch('browser_page_read',{sessionId:id,pageId:page.targetId})).title,'Desktop fixture');
  assert.ok((await c.interact.eval(page.targetId,'innerWidth')).value>0);
  assert.equal((await c.interact.eval(page.targetId,"({node:typeof require,bridge:typeof window.browser})")).value.node,'undefined');
  assert.equal((await c.interact.eval(page.targetId,'typeof window.browser')).value,'undefined');
  checks.push('independent branded runtime loads a sandboxed remote page while its window stays hidden');
  manager.create({id:'desktop-other',label:'隔离验收',engine:'desktop',project:projectRoot,allowedUrls:[url,process.env.BROWSER_WORKBENCH_URL+'/']});
  await manager.start('desktop-other');
  const other=await manager.context('desktop-other'),otherPage=await other.tabs.openExact(url);
  await c.interact.eval(page.targetId,"document.cookie='fixture=owner;path=/;max-age=3600'");
  assert.equal((await other.interact.eval(otherPage.targetId,'document.cookie')).value,'');
  await assert.rejects(()=>other.tabs.requirePage(page.targetId),{code:'PAGE_NOT_FOUND'});
  checks.push('two desktop profiles isolate native test login and reject foreign page IDs');
  const input=path.join(root,'input.txt');await fs.writeFile(input,'owned test file');
  await app.dispatch('browser_task_create',{id:'desktop-upload',sessionId:id,project:projectRoot,pageId:page.targetId,url,steps:[{action:'upload',selector:'#file',files:[input],check:{selector:'#result',text:'uploaded'}}]});
  assert.equal((await app.dispatch('browser_task_run',{taskId:'desktop-upload'})).status,'completed');
  assert.equal((await app.dispatch('browser_task_run',{taskId:'desktop-upload'})).status,'completed');
  assert.equal(uploads,1);checks.push('existing workflow runner uploads once and resumes without a duplicate');
  const download=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Desktop download did not complete')),5000);const handler=c.cdp.on('Browser.downloadProgress',p=>{if(p.state==='completed'){clearTimeout(timer);c.cdp.off('Browser.downloadProgress',handler);resolve();}});});
  await c.interact.click(page.targetId,'#download');await download;
  const item=c.network.getDownloadStatus().downloads.at(-1);assert.equal(await fs.readFile(item.path,'utf8'),'desktop-download');
  checks.push('existing native download tracking completes inside the dedicated download directory');
  const controlPage=await other.tabs.openExact(process.env.BROWSER_WORKBENCH_URL+'/');
  await other.cdp.sendToTarget(controlPage.targetId,'Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{
    let clicked=false;const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Open-browser button did not show the native window'))},7000);
    const check=()=>{const card=[...document.querySelectorAll('.session')].find(e=>e.querySelector('h3')?.textContent==='外壳验收');
      if(!clicked&&card){const button=[...card.querySelectorAll('button')].find(b=>b.textContent==='打开浏览器');if(button){clicked=true;button.click();}}
      if(document.querySelector('#notice')?.textContent==='外壳验收 已在专用窗口打开。'){clearTimeout(timer);observer.disconnect();resolve();}};
    const observer=new MutationObserver(check);observer.observe(document.body,{subtree:true,childList:true,characterData:true});check();
  })`,awaitPromise:true});
  const shown=await desktopControl(manager.get(id),'state');
  const native=execFileSync(process.env.WORKBENCH_PYTHON||'python',['-B','-c',`import ctypes,json; pid=${manager.get(id).pid}; rows=[]; callback=ctypes.WINFUNCTYPE(ctypes.c_bool,ctypes.c_void_p,ctypes.c_void_p); u=ctypes.windll.user32
@callback
def visit(hwnd,_):
 p=ctypes.c_ulong(); u.GetWindowThreadProcessId(hwnd,ctypes.byref(p))
 if p.value==pid: rows.append({'visible':bool(u.IsWindowVisible(hwnd)),'handle':int(hwnd)})
 return True
u.EnumWindows(visit,0); print(json.dumps(rows))`],{windowsHide:true,encoding:'utf8'});
  assert.equal(shown.visible,true,JSON.stringify({shown,native:JSON.parse(native)}));
  assert.ok(JSON.parse(native).some(w=>w.visible));
  const host=(await c.cdp.send('Target.getTargets')).result.targetInfos.find(p=>p.url.endsWith('/shell.html'));
  assert.ok(host);
  const brand=await c.interact.eval(host.targetId,"({title:document.title,name:document.querySelector('strong').textContent,url:document.querySelector('#address').value})");
  assert.equal(brand.value.name,'我的浏览器');assert.equal(brand.value.url,url);
  await fs.mkdir(path.join(projectRoot,'outputs/desktop-acceptance'),{recursive:true});
  const shot=await c.cdp.sendToTarget(host.targetId,'Page.captureScreenshot',{format:'png'});
  await fs.writeFile(path.join(projectRoot,'outputs/desktop-acceptance/shell.png'),Buffer.from(shot.result.data,'base64'));
  const pid=manager.get(id).pid;
  const hidden=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Shell button did not return to background')),5000);manager.once('human',e=>{clearTimeout(timer);resolve(e);});});
  await c.interact.click(host.targetId,'#background');await hidden;
  assert.equal((await desktopControl(manager.get(id),'state')).visible,false);
  assert.ok((await c.interact.eval(page.targetId,'innerWidth')).value>0);
  assert.equal(manager.get(id).pid,pid);
  assert.equal((await app.dispatch('browser_pages',{sessionId:id}))[0].targetId,page.targetId);
  checks.push('management UI open-browser button shows the real native window; shell background button retains process/page IDs');
  await manager.close(id);await manager.start(id);
  assert.equal((await desktopControl(manager.get(id),'state')).visible,false);
  assert.ok((await app.dispatch('browser_pages',{sessionId:id})).some(p=>p.url===url));
  const restored=(await app.dispatch('browser_pages',{sessionId:id}))[0];
  assert.equal((await (await manager.context(id)).interact.eval(restored.targetId,'document.cookie')).value,'fixture=owner');
  checks.push('owned runtime restart restores pages in background through the original session registry');
  const second=await app.dispatch('browser_page_open',{sessionId:id,url:url+'?second=1'});
  const liveCtx=await manager.context(id);
  await liveCtx.cdp.send('Target.closeTarget',{targetId:second.targetId});
  let afterExternalClose=null;
  for(let i=0;i<20;i++){
    afterExternalClose=await desktopControl(manager.get(id),'state');
    if(!afterExternalClose.pages.some(p=>p.targetId===second.targetId))break;
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(afterExternalClose.pages.some(p=>p.targetId===second.targetId),false);
  assert.equal(afterExternalClose.pages.length,1);
  checks.push('external CDP Target.closeTarget cleans up desktop shell tabs without throwing destroyed errors');
  const result={passed:true,checks,uploads};
  await fs.writeFile(path.join(projectRoot,'outputs/desktop-acceptance/result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
  for(const row of manager.list())if(manager.contexts.get(row.id)?.cdp.connected)await manager.close(row.id);
  fixture.closeAllConnections();app.server.closeAllConnections();await Promise.all([new Promise(r=>fixture.close(r)),new Promise(r=>app.server.close(r))]);
  if(oldEndpoint===undefined)delete process.env.BROWSER_WORKBENCH_URL;else process.env.BROWSER_WORKBENCH_URL=oldEndpoint;
}
