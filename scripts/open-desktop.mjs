import {execFile} from 'node:child_process';
import path from 'node:path';
import {projectRoot} from '../packages/browser-engine/sessions.mjs';
const client=path.join(projectRoot,'packages/browser-engine/workbench-client.mjs');
const call=(name,args={})=>new Promise((resolve,reject)=>{
  const p=execFile(process.execPath,[client,name],{cwd:projectRoot,windowsHide:true,timeout:30000,maxBuffer:1024*1024},(error,stdout,stderr)=>{if(error)reject(new Error(stderr||error.message));else resolve(JSON.parse(stdout));});
  p.stdin.end(JSON.stringify(args));
});
const id='browser-home',url='http://127.0.0.1:3460/';
if(!(await call('browser_sessions')).some(s=>s.id===id))await call('browser_session_create',{id,label:'工作台',engine:'desktop',project:projectRoot,allowedUrls:[url]});
await call('browser_session_start',{sessionId:id});
await call('browser_session_request_human',{sessionId:id,reason:'手动打开浏览器工作台',url});
await call('browser_session_show_human',{sessionId:id});
