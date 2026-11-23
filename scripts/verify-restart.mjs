import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { projectRoot } from '../packages/browser-engine/sessions.mjs';
const root=path.join(projectRoot,'work/restart-acceptance');await fs.mkdir(root,{recursive:true});
let uploads=0;
const fixture=http.createServer(async(req,res)=>{
  if(req.url==='/upload'){for await(const chunk of req){}uploads++;setTimeout(()=>res.end('uploaded'),700);return;}
  res.setHeader('Content-Type','text/html');res.end(`<h1>Restart fixture</h1><div id="uploaded"></div><input type="file" id="file" onchange="fetch('/upload',{method:'POST',body:this.files[0]}).then(()=>document.querySelector('#uploaded').textContent='uploaded')">`);
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const serverEntry=path.join(projectRoot,'packages/browser-engine/workbench.mjs');
let processServer,serverExit,endpoint,port;
async function start(){
  processServer=spawn(process.execPath,[serverEntry],{env:{...process.env,WORKBENCH_PORT:String(port||0),WORKBENCH_DATA_ROOT:root,WORKBENCH_HEADLESS:'1',TEMP:root,TMP:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
  serverExit=new Promise(r=>processServer.once('exit',r));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Service startup timed out')),10000);let out='';processServer.stdout.on('data',data=>{out+=data;const match=out.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){endpoint=match[0];port=Number(match[1]);clearTimeout(timer);resolve();}});processServer.once('error',reject);});
}
async function call(name,args={}){const r=await fetch(endpoint+'/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});const value=await r.json();if(!r.ok)throw new Error(value.error);return value.result;}
const checks=[];
try {
  await start();
  const existing=await call('browser_sessions');if(!existing.some(s=>s.id==='restart-session'))await call('browser_session_create',{id:'restart-session',label:'Restart test'});
  await call('browser_session_start',{sessionId:'restart-session'});
  const url=`http://127.0.0.1:${fixture.address().port}/`;
  const page=await call('browser_page_open',{sessionId:'restart-session',url});
  const file=path.join(root,'upload.txt');await fs.writeFile(file,'restart input');
  // This is a controlled fixture task; remove only its previous test record.
  await fs.rm(path.join(root,'tasks/restart-upload.json'),{force:true});
  await call('browser_task_create',{id:'restart-upload',sessionId:'restart-session',project:projectRoot,pageId:page.targetId,url,steps:[{action:'upload',selector:'#file',files:[file],check:{selector:'#uploaded',text:'uploaded'}},{action:'read'}]});
  assert.equal((await call('browser_task_run',{taskId:'restart-upload'})).status,'waiting_human');
  processServer.kill();await serverExit;
  checks.push('actual workbench process stopped after sending a real upload');
  await new Promise(r=>setTimeout(r,800));
  await start();
  assert.equal((await call('browser_task_get',{taskId:'restart-upload'})).steps[0].status,'running');
  await call('browser_session_start',{sessionId:'restart-session'});
  const result=await call('browser_task_run',{taskId:'restart-upload'});
  assert.equal(result.status,'completed');assert.equal(uploads,1);assert.equal(result.context.pageId,page.targetId);
  checks.push('new service process attaches original browser and resumes persisted step without another upload');
  await call('browser_session_close',{sessionId:'restart-session'});
  await fs.mkdir(path.join(projectRoot,'outputs/restart-acceptance'),{recursive:true});
  await fs.writeFile(path.join(projectRoot,'outputs/restart-acceptance/result.json'),JSON.stringify({passed:true,checks,uploads},null,2));
  console.log(JSON.stringify({passed:true,checks,uploads},null,2));
} finally {
  if(processServer.exitCode===null){try{await call('browser_session_close',{sessionId:'restart-session'});}catch{}processServer.kill();await serverExit;}
  fixture.closeAllConnections();await new Promise(r=>fixture.close(r));
}
