const $=selector=>document.querySelector(selector);
let currentSession;
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
function notice(text,error=false){$('#notice').textContent=text;$('#notice').className=error?'error':'';}
async function call(name,args={}){const r=await fetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});const data=await r.json();if(!r.ok)throw new Error(data.error);return data.result;}
function button(text,fn,primary=false){const b=node('button',text,primary?'primary':'');b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{b.disabled=false;}};return b;}
const labels={created:'待继续',pending:'待执行',done:'已完成',preparing:'待继续',running:'执行中',waiting_human:'需要处理',completed:'已完成',failed:'失败',paused:'已暂停'};
async function showBrowser(session){
  if(!session.needsHuman){
    const pages=await call('browser_pages',{sessionId:session.id});
    if(!pages.length){notice('此会话尚未打开网页，请先输入网址打开。');await showPages(session.id);return;}
    await call('browser_session_request_human',{sessionId:session.id,reason:'手动打开浏览器',url:pages[0].url});
  }
  await call('browser_session_show_human',{sessionId:session.id});
  notice(`${session.label} 已在专用窗口打开。`);
  await refresh();
}
async function refresh(){
  const [sessions,tasks]=await Promise.all([call('browser_sessions',{includeMetrics:true}),call('browser_tasks')]);
  $('#session-count').textContent=sessions.length;$('#connected-count').textContent=sessions.filter(s=>s.connected).length;
  $('#task-count').textContent=tasks.filter(t=>t.executing).length;$('#waiting-count').textContent=tasks.filter(t=>['waiting_human','failed'].includes(t.status)).length+sessions.filter(s=>s.needsHuman).length;
  $('#sessions').replaceChildren();
  if(!sessions.length){const empty=node('div',undefined,'empty');empty.append(node('strong','创建第一个专用会话'),node('span','每个会话保存自己的登录状态、站点数据和下载文件。'));$('#sessions').append(empty);}
  for(const s of sessions){
    const card=node('article',undefined,'session'),top=node('div',undefined,'session-top');
    const stateLabel=s.needsHuman?'需要处理':s.connected?(s.mode==='attached'?'日常浏览器附着':s.execution==='human'?'人工窗口':'后台运行'):s.idleClosed?'空闲休眠':s.state==='closed'?'已关闭':'未连接';
    top.append(node('h3',s.label),node('span',stateLabel,'badge'));
    const project=s.project?.replaceAll('\\','/').split('/').filter(Boolean).at(-1);
    const metaParts=[s.engine==='desktop'?'我的浏览器':s.browser==='edge'?'Edge':'Chrome',project||s.id];
    if(typeof s.pageCount==='number')metaParts.push(`${s.pageCount} 页`);
    if(s.connected&&typeof s.memoryMB==='number')metaParts.push(`${s.memoryMB} MB`);
    else if(!s.connected&&s.idleClosed)metaParts.push('访问自动唤醒');
    const meta=node('p',metaParts.join(' · '));meta.title=s.project||s.id;card.append(top,meta);
    const actions=node('div',undefined,'actions');
    actions.append(s.connected?button(s.engine==='desktop'?'打开浏览器':'查看页面',()=>s.engine==='desktop'?showBrowser(s):showPages(s.id),true):button('后台启动',async()=>{await call('browser_session_start',{sessionId:s.id});notice(`${s.label} 已在后台启动。`);await refresh();},true));
    if(s.connected&&s.engine==='desktop')actions.append(button('页面管理',()=>showPages(s.id)));
    if(s.needsHuman){card.append(node('p',s.needsHuman.reason));actions.append(button(s.execution==='human'?'处理完成，转后台':'打开专用窗口',async()=>{await call(s.execution==='human'?'browser_session_resume_background':'browser_session_show_human',{sessionId:s.id});await refresh();}));}
    if(s.connected)actions.append(button(s.mode==='attached'?'断开连接':'关闭会话',async()=>{await call('browser_session_close',{sessionId:s.id});await refresh();}));
    card.append(actions);$('#sessions').append(card);
  }
  $('#tasks').replaceChildren();
  $('#completed-tasks').replaceChildren();$('#history').hidden=!tasks.some(t=>t.status==='completed');
  if(!tasks.some(t=>t.status!=='completed'))$('#tasks').append(node('div','当前没有待处理任务。项目登记的后续步骤会显示在这里。','empty'));
  for(const t of tasks){
    const card=node('article',undefined,'task'),head=node('div',undefined,'task-head');head.append(node('h3',t.name),node('span',t.status==='running'&&!t.executing?'待接续':labels[t.status]||t.status,`badge ${t.status==='waiting_human'?'waiting':t.status==='failed'?'failed':''}`));card.append(head,node('p',`已完成 ${t.progress}`));
    const actions=node('div',undefined,'actions');
    if(t.status!=='completed')actions.append(button('继续任务',async()=>{const value=await call('browser_task_run',{taskId:t.id});notice(value.waitReason||labels[value.status]||value.status);await refresh();},true));
    card.append(actions);
    const details=node('details'),summary=node('summary','查看步骤与结果');details.append(summary);
    details.addEventListener('toggle',async()=>{if(!details.open||details.dataset.loaded)return;try{const task=await call('browser_task_get',{taskId:t.id});details.append(node('p',`${task.context.sessionId} · ${task.context.url||'尚未打开页面'}`));if(task.waitReason)details.append(node('p',task.waitReason));for(const s of task.steps)details.append(node('p',`${s.status==='done'?'✓':'·'} ${s.description} · ${labels[s.status]||s.status}`));const raw=node('details');raw.append(node('summary','执行详情'),node('pre',JSON.stringify(task,null,2)));details.append(raw);if(task.status==='waiting_human'){const form=node('form',undefined,'resolution'),select=node('select');for(const [value,text]of [['completed','已完成'],['not_applied','确认未执行']]){const option=node('option',text);option.value=value;select.append(option);}const evidence=node('input');evidence.placeholder='填写已检查的实际结果';evidence.required=true;const submit=node('button','确认并继续');form.append(select,evidence,submit);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await call('browser_task_run',{taskId:t.id,resolution:select.value,evidence:evidence.value});await refresh();}catch(error){notice(error.message,true);}finally{submit.disabled=false;}};details.append(form);}details.dataset.loaded='true';}catch(e){notice(e.message,true);}});
    card.append(details);$(t.status==='completed'?'#completed-tasks':'#tasks').append(card);
  }
}
async function showPages(id){currentSession=id;const [pages,sessions]=await Promise.all([call('browser_pages',{sessionId:id}),call('browser_sessions')]);const s=sessions.find(s=>s.id===id);$('#pages').replaceChildren();for(const p of pages){const el=node('article',undefined,'page');el.append(node('strong',p.title||'未命名页面'),node('p',p.url));if(s.mode==='attached'||s.execution==='human')el.append(button('切到浏览器',()=>call('browser_page_focus',{sessionId:id,pageId:p.targetId})));else el.append(button('申请人工查看',async()=>{await call('browser_session_request_human',{sessionId:id,reason:'需要人工查看此页面',url:p.url});$('#page-dialog').close();await refresh();}));$('#pages').append(el);}if(!$('#page-dialog').open)$('#page-dialog').showModal();}
$('#toggle-create').onclick=()=>{$('#create-session').hidden=!$('#create-session').hidden;};
$('#create-session').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await call('browser_session_create',Object.fromEntries(new FormData(e.currentTarget)));e.currentTarget.reset();e.currentTarget.hidden=true;await refresh();}catch(error){notice(error.message,true);}finally{b.disabled=false;}};
$('#open-page').onsubmit=async e=>{e.preventDefault();try{await call('browser_page_open',{sessionId:currentSession,url:new FormData(e.currentTarget).get('url')});await showPages(currentSession);await refresh();}catch(error){notice(error.message,true);}};
$('#close-dialog').onclick=()=>$('#page-dialog').close();$('#refresh').onclick=()=>refresh().catch(e=>notice(e.message,true));
const events=new EventSource('/events');events.onmessage=e=>{const event=JSON.parse(e.data);notice(event.status==='completed'?`${event.message} · 已完成`:event.message,event.status==='failed');refresh().catch(error=>notice(error.message,true));};
refresh().catch(error=>notice(error.message,true));
