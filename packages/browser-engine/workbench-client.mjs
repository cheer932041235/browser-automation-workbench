import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { displayFrameUrl } from './frames.mjs';
import { browserTools } from './workbench.mjs';
const endpoint=process.env.BROWSER_WORKBENCH_URL||'http://127.0.0.1:3460';
if(!['127.0.0.1','localhost'].includes(new URL(endpoint).hostname)) throw new Error('A local workbench URL is required');
let starting;
async function ensureWorkbench() {
  if(!starting) starting=(async()=>{
    try {const r=await fetch(endpoint+'/health',{signal:AbortSignal.timeout(2000)});const health=await r.json();if(health.application!=='browser-workbench')throw new Error('Selected port is not Browser Workbench');}
    catch(error) {
      if(endpoint!=='http://127.0.0.1:3460' || error.cause?.code!=='ECONNREFUSED') throw error;
      const starter=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../scripts/start-workbench.mjs');
      await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[starter],{windowsHide:true,stdio:['ignore','ignore','pipe']});let message='';p.stderr.on('data',d=>message+=d);p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error(message||'Workbench did not start')));});
    }
  })();
  return starting;
}
const call=async(name,params)=>{
  await ensureWorkbench();
  const res=await fetch(endpoint+'/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:params})});
  const data=await res.json();if(!res.ok) throw new Error(data.error);
  if(name==='browser_frames' && Array.isArray(data.result))return data.result.map(frame=>({...frame,url:displayFrameUrl(frame.url)}));
  return data.result;
};
if(process.argv.includes('--mcp')) {
  const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
  lines.on('line',async line=>{
    let req;
    try {
      req=JSON.parse(line.trim());if(req.id===undefined) return;
      let result;
      if(req.method==='initialize') result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18'].includes(req.params?.protocolVersion)?req.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'browser-workbench',version:'0.6.0'}};
      else if(req.method==='ping') result={};
      else if(req.method==='tools/list') result={tools:browserTools};
      else if(req.method==='tools/call') {
        try {const value=await call(req.params.name,req.params.arguments||{});result={content:[{type:'text',text:JSON.stringify(value)}]};}
        catch(error) {result={isError:true,content:[{type:'text',text:error.message}]};}
      } else {send({jsonrpc:'2.0',id:req.id,error:{code:-32601,message:'Method not found'}});return;}
      send({jsonrpc:'2.0',id:req.id,result});
    } catch(error) {send({jsonrpc:'2.0',id:req?.id??null,error:{code:-32603,message:error.message}});}
  });
} else {
  let input='';for await(const chunk of process.stdin) input+=chunk;
  try {console.log(JSON.stringify(await call(process.argv[2],input.trim()?JSON.parse(input.trim()):{}),null,2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
