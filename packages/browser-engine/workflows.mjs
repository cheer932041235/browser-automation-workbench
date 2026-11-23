import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import TaskManager from './tasks.mjs';
import { readableId } from './sessions.mjs';

const operations=new Set(['open','read','click','fill','upload','download','human']);
export class WorkflowRunner extends EventEmitter {
  constructor(sessions,{dir=path.join(sessions.root,'tasks')}={}) {
    super(); this.sessions=sessions; this.tasks=new TaskManager({dir}); this.active=new Set();this.activeSessions=new Map();this.ephemeralValues=new Map();
  }
  create(plan) {
    readableId(plan.id);this.sessions.get(plan.sessionId);
    if(!plan.steps?.length) throw new Error('A task needs executable steps');
    if(!plan.project || !path.isAbsolute(plan.project)) throw new Error('An absolute project directory is required');
    const pendingSecrets=[];
    const steps=plan.steps.map((s,i)=>{
      if(!operations.has(s.action)) throw new Error('Unsupported action: '+s.action);
      if(s.action==='open' && !/^https?:/.test(s.url||'')) throw new Error('Open requires an HTTP(S) URL');
      if(['click','fill','upload','download'].includes(s.action) && !s.selector) throw new Error('Action requires a selector');
      if(s.action==='upload' && (!Array.isArray(s.files)||s.files.some(f=>!path.isAbsolute(f)||!fs.existsSync(f)))) throw new Error('Upload files must already exist at absolute paths');
      const id=s.id||`step-${i+1}`;
      let data=s.action==='open'?{...s,url:new URL(s.url).href}:{...s};
      if(s.action==='fill' && s.sensitive) {
        if(s.value!==undefined && s.value!=='[REDACTED]') pendingSecrets.push([`${plan.id}:${id}`,s.value]);
        data={...data,value:'[REDACTED]',sensitive:true};
      }
      return {id,description:s.description||s.action,data};
    });
    if(new Set(steps.map(s=>s.id)).size!==steps.length) throw new Error('Step IDs must be unique');
    const created=this.tasks.create(plan.id,{name:plan.name||plan.id,steps,context:{sessionId:plan.sessionId,project:plan.project,pageId:plan.pageId||null,url:plan.url||null}});
    for(const [k,v] of pendingSecrets) this.ephemeralValues.set(k,v);
    return created;
  }
  _event(task) {
    const message=task.waitReason||task.steps.find(s=>s.status==='failed')?.error||task.name;
    if(['completed','failed','waiting_human'].includes(task.status) && (task.lastEvent?.status!==task.status || task.lastEvent?.message!==message)) {
      task.lastEvent={type:'browser.task.'+task.status,taskId:task.id,sessionId:task.context.sessionId,project:task.context.project,status:task.status,at:new Date().toISOString(),message};
      this.tasks._save(task.id,task);this.emit('result',task.lastEvent);
    }
    return task;
  }
  _wait(task,reason) { task.status='waiting_human';task.waitReason=reason;task.updatedAt=new Date().toISOString();this.tasks._save(task.id,task);return this._event(task); }
  async inspectPage(context) {
    const c=await this.sessions.context(context.sessionId);
    const page=await c.tabs.inspect(context.pageId);
    await this.sessions.checkIdentity(c,context.pageId);
    if(context.url && page.url!==context.url) throw Object.assign(new Error('Page URL changed; inspect it before continuing'),{code:'PAGE_CHANGED',outcome:'not_sent'});
    return {c,page};
  }
  async _frameId(c,target,data) {
    if(!data.frame)return null;
    const id=await c.frames.resolveFrameId(target,data.frame);
    if(id?.error)throw new Error(id.error);
    return id;
  }
  async _eval(c,target,data,expression) {
    const frame=await this._frameId(c,target,data);
    return frame?c.frames.evalInFrame(target,frame,expression):c.interact.eval(target,expression);
  }
  async _check(task,step) {
    if(!step.data.check) return false;
    const {c}=await this.inspectPage({...task.context,url:step.data.nextUrl||task.context.url});
    const check=step.data.check;
    if(!check.selector) throw new Error('Postcondition requires a selector');
    const expression=`(()=>{const el=document.querySelector(${JSON.stringify(check.selector)});return !!el && ${check.text!==undefined?`el.textContent.includes(${JSON.stringify(check.text)})`:'true'} })()`;
    const r=await this._eval(c,task.context.pageId,step.data,expression);
    return r.value===true;
  }
  async _download(c,task,step) {
    const target=task.context.pageId;
    const frameIds=new Set((await c.frames.getFrameTree(target)).map(f=>f.frameId));
    return new Promise((resolve,reject)=>{
      let guid;
      const cleanup=()=>{clearTimeout(timer);c.cdp.off('Browser.downloadWillBegin',begin);c.cdp.off('Browser.downloadProgress',progress);};
      const begin=c.cdp.on('Browser.downloadWillBegin',p=>{
        if(guid || !frameIds.has(p.frameId)) return;
        guid=p.guid;
        const saved=this.tasks.get(task.id);saved.steps.find(s=>s.id===step.id).result={downloadPath:path.join(c.network.downloadDir,guid),filename:p.suggestedFilename};this.tasks._save(task.id,saved);
      });
      const progress=c.cdp.on('Browser.downloadProgress',p=>{
        if(p.guid!==guid) return;
        if(p.state==='completed') {cleanup();resolve(this.tasks.get(task.id).steps.find(s=>s.id===step.id).result);}
        if(p.state==='canceled') {cleanup();reject(new Error('Download canceled'));}
      });
      const timer=setTimeout(()=>{cleanup();reject(Object.assign(new Error('Download is not yet confirmed; inspect its saved path'),{outcome:'unknown'}));},30000);
      c.interact.click(target,step.data.selector).then(result=>{if(result.error||result.value?.error){cleanup();reject(new Error(result.error||result.value.error));}}).catch(error=>{cleanup();reject(error);});
    });
  }
  async _click(c,target,data) {
    if(!data.nextUrl) return c.interact.click(target,data.selector);
    await c.cdp.sendToTarget(target,'Page.enable');
    let finish,timer;
    const navigation=new Promise((resolve,reject)=>{
      finish=resolve;
      timer=setTimeout(()=>reject(Object.assign(new Error('Expected navigation not confirmed; inspect the page'),{outcome:'unknown'})),15000);
    });
    const navigated=c.cdp.onTarget('Page.frameNavigated',target,p=>{if(!p.frame.parentId && p.frame.url===data.nextUrl)finish();});
    const within=c.cdp.onTarget('Page.navigatedWithinDocument',target,p=>{if(p.url===data.nextUrl)finish();});
    const click=c.interact.click(target,data.selector).then(result=>{if(result.error||result.value?.error)throw new Error(result.error||result.value.error);return result;});
    try {const [result]=await Promise.all([click,navigation]);return result;}
    finally {clearTimeout(timer);c.cdp.offTarget('Page.frameNavigated',target,navigated);c.cdp.offTarget('Page.navigatedWithinDocument',target,within);}
  }
  async run({taskId,stepId,sessionId,pageId,resolution,evidence,values}) {
    if(this.active.has(taskId)) throw new Error('Task is already executing');
    let task=this.tasks.get(taskId);
    if(!task) throw new Error('Unknown task: '+taskId);
    if(this.sessions.get(task.context.sessionId).needsHuman)throw Object.assign(new Error('This dedicated session is waiting for human action'),{code:'HUMAN_REQUIRED',outcome:'not_sent'});
    if(this.activeSessions.has(task.context.sessionId)) throw new Error('Another task is executing in this session');
    if(sessionId && sessionId!==task.context.sessionId) throw new Error('Wrong session for this task');
    if(pageId && pageId!==task.context.pageId) throw new Error('Wrong page for this task');
    let step=task.steps.find(s=>s.status!=='done');
    if(stepId && stepId!==step?.id) throw new Error('Cannot skip task steps');
    if(!step) return task;
    this.active.add(taskId);
    this.activeSessions.set(task.context.sessionId,taskId);
    try {
      if(step.status==='running' || task.status==='waiting_human') {
        let recoveredOpen=false;
        if(step.data.action==='open') {
          const c=await this.sessions.context(task.context.sessionId);
          const matches=(await c.tabs.listAll()).filter(p=>p.url===step.data.url);
          if(matches.length===1) {task.context.pageId=matches[0].targetId;task.context.url=matches[0].url;recoveredOpen=true;}
        }
        let recoveredRead;
        if(step.data.action==='read') {const {c}=await this.inspectPage(task.context);recoveredRead=await this._eval(c,task.context.pageId,step.data,'({title:document.title,text:document.body.innerText.slice(0,15000)})');if(recoveredRead.error) throw new Error(recoveredRead.error);}
        const recoveredDownload=step.data.action==='download' && step.result?.downloadPath && fs.existsSync(step.result.downloadPath);
        const checked=step.data.check && task.context.pageId ? await this._check(task,step) : true;
        const satisfied=checked && (recoveredOpen || recoveredRead || recoveredDownload || (step.data.check && task.context.pageId));
        if(satisfied || (resolution==='completed' && evidence)) {
          if(satisfied && step.data.nextUrl) task.context.url=step.data.nextUrl;
          step.status='running';this.tasks._save(task.id,task);
          this.tasks.stepDone(task.id,step.id,{...step.result,recovered:true,result:recoveredRead,evidence:satisfied?'observed page result':evidence});
          const saved=this.tasks.get(taskId);delete saved.waitReason;delete saved.lastEvent;this.tasks._save(taskId,saved);
        } else if(resolution==='not_applied' && evidence) {
          step.status='pending';task.status='preparing';step.error=null;this.tasks._save(task.id,task);
        } else return this._wait(task,'Previous action outcome needs inspection; the action was not repeated');
      } else if(step.status==='failed') {
        return this._wait(task,'Correct the failed step or confirm that it was not applied before resuming');
      }
      while((task=this.tasks.get(taskId)).status!=='completed') {
        step=task.steps.find(s=>s.status!=='done');
        if(step.data.action==='human') {step.status='running';this.tasks._save(taskId,task);return this._wait(task,step.description);}
        const c=await this.sessions.context(task.context.sessionId);
        if(step.data.action!=='open') await this.inspectPage(task.context);
        let fillValue=step.data.value;
        if(step.data.action==='fill') {
          fillValue=values?.[step.id] ?? (step.data.sensitive?this.ephemeralValues.get(`${taskId}:${step.id}`):step.data.value);
          if(step.data.sensitive && (fillValue===undefined || fillValue==='[REDACTED]')) {
            throw Object.assign(new Error('Sensitive fill step requires runtime values.'+step.id),{code:'SENSITIVE_VALUE_REQUIRED',outcome:'not_sent'});
          }
        }
        this.tasks.stepStart(taskId,step.id);
        try {
          let result;
          const d=step.data,target=task.context.pageId;
          if(d.action==='open') {
            result=await c.tabs.openExact(d.url);
            const page=await c.tabs.inspect(result.targetId);
            this.tasks.updateContext(taskId,{pageId:result.targetId,url:page.url});
          } else if(d.action==='read') {
            result=await this._eval(c,target,d,'({title:document.title,text:document.body.innerText.slice(0,15000)})');
          } else if(d.action==='click') {
            const frame=await this._frameId(c,target,d);
            result=frame?await c.frames.clickInFrame(target,frame,d.selector):await this._click(c,target,d);
          }
          else if(d.action==='download') result=await this._download(c,task,step);
          else if(d.action==='fill') {const frame=await this._frameId(c,target,d);result=frame?await c.frames.fillInFrame(target,frame,d.selector,fillValue,{sensitive:Boolean(d.sensitive)}):await c.interact.fill(target,d.selector,fillValue,{sensitive:Boolean(d.sensitive)});}
          else if(d.action==='upload') {const frame=await this._frameId(c,target,d);result=frame?await c.frames.uploadInFrame(target,frame,d.selector,d.files):await c.interact.setFiles(target,d.selector,d.files);}
          if(result?.error || result?.value?.error) throw new Error(result.error||result.value.error);
          if(d.check) {
            const liveTask=this.tasks.get(taskId);
            if(!await this._check(liveTask,step)) return this._wait(liveTask,'Action sent; waiting for its expected page result');
          }
          if(d.nextUrl) this.tasks.updateContext(taskId,{url:d.nextUrl});
          task=this.tasks.stepDone(taskId,step.id,result);
          if(d.action==='fill' && d.sensitive) this.ephemeralValues.delete(`${taskId}:${step.id}`);
          delete task.waitReason;delete task.lastEvent;this.tasks._save(taskId,task);
          if(stepId) break;
        } catch(error) {
          task=this.tasks.get(taskId);
          if(error.outcome==='unknown') return this._wait(task,error.message);
          task=this.tasks.stepFail(taskId,step.id,error.message);
          return this._event(task);
        }
      }
      return this._event(task);
    } finally {this.active.delete(taskId);this.activeSessions.delete(task.context.sessionId);}
  }
  async rebind({taskId,sessionId,pageId}) {
    if(this.active.has(taskId)) throw new Error('Task is executing');
    const task=this.tasks.get(taskId);
    if(!task || task.context.sessionId!==sessionId) throw new Error('Wrong task or session');
    const c=await this.sessions.context(sessionId);
    const page=await c.tabs.inspect(pageId);
    this.tasks.updateContext(taskId,{pageId,url:page.url});
    return this.tasks.get(taskId);
  }
}
