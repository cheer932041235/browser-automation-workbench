import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import TaskManager from './tasks.mjs';
import { SessionManager, projectRoot } from './sessions.mjs';
import { WorkflowRunner } from './workflows.mjs';
const dir=path.join(projectRoot,'work/task-state-test');
test('bound task transitions persist order and cannot erase an existing task',()=>{
  fs.mkdirSync(dir,{recursive:true});const tasks=new TaskManager({dir});
  try {
    const task=tasks.create('ordered',{name:'ordered',context:{sessionId:'alice'},steps:[{id:'first'},{id:'second'}]});
    assert.equal(task.status,'preparing');assert.throws(()=>tasks.stepStart('ordered','second'),/not ready/);
    assert.throws(()=>tasks.stepDone('ordered','first'),/running/);
    tasks.stepStart('ordered','first');assert.equal(new TaskManager({dir}).getNextStep('ordered').id,'first');
    tasks.stepDone('ordered','first',{actual:'result'});tasks.stepStart('ordered','second');tasks.stepFail('ordered','second','observed failure');
    assert.equal(tasks.get('ordered').status,'failed');
    assert.throws(()=>tasks.create('ordered',{steps:[]}),/already exists/);
    assert.deepEqual(tasks.get('ordered').steps[0].result,{actual:'result'});
  } finally {tasks.delete('ordered');fs.rmdirSync(dir);}
});
test('task IDs cannot escape the configured task directory',()=>{
  fs.mkdirSync(dir,{recursive:true});const tasks=new TaskManager({dir});
  try {assert.throws(()=>tasks.get('../outside'),/Invalid task ID/);}finally{fs.rmdirSync(dir);}
});
test('legacy task creation keeps its existing initial state',()=>{
  const tasks=new TaskManager({dir});
  try {assert.equal(tasks.create('legacy',{steps:[{id:'one'}]}).status,'created');}finally{tasks.delete('legacy');fs.rmdirSync(dir);}
});
test('managed data roots use the supplied directory and readable session IDs reject paths',()=>{
  const manager=new SessionManager({root:dir});
  try {assert.equal(manager.root,path.resolve(dir));assert.throws(()=>manager.create({id:'../profile'}),/ID must/);}finally{fs.rmdirSync(dir);}
});
test('idle background session sleeps after timeout, preserves pages, and auto-wakes while manual close stays closed',async()=>{
  const idleRoot=path.join(projectRoot,'work/idle-unit-1');
  let nowMs=1_000_000;
  const manager=new SessionManager({root:idleRoot,idleTimeoutMs:1_000,now:()=>nowMs});
  try {
    manager.create({id:'idle-one'});
    const sent=[];
    const ctx={
      session:manager.get('idle-one'),
      cdp:{connected:true,send:async m=>{sent.push(m);ctx.cdp.connected=false;},ws:{addEventListener:()=>{}}},
      tabs:{listAll:async()=>[{url:'https://example.com/saved'},{url:'about:blank'}]},
      network:{getDownloadStatus:()=>({inProgress:0})},
      exitPromise:Promise.resolve(),
      lastActiveAt:nowMs,
    };
    manager.contexts.set('idle-one',ctx);
    manager.update('idle-one',{state:'running',pid:424242});
    nowMs+=500;
    assert.deepEqual(await manager.reapIdle(),[]);
    nowMs+=600;
    assert.deepEqual(await manager.reapIdle(),['idle-one']);
    assert.deepEqual(sent,['Browser.close']);
    assert.equal(manager.contexts.has('idle-one'),false);
    const slept=manager.get('idle-one');
    assert.equal(slept.state,'closed');
    assert.equal(slept.pid,null);
    assert.equal(slept.idleClosed,true);
    assert.deepEqual(slept.pages,['https://example.com/saved']);
    const woke=[];
    const wokenCtx={session:slept,cdp:{connected:true},lastActiveAt:nowMs};
    manager.start=async id=>{woke.push(id);return wokenCtx;};
    assert.equal(await manager.context('idle-one'),wokenCtx);
    assert.deepEqual(woke,['idle-one']);
    assert.deepEqual(await manager.close('idle-one'),{id:'idle-one',state:'closed'});
    assert.equal(manager.get('idle-one').idleClosed,false);
    await assert.rejects(()=>manager.context('idle-one'),{code:'SESSION_DISCONNECTED'});
  } finally {fs.rmSync(idleRoot,{recursive:true,force:true});}
});
test('reapIdle protects attached, human, waiting_human, busy tasks, and active downloads and refreshes busy timers',async()=>{
  const idleRoot=path.join(projectRoot,'work/idle-unit-2');
  let nowMs=1_000_000;
  const manager=new SessionManager({root:idleRoot,idleTimeoutMs:1_000,now:()=>nowMs});
  const stubCtx=(s,inProgress=0)=>{
    const c={
      session:s,
      cdp:{connected:true,send:async()=>{c.cdp.connected=false;},ws:{close:()=>{c.cdp.connected=false;},addEventListener:()=>{}}},
      tabs:{listAll:async()=>[{url:'https://example.com/'+s.id}]},
      network:{getDownloadStatus:()=>({inProgress})},
      exitPromise:Promise.resolve(),
      lastActiveAt:nowMs,
    };
    return c;
  };
  try {
    const a=manager.attach({id:'att-1',allowedUrls:['https://example.com/']});
    manager.contexts.set('att-1',stubCtx(a));
    manager.update('att-1',{state:'connected'});
    for (const id of ['human-exec','waiting-human','busy-task','downloading']) manager.create({id});
    manager.contexts.set('human-exec',stubCtx(manager.update('human-exec',{state:'running',execution:'human'})));
    manager.contexts.set('waiting-human',stubCtx(manager.update('waiting-human',{state:'waiting_human',needsHuman:{reason:'login',url:'https://example.com/login'}})));
    manager.contexts.set('busy-task',stubCtx(manager.update('busy-task',{state:'running'})));
    let dlActive=1;
    manager.contexts.set('downloading',stubCtx(manager.update('downloading',{state:'running'})));
    manager.contexts.get('downloading').network={getDownloadStatus:()=>({inProgress:dlActive})};
    let busy=true;
    nowMs=2_500_000;
    assert.deepEqual(await manager.reapIdle({isBusy:id=>busy&&id==='busy-task'}),[]);
    assert.equal(manager.contexts.get('busy-task').lastActiveAt,nowMs);
    assert.equal(manager.contexts.get('downloading').lastActiveAt,nowMs);
    busy=false;dlActive=0;nowMs+=500;
    assert.deepEqual(await manager.reapIdle({isBusy:()=>false}),[]);
    nowMs+=1_000;
    assert.deepEqual(await manager.reapIdle({isBusy:()=>false}),['busy-task','downloading']);
    assert.equal(manager.contexts.has('att-1'),true);
    assert.equal(manager.contexts.has('human-exec'),true);
    assert.equal(manager.contexts.has('waiting-human'),true);
  } finally {fs.rmSync(idleRoot,{recursive:true,force:true});}
});
test('_reconcileStale cleans dead-PID running managed sessions while preserving waiting_human and live PIDs',()=>{
  const staleRoot=path.join(projectRoot,'work/idle-unit-3');
  fs.mkdirSync(staleRoot,{recursive:true});
  try {
    fs.writeFileSync(path.join(staleRoot,'sessions.json'),JSON.stringify([
      {id:'dead-run',mode:'managed',state:'running',pid:9999999},
      {id:'dead-wait',mode:'managed',state:'waiting_human',pid:9999998,needsHuman:{reason:'login',url:'https://example.com'}},
      {id:'live-run',mode:'managed',state:'running',pid:process.pid},
    ],null,2));
    const manager=new SessionManager({root:staleRoot});
    assert.equal(manager.get('dead-run').state,'closed');
    assert.equal(manager.get('dead-run').pid,null);
    assert.equal(manager.get('dead-wait').state,'waiting_human');
    assert.equal(manager.get('live-run').state,'running');
    assert.equal(manager.get('live-run').pid,process.pid);
  } finally {fs.rmSync(staleRoot,{recursive:true,force:true});}
});

