import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { projectRoot } from '../packages/browser-engine/sessions.mjs';
const endpoint='http://127.0.0.1:3460';
async function health() {
  try {const response=await fetch(endpoint+'/health',{signal:AbortSignal.timeout(1500)});if(!response.ok)throw new Error('Workbench port is occupied');const data=await response.json();if(data.application!=='browser-workbench')throw new Error('Workbench port is occupied');return data;}
  catch(error){if(error.cause?.code==='ECONNREFUSED')return null;throw error;}
}
if(!await health()) {
  const logs=path.join(projectRoot,'runtime/logs');fs.mkdirSync(logs,{recursive:true});
  const out=fs.openSync(path.join(logs,'workbench.log'),'a');
  const child=spawn(process.execPath,[path.join(projectRoot,'packages/browser-engine/workbench.mjs')],{cwd:projectRoot,detached:true,windowsHide:true,stdio:['ignore',out,out]});
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.unref();fs.closeSync(out);
  const deadline=Date.now()+10000;
  while(!await health()){if(Date.now()>deadline)throw new Error('Workbench did not become ready; see runtime/logs/workbench.log');await new Promise(r=>setTimeout(r,100));}
}
console.log(endpoint);
if(process.argv.includes('--open')) spawn(process.execPath,[path.join(projectRoot,'scripts/open-desktop.mjs')],{cwd:projectRoot,windowsHide:true,stdio:'ignore'}).unref();
