import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { SessionManager, projectRoot } from '../packages/browser-engine/sessions.mjs';
const root=path.join(projectRoot,'work/session-acceptance');
const manager=new SessionManager({root,headless:true});
const fixture=http.createServer((req,res)=>{
  if(req.url==='/download') {res.setHeader('Content-Disposition','attachment; filename="guide.txt"');res.end(req.headers.cookie||'no-user');return;}
  res.setHeader('Content-Type','text/html'); res.end('<h1>Session fixture</h1><a id="download" href="/download">Download</a>');
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${fixture.address().port}/`;
const checks=[];
const evalValue=async(c,target,expression)=>(await c.cdp.sendToTarget(target,'Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.result.value;
try {
  for(const id of ['test-alice','test-bob']) { if(!manager.list().some(s=>s.id===id)) manager.create({id,label:id,project:'controlled-test'}); }
  const [a,b]=await Promise.all(['test-alice','test-bob'].map(id=>manager.start(id)));
  const ap=await a.tabs.openExact(url),bp=await b.tabs.openExact(url);
  for(const [c,p,user] of [[a,ap,'alice'],[b,bp,'bob']]) {
    await evalValue(c,p.targetId,`(async()=>{document.cookie='user=${user};path=/;max-age=3600';localStorage.setItem('user','${user}');const db=await new Promise((r,j)=>{const q=indexedDB.open('users',1);q.onupgradeneeded=()=>q.result.createObjectStore('state');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});await new Promise((r,j)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put('${user}','user');t.oncomplete=r;t.onerror=()=>j(t.error)});db.close();return true})()`);
  }
  for(const [c,p,user] of [[a,ap,'alice'],[b,bp,'bob']]) {
    const value=await evalValue(c,p.targetId,`(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('users',1);q.onsuccess=()=>r(q.result)});const stored=await new Promise(r=>{const q=db.transaction('state').objectStore('state').get('user');q.onsuccess=()=>r(q.result)});db.close();return {cookie:document.cookie,local:localStorage.getItem('user'),stored}})()`);
    assert.equal(value.cookie,'user='+user);assert.equal(value.local,user);assert.equal(value.stored,user);
    const downloaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Download not completed')),5000);const entry=c.cdp.on('Browser.downloadProgress',p=>{if(p.state==='completed'){clearTimeout(timer);c.cdp.off('Browser.downloadProgress',entry);resolve(p)}})});
    await c.interact.click(p.targetId,'#download'); await downloaded;
    const download=c.network.getDownloadStatus().downloads.at(-1);
    assert.ok(download.path.startsWith(manager.get(c.session.id).downloads));
    assert.equal(await fs.readFile(download.path,'utf8'),'user='+user);
  }
  checks.push('two native profiles isolate cookies, localStorage, IndexedDB and real downloads');
  await assert.rejects(()=>a.tabs.inspect(bp.targetId),{code:'PAGE_NOT_FOUND'});
  checks.push('foreign page is rejected');
  await manager.close('test-alice');
  assert.equal((await b.tabs.inspect(bp.targetId)).url,url);
  const reopened=await manager.start('test-alice');
  const restored=(await reopened.tabs.listAll()).find(p=>p.url===url);
  assert.ok(restored);
  assert.equal(await evalValue(reopened,restored.targetId,'localStorage.getItem("user")'),'alice');
  assert.equal(await evalValue(reopened,restored.targetId,'document.cookie'),'user=alice');
  checks.push('close A leaves B running; reopen A restores page and native login');
  const managerRestart=new SessionManager({root,headless:true});
  const attached=await managerRestart.start('test-bob');
  assert.ok((await attached.tabs.listAll()).some(p=>p.targetId===bp.targetId));
  attached.cdp.ws.close();
  checks.push('manager restart attaches the same owned browser without launching another');
  assert.ok(manager.list().every(s=>s.profile.startsWith(root)&&s.downloads.startsWith(root)));
  checks.push('all managed profile, download and temp roots on E drive');
  console.log(JSON.stringify({passed:true,checks},null,2));
  await fs.mkdir(path.join(projectRoot,'outputs/session-acceptance'),{recursive:true});
  await fs.writeFile(path.join(projectRoot,'outputs/session-acceptance/result.json'),JSON.stringify({passed:true,checks},null,2));
} finally {
  for(const s of manager.list()) if(manager.contexts.get(s.id)?.cdp.connected) await manager.close(s.id);
  fixture.closeAllConnections();await new Promise(r=>fixture.close(r));
}
