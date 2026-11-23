import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SessionManager, projectRoot } from './sessions.mjs';
import { WorkflowRunner } from './workflows.mjs';
import { desktopControl } from './desktop-control.mjs';

const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string'};
const boolean={type:'boolean'};
const frameSchema=object({frameId:string,urlPattern:string});
const identitySchema=object({selector:string,attribute:string,value:string,pageId:string,pageUrl:string},['selector','attribute','value']);

function resolveOutputPath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') throw new Error('Explicit file path is required');
  const resolved = path.isAbsolute(targetPath) ? path.normalize(targetPath) : path.resolve(projectRoot, targetPath);
  if (process.platform === 'win32') {
    const parsed = path.parse(resolved);
    if (/^C:\\$/i.test(parsed.root) && (parsed.dir === parsed.root || /^C:\\(?:tmp|temp|tmp_mbd|users\\[^\\]+\\desktop)(?:\\|$)/i.test(resolved))) {
      throw new Error('Output path must stay under a project directory or E: drive rather than C: root/temp/Desktop');
    }
  }
  return resolved;
}

export const browserTools=[
  {name:'browser_sessions',description:'List managed sessions and actual connection state (pass includeMetrics:true to sample live pageCount and memoryMB)',inputSchema:object({includeMetrics:boolean})},
  {name:'browser_session_create',description:'Create an independent local background browser profile. engine:desktop uses My Browser shell; native uses installed Chrome/Edge. Normal execution has no visible window.',inputSchema:object({id:string,label:string,browser:{enum:['chrome','edge']},engine:{enum:['native','desktop']},project:string,allowedUrls:{type:'array',items:string},identity:identitySchema,idleTimeoutMinutes:{type:'number',minimum:0}},['id'])},
  {name:'browser_session_attach',description:'Bind explicitly allowed pages of an existing authorized browser. Login stays in that browser; closing this session only disconnects the client.',inputSchema:object({id:string,label:string,browser:{enum:['chrome','edge']},project:string,allowedUrls:{type:'array',items:string,minItems:1},identity:object({selector:string,attribute:string,value:string,pageId:string},['selector','attribute','value'])},['id','browser','allowedUrls'])},
  {name:'browser_session_start',description:'Start or attach this managed session',inputSchema:object({sessionId:string},['sessionId'])},
  {name:'browser_session_close',description:'Close this owned session, preserving native login and page URLs',inputSchema:object({sessionId:string},['sessionId'])},
  {name:'browser_session_request_human',description:'Request login or approval and notify the caller without opening any window',inputSchema:object({sessionId:string,reason:string,url:string},['sessionId','reason','url'])},
  {name:'browser_session_show_human',description:'Open the dedicated browser window for an already requested human action; never opens the daily browser',inputSchema:object({sessionId:string},['sessionId'])},
  {name:'browser_session_resume_background',description:'Check visible account identity, close the human window and resume the same native profile in background',inputSchema:object({sessionId:string},['sessionId'])},
  {name:'browser_session_verify_identity',description:'Check the designated visible account identity inside this dedicated session without reading browser storage',inputSchema:object({sessionId:string},['sessionId'])},
  {name:'browser_pages',description:'List exact page IDs in the specified session',inputSchema:object({sessionId:string},['sessionId'])},
  {name:'browser_page_open',description:'Reuse the exact URL or create that URL in the specified session',inputSchema:object({sessionId:string,url:string},['sessionId','url'])},
  {name:'browser_page_read',description:'Read live URL and text of the specified page',inputSchema:object({sessionId:string,pageId:string},['sessionId','pageId'])},
  {name:'browser_page_screenshot',description:'Capture a PNG/JPEG screenshot of a page (with optional viewport emulation, fullPage, or selector clip) to a project or project-local file path',inputSchema:object({sessionId:string,pageId:string,filePath:string,fullPage:boolean,selector:string,format:{enum:['png','jpeg']},quality:{type:'integer',minimum:1,maximum:100},width:{type:'integer',minimum:200,maximum:3840},height:{type:'integer',minimum:200,maximum:3840},mobile:boolean,deviceScaleFactor:{type:'number',minimum:0.5,maximum:4}},['sessionId','pageId','filePath'])},
  {name:'browser_page_check',description:'Check responsive layout (horizontal overflow, overflowing elements, broken images) across one or more viewport widths (default [1440, 390]) and optionally save per-width screenshots',inputSchema:object({sessionId:string,pageId:string,widths:{type:'array',minItems:1,maxItems:6,items:{type:'integer',minimum:200,maximum:3840}},height:{type:'integer',minimum:200,maximum:3840},screenshotDir:string},['sessionId','pageId'])},
  {name:'browser_page_focus',description:'Bring the specified owned browser page to the foreground',inputSchema:object({sessionId:string,pageId:string},['sessionId','pageId'])},
  {name:'browser_frames',description:'List frames in the selected page with query-free URLs',inputSchema:object({sessionId:string,pageId:string},['sessionId','pageId'])},
  {name:'browser_frame_read',description:'Read visible text or interactive elements of one frame in the selected page',inputSchema:object({sessionId:string,pageId:string,frame:frameSchema,elements:{type:'boolean'},maxItems:{type:'integer',minimum:1,maximum:200}},['sessionId','pageId','frame'])},
  {name:'browser_downloads',description:'Return actual native download progress and paths',inputSchema:object({sessionId:string},['sessionId'])},
  {name:'browser_tasks',description:'List persisted task progress',inputSchema:object()},
  {name:'browser_task_create',description:'Create executable steps bound to one session and project; frame:{frameId or urlPattern} selects an iframe. Mutations only execute through task_run. Use action human for login/CAPTCHA. Set check:{selector,text} for observed recovery and nextUrl for navigation.',inputSchema:object({id:string,name:string,sessionId:string,project:string,pageId:string,url:string,steps:{type:'array',minItems:1,items:{type:'object',properties:{id:string,description:string,action:{enum:['open','read','click','fill','upload','download','human']},url:string,nextUrl:string,selector:string,value:string,sensitive:{type:'boolean'},files:{type:'array',items:string},frame:frameSchema,check:{type:'object',properties:{selector:string,text:string},required:['selector']}}}}},['id','sessionId','project','steps'])},
  {name:'browser_task_get',description:'Read saved steps, results, waiting reason and next action; same state for every caller',inputSchema:object({taskId:string},['taskId'])},
  {name:'browser_task_run',description:'Run the current ready steps. Never replay an interrupted mutation; inspect its postcondition or wait for human evidence.',inputSchema:object({taskId:string,stepId:string,sessionId:string,pageId:string,resolution:{enum:['completed','not_applied']},evidence:string,values:{type:'object',additionalProperties:string}},['taskId'])},
  {name:'browser_task_rebind',description:'Explicitly confirm a live page after navigation or browser reopen; session ownership cannot change',inputSchema:object({taskId:string,sessionId:string,pageId:string},['taskId','sessionId','pageId'])},
];