test('sensitive fill steps redact persisted task JSON while passing real values to browser',async()=>{
  const secRoot=path.join(projectRoot,'work/sensitive-fill-test');
  const manager=new SessionManager({root:secRoot});
  const runner=new WorkflowRunner(manager);
  const filled=[];
  try {
    manager.create({id:'sec-sess',allowedUrls:['https://example.com/']});
    const fakeCtx={
      session:manager.get('sec-sess'),
      cdp:{connected:true},
      tabs:{inspect:async id=>({targetId:id,url:'https://example.com/'})},
      interact:{fill:async(target,sel,val,opts)=>{filled.push({target,sel,val,opts});return {filled:true,tag:'TEXTAREA',value:opts?.sensitive?'[REDACTED]':val};}},
      frames:{resolveFrameId:async()=>null},
    };
    manager.contexts.set('sec-sess',fakeCtx);
    manager.checkIdentity=async()=>{};
    runner.create({
      id:'sec-create-task',
      sessionId:'sec-sess',
      project:projectRoot,
      pageId:'p1',
      url:'https://example.com/',
      steps:[{id:'k1',action:'fill',selector:'#key',value:'TOP-SECRET-KEY-123',sensitive:true}],
    });
    const persisted1=fs.readFileSync(path.join(secRoot,'tasks/sec-create-task.json'),'utf8');
    assert.equal(persisted1.includes('TOP-SECRET-KEY-123'),false);
    assert.equal(persisted1.includes('[REDACTED]'),true);
    const done1=await runner.run({taskId:'sec-create-task'});
    assert.equal(done1.status,'completed');
    assert.equal(done1.steps[0].result.value,'[REDACTED]');
    assert.equal(filled[0].val,'TOP-SECRET-KEY-123');

    runner.create({
      id:'sec-runtime-task',
      sessionId:'sec-sess',
      project:projectRoot,
      pageId:'p1',
      url:'https://example.com/',
      steps:[{id:'k2',action:'fill',selector:'#key2',sensitive:true}],
    });
    await assert.rejects(()=>runner.run({taskId:'sec-runtime-task'}),{code:'SENSITIVE_VALUE_REQUIRED',outcome:'not_sent'});
    assert.equal(runner.tasks.get('sec-runtime-task').steps[0].status,'pending');
    const done2=await runner.run({taskId:'sec-runtime-task',values:{k2:'RUNTIME-SECRET-456'}});
    assert.equal(done2.status,'completed');
    assert.equal(filled[1].val,'RUNTIME-SECRET-456');
    const persisted2=fs.readFileSync(path.join(secRoot,'tasks/sec-runtime-task.json'),'utf8');
    assert.equal(persisted2.includes('RUNTIME-SECRET-456'),false);
  } finally {fs.rmSync(secRoot,{recursive:true,force:true});}
});

