const $=s=>document.querySelector(s);
const command=async(action,data)=>{try{$('#error').textContent='';return await window.browser.command(action,data);}catch(error){$('#error').textContent=error.message;}};
function renderHub(state){
  document.body.classList.add('hub-mode');
  document.title=state.name||'启知工作台';
  document.querySelector('.brand strong').textContent=state.name||'启知工作台';
  $('#label').textContent=state.label||'单实例 · 按需懒加载';
  const nav=$('#tabs');nav.replaceChildren();
  const slots=state.slots||[];
  const slotKeys=new Set(slots.map(s=>s.key));
  for(const s of slots){
    const btn=document.createElement('button');
    btn.title=s.loaded?(s.title+' (已加载 · 点击切换)'):(s.title+' (未加载 · 点击启动并打开)');
    btn.className=[s.active?'active':'',s.loaded?'loaded':'unloaded'].filter(Boolean).join(' ');
    const dot=document.createElement('span');dot.className='slot-dot';btn.append(dot,document.createTextNode(s.title));
    btn.onclick=async()=>{
      if(s.loaded){await command('select',{pageId:s.key});return;}
      $('#label').textContent='正在连接 '+s.title+'…';
      await command('open-slot',{key:s.key});
    };
    if(s.loaded){
      const close=document.createElement('span');close.className='tab-close';close.setAttribute('role','button');close.setAttribute('aria-label','卸载标签释放内存');close.textContent='×';
      close.onclick=e=>{e.stopPropagation();command('close-tab',{pageId:s.key});};
      btn.append(close);
    }
    nav.append(btn);
  }
  for(const p of (state.pages||[]).filter(p=>!slotKeys.has(p.targetId))){
    const btn=document.createElement('button');
    btn.textContent=p.title||'页面加载中';btn.title=p.url;btn.className=(p.targetId===state.active?'active ':'')+'loaded';
    btn.onclick=()=>command('select',{pageId:p.targetId});
    const close=document.createElement('span');close.className='tab-close';close.setAttribute('role','button');close.setAttribute('aria-label','关闭标签');close.textContent='×';
    close.onclick=e=>{e.stopPropagation();command('close-tab',{pageId:p.targetId});};
    btn.append(close);nav.append(btn);
  }
  const tools=document.createElement('div');tools.className='hub-nav-tools';
  for(const [act,sym,tip] of [['back','←','后退'],['reload','↻','刷新 (F5)']]){
    const b=document.createElement('button');b.type='button';b.textContent=sym;b.title=tip;b.onclick=()=>command(act);tools.append(b);
  }
  nav.append(tools);
}
function update(state){if(state.hub){renderHub(state);return;}$('#label').textContent=state.label;$('#tabs').replaceChildren();for(const p of state.pages){const button=document.createElement('button');button.textContent=p.title||'页面加载中';button.title=p.url;button.className=p.targetId===state.active?'active':'';button.onclick=()=>command('select',{pageId:p.targetId});if(state.pages.length>1){const close=document.createElement('span');close.className='tab-close';close.setAttribute('role','button');close.setAttribute('aria-label','关闭标签');close.textContent='×';close.onclick=e=>{e.stopPropagation();command('close-tab',{pageId:p.targetId});};button.append(close);}$('#tabs').append(button);if(p.targetId===state.active&&document.activeElement!==$('#address'))$('#address').value=p.url;}}
window.browser.onState(update);window.browser.onError(message=>$('#error').textContent=message);
for(const action of ['back','forward','reload','minimize','maximize','hide','background'])$('#'+action).onclick=()=>command(action);
$('#navigate').onsubmit=e=>{e.preventDefault();command('navigate',{url:$('#address').value});};
command('state').then(state=>{if(state)update(state);});