export function createWorkbench({
  sessions=new SessionManager(),
  runner=new WorkflowRunner(sessions),
  idleCheckIntervalMs=Number(process.env.WORKBENCH_IDLE_CHECK_MS ?? 60_000),
}={}) {
  const subscribers=new Set();
  const emulationLocks=new Map();
  async function withPageEmulation(pageId,fn){
    const prev=emulationLocks.get(pageId)||Promise.resolve();
    const run=prev.catch(()=>{}).then(fn);
    const tail=run.catch(()=>{});
    emulationLocks.set(pageId,tail);
    try{return await run;}
    finally{if(emulationLocks.get(pageId)===tail)emulationLocks.delete(pageId);}
  }
  const checkIntervalMs=Number.isFinite(idleCheckIntervalMs) ? idleCheckIntervalMs : 60_000;
  let reaping=false;
  const idleTimer=(checkIntervalMs > 0 && sessions.idleTimeoutMs > 0)
    ? setInterval(async()=>{
        if(reaping)return;
        reaping=true;
        try{await sessions.reapIdle({isBusy:id=>runner.activeSessions.has(id)});}
        finally{reaping=false;}
      },checkIntervalMs)
    : null;
  idleTimer?.unref();
  runner.on('result',event=>{for(const res of subscribers) res.write(`data: ${JSON.stringify(event)}\n\n`);});
  sessions.on('human',event=>{for(const res of subscribers)res.write(`data: ${JSON.stringify(event)}\n\n`);});
  async function dispatch(name,p={}) {
    const tool=browserTools.find(t=>t.name===name);
    if(!tool) throw new Error('Unknown tool: '+name);
    for(const key of tool.inputSchema.required) if(p[key]===undefined) throw new Error('Missing '+key);
    for(const key of Object.keys(p)) if(!Object.hasOwn(tool.inputSchema.properties,key)) throw new Error('Unknown argument: '+key);
    if(name==='browser_sessions') {
      if(p.includeMetrics) await sessions.sampleMetrics();
      return sessions.list();
    }
    if(name==='browser_session_create') return sessions.create(p);
    if(name==='browser_session_attach') return sessions.attach(p);
    if(name==='browser_session_start') {await sessions.start(p.sessionId);return sessions.get(p.sessionId);}
    if(name==='browser_session_close') return sessions.close(p.sessionId);
    if(name==='browser_session_verify_identity'){const c=await sessions.context(p.sessionId);if(!c.session.identity)throw new Error('Session has no bound identity');await sessions.checkIdentity(c);return {sessionId:p.sessionId,verified:true};}
    if(name==='browser_session_request_human')return sessions.requestHuman(p.sessionId,p.reason,p.url);
    if(name==='browser_session_show_human'||name==='browser_session_resume_background') {
      if(runner.activeSessions.has(p.sessionId))throw new Error('Wait for this session task to stop before changing browser mode');
      if(name==='browser_session_show_human'){await sessions.showHuman(p.sessionId);return sessions.get(p.sessionId);}
      return sessions.resumeBackground(p.sessionId);
    }
    if(name==='browser_tasks') return runner.tasks.list().map(task=>({...task,executing:runner.active.has(task.id)}));
    if(name==='browser_task_create') return runner.create(p);
    if(name==='browser_task_get') return runner.tasks.get(p.taskId);
    if(name==='browser_task_run') return runner.run(p);
    if(name==='browser_task_rebind') return runner.rebind(p);
    const c=await sessions.context(p.sessionId);
    if(name==='browser_pages') return c.tabs.listAll();
    if(name==='browser_downloads') return c.network.getDownloadStatus();
    if(name==='browser_frames' || name==='browser_frame_read') {
      await c.tabs.requirePage(p.pageId);await sessions.checkIdentity(c,p.pageId);
      if(name==='browser_frames')return c.frames.listFrames(p.pageId);
      const frameId=await c.frames.resolveFrameId(p.pageId,p.frame);
      if(frameId?.error)throw new Error(frameId.error);
      if(p.maxItems!==undefined&&(!Number.isInteger(p.maxItems)||p.maxItems<1||p.maxItems>200))throw new Error('maxItems must be between 1 and 200');
      return p.elements?c.frames.getElementsInFrame(p.pageId,frameId,p.maxItems):c.frames.getTextInFrame(p.pageId,frameId);
    }
    if(name==='browser_page_open') {
      if(!/^https?:/.test(p.url)) throw new Error('Open requires an HTTP(S) URL');
      return c.tabs.openExact(p.url);
    }
    if(name==='browser_page_read') {
      await c.tabs.requirePage(p.pageId);
      const resp=await c.cdp.sendToTarget(p.pageId,'Runtime.evaluate',{
        expression:'JSON.stringify({title:document.title,url:location.href,ready:document.readyState,scroll:{x:window.scrollX,y:window.scrollY},size:{w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,vw:window.innerWidth,vh:window.innerHeight},value:(document.body?.innerText||"").slice(0,15000)})',
        returnByValue:true,
      });
      if(resp.result?.exceptionDetails||!resp.result?.result?.value){
        throw Object.assign(new Error('页面存在，但无法读取当前文档：'+p.pageId),{code:'PAGE_UNREADABLE',targetId:p.pageId});
      }
      return {browser:c.cdp.browser,targetId:p.pageId,connected:Boolean(c.cdp.connected),state:'readable',...JSON.parse(resp.result.result.value)};
    }
    if(name==='browser_page_screenshot') {
      await c.tabs.requirePage(p.pageId);
      await sessions.checkIdentity(c,p.pageId);
      const outFile=resolveOutputPath(p.filePath);
      fs.mkdirSync(path.dirname(outFile),{recursive:true});
      return withPageEmulation(p.pageId,async()=>{
        const hiddenDesktop=c.session.engine==='desktop'&&c.session.execution!=='human';
        const format=p.format||'png';
        if(hiddenDesktop){
          const captured=await desktopControl(c.session,'capture',{
            pageId:p.pageId,
            width:p.width,
            height:p.height,
            fullPage:Boolean(p.fullPage),
            selector:p.selector,
            format,
            quality:p.quality,
          });
          const buffer=Buffer.from(captured.data,'base64');
          fs.writeFileSync(outFile,buffer);
          return {sessionId:p.sessionId,pageId:p.pageId,filePath:outFile,format,bytes:buffer.length};
        }
        const settle=()=>c.cdp.sendToTarget(p.pageId,'Runtime.evaluate',{
          expression:'new Promise(r=>{let done=false;const end=()=>{if(!done){done=true;document.documentElement?.offsetHeight;setTimeout(r,40);}};setTimeout(end,120);requestAnimationFrame(()=>requestAnimationFrame(end));})',
          awaitPromise:true,
        }).catch(()=>{});
        const needRestore=p.width!==undefined||p.height!==undefined||Boolean(p.fullPage);
        try{
          if(p.width!==undefined||p.height!==undefined){
            await c.cdp.sendToTarget(p.pageId,'Emulation.setDeviceMetricsOverride',{
              width:p.width??1440,
              height:p.height??900,
              deviceScaleFactor:p.deviceScaleFactor??1,
              mobile:Boolean(p.mobile),
            });
            await settle();
          }
          const params={format};
          if(format==='jpeg')params.quality=p.quality??80;
          if(p.selector){
            const box=await c.cdp.sendToTarget(p.pageId,'Runtime.evaluate',{
              expression:`(()=>{const el=document.querySelector(${JSON.stringify(p.selector)});if(!el)return null;el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();return {x:Math.max(0,r.x),y:Math.max(0,r.y),width:r.width,height:r.height};})()`,
              returnByValue:true,
            });
            const clip=box.result?.result?.value;
            if(!clip||clip.width<=0||clip.height<=0)throw new Error('Target selector not visible for screenshot: '+p.selector);
            params.clip={...clip,scale:1};
          }else if(p.fullPage){
            const sizeResp=await c.cdp.sendToTarget(p.pageId,'Runtime.evaluate',{
              expression:'JSON.stringify({w:Math.max(document.documentElement?.scrollWidth||0,window.innerWidth||0),h:Math.max(document.documentElement?.scrollHeight||0,document.body?.scrollHeight||0,window.innerHeight||0)})',
              returnByValue:true,
            });
            let docSize={};
            try{docSize=JSON.parse(sizeResp.result?.result?.value||'{}');}catch{}
            const fullWidth=p.width??Math.min(Math.max(Math.ceil(docSize.w||1440),320),3840);
            const fullHeight=Math.min(Math.max(Math.ceil(docSize.h||900),p.height??900),12000);
            await c.cdp.sendToTarget(p.pageId,'Emulation.setDeviceMetricsOverride',{
              width:fullWidth,
              height:fullHeight,
              deviceScaleFactor:p.deviceScaleFactor??1,
              mobile:Boolean(p.mobile),
            });
            await settle();
          }
          const shot=await c.cdp.sendToTarget(p.pageId,'Page.captureScreenshot',params);
          const buffer=Buffer.from(shot.result.data,'base64');
          fs.writeFileSync(outFile,buffer);
          return {sessionId:p.sessionId,pageId:p.pageId,filePath:outFile,format,bytes:buffer.length};
        }finally{
          if(needRestore)await c.cdp.sendToTarget(p.pageId,'Emulation.clearDeviceMetricsOverride',{}).catch(()=>{});
        }
      });
    }
    if(name==='browser_page_check') {
      await c.tabs.requirePage(p.pageId);
      await sessions.checkIdentity(c,p.pageId);
      const widths=Array.isArray(p.widths)&&p.widths.length?p.widths:[1440,390];
      const height=p.height??900;
      let shotDir=null;
      if(p.screenshotDir){
        shotDir=resolveOutputPath(p.screenshotDir);
        fs.mkdirSync(shotDir,{recursive:true});
      }
      return withPageEmulation(p.pageId,async()=>{
        const hiddenDesktop=c.session.engine==='desktop'&&c.session.execution!=='human';
        const viewports=[];
        let pageUrl='',pageTitle='';
        try{
          for(const width of widths){
            await c.cdp.sendToTarget(p.pageId,'Emulation.setDeviceMetricsOverride',{
              width,
              height,
              deviceScaleFactor:1,
              mobile:width<=480,
              ...(hiddenDesktop?{dontSetVisibleSize:true}:{}),
            });
            await c.cdp.sendToTarget(p.pageId,'Runtime.evaluate',{
              expression:'new Promise(r=>{let done=false;const end=()=>{if(!done){done=true;document.documentElement?.offsetHeight;setTimeout(r,40);}};setTimeout(end,120);requestAnimationFrame(()=>requestAnimationFrame(end));})',
              awaitPromise:true,
            }).catch(()=>{});
            const inspectResp=await c.cdp.sendToTarget(p.pageId,'Runtime.evaluate',{
              expression:`JSON.stringify((()=>{
                const vw=window.innerWidth,vh=window.innerHeight;
                const sw=document.documentElement.scrollWidth,sh=document.documentElement.scrollHeight;
                const overflowingElements=[];
                if(sw>vw+1){
                  const all=document.querySelectorAll('body *');
                  for(let i=0;i<all.length&&overflowingElements.length<10;i++){
                    const el=all[i],st=getComputedStyle(el);
                    if(st.display==='none'||st.visibility==='hidden')continue;
                    const r=el.getBoundingClientRect();
                    if(r.width<=0||r.height<=0)continue;
                    if(r.right>vw+1){
                      let sel=el.tagName.toLowerCase();
                      if(el.id)sel+='#'+el.id;
                      else if(el.className&&typeof el.className==='string'){const cls=el.className.trim().split(/\\s+/).slice(0,2).join('.');if(cls)sel+='.'+cls;}
                      overflowingElements.push({tag:el.tagName.toLowerCase(),selector:sel,left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width)});
                    }
                  }
                }
                const imgs=[...document.querySelectorAll('img')];
                const broken=[];let loaded=0;
                for(const img of imgs){
                  const src=img.currentSrc||img.getAttribute('src')||'';
                  if(!src)continue;
                  if(img.complete&&img.naturalWidth>0)loaded++;
                  else if(broken.length<20)broken.push({src:src.slice(0,200),alt:(img.alt||'').slice(0,80)});
                }
                return {
                  url:location.href,title:document.title,readyState:document.readyState,
                  innerWidth:vw,innerHeight:vh,scrollWidth:sw,scrollHeight:sh,
                  horizontalOverflow:sw>vw+1,overflowPx:Math.max(0,Math.round(sw-vw)),
                  overflowingElements,
                  images:{total:imgs.length,loaded,brokenCount:broken.length,broken}
                };
              })())`,
              returnByValue:true,
            });
            if(inspectResp.result?.exceptionDetails||!inspectResp.result?.result?.value){
              throw Object.assign(new Error('页面存在，但无法检查当前文档：'+p.pageId),{code:'PAGE_UNREADABLE',targetId:p.pageId});
            }
            const report=JSON.parse(inspectResp.result.result.value);
            pageUrl=report.url;pageTitle=report.title;
            const entry={
              requestedWidth:width,
              requestedHeight:height,
              innerWidth:report.innerWidth,
              innerHeight:report.innerHeight,
              scrollWidth:report.scrollWidth,
              scrollHeight:report.scrollHeight,
              horizontalOverflow:report.horizontalOverflow,
              overflowPx:report.overflowPx,
              overflowingElements:report.overflowingElements,
              images:report.images,
            };
            if(shotDir){
              let shotBuf;
              if(hiddenDesktop){
                await c.cdp.sendToTarget(p.pageId,'Emulation.clearDeviceMetricsOverride',{}).catch(()=>{});
                const captured=await desktopControl(c.session,'capture',{pageId:p.pageId,width,height,format:'png'});
                shotBuf=Buffer.from(captured.data,'base64');
              }else{
                const shot=await c.cdp.sendToTarget(p.pageId,'Page.captureScreenshot',{format:'png'});
                shotBuf=Buffer.from(shot.result.data,'base64');
              }
              const filePath=path.join(shotDir,`viewport-${width}px.png`);
              fs.writeFileSync(filePath,shotBuf);
              entry.screenshotPath=filePath;
            }
            viewports.push(entry);
          }
          return {
            sessionId:p.sessionId,
            pageId:p.pageId,
            url:pageUrl,
            title:pageTitle,
            passed:viewports.every(v=>!v.horizontalOverflow&&v.images.brokenCount===0),
            viewports,
          };
        }finally{
          await c.cdp.sendToTarget(p.pageId,'Emulation.clearDeviceMetricsOverride',{}).catch(()=>{});
        }
      });
    }
    if(name==='browser_page_focus') {if(c.session.mode!=='attached'&&c.session.execution!=='human')throw new Error('Background sessions do not open windows; request human action first');await c.tabs.requirePage(p.pageId);if(c.session.engine==='desktop')await desktopControl(c.session,'human',{pageId:p.pageId});else{await c.cdp.send('Target.activateTarget',{targetId:p.pageId});await c.cdp.sendToTarget(p.pageId,'Page.bringToFront');}return {focused:true};}
  }
  const web=path.join(projectRoot,'packages/browser-engine/web');
  const server=http.createServer(async(req,res)=>{
    const host=req.headers.host;
    const port=server.address()?.port;
    const origin=`http://127.0.0.1:${port}`;
    const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
    if(!allowedHosts.has(host) || (req.headers.origin && ![origin,`http://localhost:${port}`].includes(req.headers.origin))) {res.writeHead(403);res.end('Local workbench origin required');return;}
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    try {
      const url=new URL(req.url,origin);
      if(url.pathname==='/health') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({application:'browser-workbench',version:'0.6.0',dataRoot:sessions.root,connected:sessions.list().filter(s=>s.connected).length,idleTimeoutMs:sessions.idleTimeoutMs}));return;}
      if(url.pathname==='/events') {
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': connected\n\n');subscribers.add(res);req.on('close',()=>subscribers.delete(res));return;
      }
      if(url.pathname==='/api/tools') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(browserTools));return;}
      if(url.pathname==='/api/call') {
        if(req.method!=='POST' || !req.headers['content-type']?.startsWith('application/json')) {res.writeHead(415);res.end('POST application/json required');return;}
        let data='';for await(const chunk of req) {data+=chunk;if(data.length>1024*1024) throw new Error('Request too large');}
        const {name,arguments:params}=JSON.parse(data);
        const result=await dispatch(name,params);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));return;
      }
      const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/brand.svg':'brand.svg'}[url.pathname];
      if(!file) {res.writeHead(404);res.end('Not found');return;}
      res.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');
      res.end(fs.readFileSync(path.join(web,file)));
    } catch(error) {res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message,code:error.code||'WORKBENCH_ERROR',outcome:error.outcome}));}
  });
  server.on('close',()=>{if(idleTimer)clearInterval(idleTimer);});
  return {server,sessions,runner,dispatch};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const sessions=new SessionManager({root:process.env.WORKBENCH_DATA_ROOT});
  const app=createWorkbench({sessions});const port=Number(process.env.WORKBENCH_PORT||3460);
  app.server.listen(port,'127.0.0.1',()=>console.log(`Browser workbench http://127.0.0.1:${app.server.address().port}`));
}
