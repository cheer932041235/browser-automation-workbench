import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {SessionManager,projectRoot} from '../packages/browser-engine/sessions.mjs';
import {createWorkbench} from '../packages/browser-engine/workbench.mjs';

// Public screenshots use only this local fixture and disposable browser profiles.
const root=path.join(projectRoot,'work/docs-screenshots');
const output=path.join(projectRoot,'docs/images');
const manager=new SessionManager({root});
const app=createWorkbench({sessions:manager});
const fixture=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>资料整理演示</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f7f8;color:#172f35;font:16px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1040px;margin:48px auto;padding:0 32px}small{color:#277a64;font-weight:650;letter-spacing:2px}h1{font-size:38px;line-height:1.3;margin:12px 0}p{color:#61747b}.grid{display:grid;grid-template-columns:1.25fr 1fr;gap:24px;margin-top:32px}section{background:white;border:1px solid #dde7e8;border-radius:20px;padding:28px}h2{font-size:20px;margin:0 0 18px}label{display:block;color:#61747b}textarea{display:block;width:100%;height:136px;margin:10px 0 20px;padding:16px;border:1px solid #cddbdc;border-radius:12px;font:inherit;resize:none}button{background:#1d715e;color:white;border:0;border-radius:10px;padding:12px 22px;font:inherit;cursor:pointer}li{margin:14px 0;color:#476168}#status{font-size:14px;color:#277a64;margin:18px 0 0}.tag{display:inline-block;padding:4px 12px;border-radius:20px;background:#e6f3ed;color:#277a64;font-size:13px}
  </style><main><small>BROWSER WORKBENCH · 本地演示</small><h1>让网页操作成为可接续的任务</h1><p>这个页面由仓库内的演示脚本提供，不需要登录，也不连接任何个人账号。</p><div class="grid"><section><span class="tag">演示工作流</span><h2 style="margin-top:16px">资料笔记</h2><label for="note">本次整理内容</label><textarea id="note" placeholder="在这里填写笔记"></textarea><button id="save" onclick="document.querySelector('#status').textContent='笔记已保存，可以继续下一步。'">保存笔记</button><p id="status">等待填写</p></section><section><h2>同一个会话，连续完成</h2><ul><li>读取页面，选择准确的输入框</li><li>填写内容并保存，检查实际结果</li><li>需要确认时，打开独立浏览器</li><li>处理完成后，转回后台继续</li></ul><p>任务进度、页面地址与登录配置保存在本机。</p></section></div></main></html>`);
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${fixture.address().port}/`;
const endpoint=`http://127.0.0.1:${app.server.address().port}`;
const oldEndpoint=process.env.BROWSER_WORKBENCH_URL;
process.env.BROWSER_WORKBENCH_URL=endpoint;
try{
  await fs.mkdir(output,{recursive:true});
  for(const [id,label] of [['reading-demo','资料整理'],['export-demo','报告导出']]){
    manager.create({id,label,engine:'desktop',project:root,allowedUrls:[url,endpoint+'/']});
    await manager.start(id);
  }
  const page=await app.dispatch('browser_page_open',{sessionId:'reading-demo',url});
  await app.dispatch('browser_task_create',{id:'save-demo',name:'整理资料并保存笔记',sessionId:'reading-demo',project:root,pageId:page.targetId,url,steps:[
    {action:'fill',description:'填写资料笔记',selector:'#note',value:'已整理浏览器会话、任务接续与人工接管的使用方法。'},
    {action:'click',description:'保存并检查页面结果',selector:'#save',check:{selector:'#status',text:'笔记已保存'}}
  ]});
  assert.equal((await app.dispatch('browser_task_run',{taskId:'save-demo'})).status,'completed');
  const exportPage=await app.dispatch('browser_page_open',{sessionId:'export-demo',url});
  await app.dispatch('browser_task_create',{id:'confirm-demo',name:'确认资料内容后继续导出',sessionId:'export-demo',project:root,pageId:exportPage.targetId,url,steps:[
    {action:'read',description:'读取待确认内容'},
    {action:'human',description:'请确认资料内容，再继续后续步骤'}
  ]});
  assert.equal((await app.dispatch('browser_task_run',{taskId:'confirm-demo'})).status,'waiting_human');
  const c=await manager.context('reading-demo');
  const ui=await app.dispatch('browser_page_open',{sessionId:'reading-demo',url:endpoint+'/'});
  await c.cdp.sendToTarget(ui.targetId,'Runtime.evaluate',{expression:`new Promise((resolve,reject)=>{const ready=()=>document.querySelectorAll('.session').length===2&&document.querySelector('#completed-tasks .task');if(ready())return resolve();const observer=new MutationObserver(()=>{if(ready()){observer.disconnect();resolve()}});observer.observe(document.body,{subtree:true,childList:true});setTimeout(()=>{observer.disconnect();reject(new Error('Demo UI did not load'))},5000)})`,awaitPromise:true});
  await c.interact.eval(ui.targetId,"document.querySelector('#history').open=true;document.querySelector('#tasks details').open=true");
  await c.cdp.sendToTarget(ui.targetId,'Runtime.evaluate',{expression:'new Promise(r=>setTimeout(r,200))',awaitPromise:true});
  await app.dispatch('browser_page_screenshot',{sessionId:'reading-demo',pageId:ui.targetId,filePath:path.join(output,'session-workbench.png'),width:1440,height:1220,fullPage:true});
  await c.tabs.close(ui.targetId);
  await app.dispatch('browser_session_request_human',{sessionId:'reading-demo',reason:'查看演示页面的保存结果',url});
  await app.dispatch('browser_session_show_human',{sessionId:'reading-demo'});
  console.log('Captured docs/images/session-workbench.png from local demo sessions.');
  if(process.argv.includes('--show')){
    console.log('Demo window ready for a native screenshot. Send Enter to close the disposable demo.');
    await new Promise(resolve=>process.stdin.once('data',resolve));
    process.stdin.pause();
  }
}finally{
  for(const row of manager.list())if(manager.contexts.get(row.id)?.cdp.connected)await manager.close(row.id);
  fixture.closeAllConnections();app.server.closeAllConnections();await Promise.all([new Promise(r=>fixture.close(r)),new Promise(r=>app.server.close(r))]);
  await fs.rm(root,{recursive:true,force:true});
  if(oldEndpoint===undefined)delete process.env.BROWSER_WORKBENCH_URL;else process.env.BROWSER_WORKBENCH_URL=oldEndpoint;
}
