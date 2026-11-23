import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {SessionManager,projectRoot} from '../packages/browser-engine/sessions.mjs';
import {createWorkbench} from '../packages/browser-engine/workbench.mjs';

const root=path.join(projectRoot,'work/background-acceptance');
const sessions=new SessionManager({root});
const app=createWorkbench({sessions});
const fixture=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');
  res.end('<h1>Background fixture</h1><div id="identity" data-account="fixture">Fixture account</div><button id="work" onclick="document.querySelector(\'#result\').textContent=\'done\'">Work</button><div id="result"></div>');
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${fixture.address().port}/`;
const checks=[];
const id='background-fixture';
const ownWindowCount=pid=>Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`@(Get-Process -Id ${pid} | Where-Object {$_.MainWindowHandle -ne 0}).Count`],{windowsHide:true,encoding:'utf8'}).trim());
try {
  sessions.create({id,project:projectRoot,allowedUrls:[url],identity:{selector:'#identity',attribute:'data-account',value:'fixture',pageUrl:url}});
  await app.dispatch('browser_session_start',{sessionId:id});
  const page=await app.dispatch('browser_page_open',{sessionId:id,url});
  const c=await sessions.context(id);
  const pid=sessions.get(id).pid;
  assert.equal(sessions.get(id).execution,'background');
  if(process.platform==='win32')assert.equal(ownWindowCount(pid),0);
  assert.equal((await app.dispatch('browser_session_verify_identity',{sessionId:id})).verified,true);
  checks.push('default owned browser runs headless with no visible top-level window');
  await assert.rejects(()=>app.dispatch('browser_page_focus',{sessionId:id,pageId:page.targetId}),/Background sessions/);
  await assert.rejects(()=>app.dispatch('browser_session_show_human',{sessionId:id}),/request human action/);
  checks.push('normal page focus and unrequested visible-window opening are rejected');
  await app.dispatch('browser_task_create',{id:'background-work',sessionId:id,project:projectRoot,pageId:page.targetId,url,steps:[{action:'click',selector:'#work',check:{selector:'#result',text:'done'}}]});
  assert.equal((await app.dispatch('browser_task_run',{taskId:'background-work'})).status,'completed');
  checks.push('actual page action and postcondition complete in the background');
  const events=[];sessions.on('human',e=>events.push(e));
  await app.dispatch('browser_session_request_human',{sessionId:id,reason:'Fixture manual action',url});
  await app.dispatch('browser_session_request_human',{sessionId:id,reason:'Fixture manual action',url});
  assert.equal(events.length,1);assert.equal(sessions.get(id).pid,pid);
  if(process.platform==='win32')assert.equal(ownWindowCount(pid),0);
  await assert.rejects(()=>app.dispatch('browser_task_run',{taskId:'background-work'}),/human action/i);
  checks.push('human request emits once, pauses task entry and never opens a window');
  await c.interact.eval(page.targetId,"document.cookie='fixture=known;path=/;max-age=3600'");
  await sessions.close(id);
  await sessions.start(id);
  await app.dispatch('browser_session_resume_background',{sessionId:id});
  const restored=(await app.dispatch('browser_pages',{sessionId:id})).find(p=>p.url===url);
  assert.equal((await (await sessions.context(id)).interact.eval(restored.targetId,'document.cookie')).value,'fixture=known');
  checks.push('same native test profile restores its page and fixture login after browser restart');
  const result={passed:true,checks,realAccountsAccessed:false};
  await fs.mkdir(path.join(projectRoot,'outputs/background-acceptance'),{recursive:true});
  await fs.writeFile(path.join(projectRoot,'outputs/background-acceptance/result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}finally{
  for(const s of sessions.list())if(sessions.contexts.get(s.id)?.cdp.connected)await sessions.close(s.id);
  fixture.closeAllConnections();await new Promise(r=>fixture.close(r));
}