test('SessionManager and TaskManager statSync caches invalidate on external edits',()=>{
  const cacheRoot=path.join(projectRoot,'work/cache-stat-test');
  const manager=new SessionManager({root:cacheRoot});
  const tasks=new TaskManager({dir:path.join(cacheRoot,'tasks')});
  try {
    manager.create({id:'c1',label:'Before'});
    assert.equal(manager.get('c1').label,'Before');
    assert.equal(manager.get('c1').label,'Before');
    const regPath=path.join(cacheRoot,'sessions.json');
    const regData=JSON.parse(fs.readFileSync(regPath,'utf8'));
    regData[0].label='After External Edit';
    fs.writeFileSync(regPath,JSON.stringify(regData,null,2));
    assert.equal(manager.get('c1').label,'After External Edit');

    tasks.create('t1',{name:'Orig',steps:[{id:'s1'}]});
    assert.equal(tasks.get('t1').name,'Orig');
    const taskPath=path.join(cacheRoot,'tasks/t1.json');
    const taskData=JSON.parse(fs.readFileSync(taskPath,'utf8'));
    taskData.name='Updated Externally';
    fs.writeFileSync(taskPath,JSON.stringify(taskData,null,2));
    assert.equal(tasks.get('t1').name,'Updated Externally');
  } finally {fs.rmSync(cacheRoot,{recursive:true,force:true});}
});
