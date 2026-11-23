import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SessionManager, ScopedTabs, projectRoot } from './sessions.mjs';
import FrameManager, {displayFrameUrl} from './frames.mjs';
import CDPConnection from './core.mjs';

test('frame display removes Kaggle session material from query and signed path',()=>{
  assert.equal(displayFrameUrl('https://editor.example/index.html?session=sample'),'https://editor.example/index.html');
  assert.equal(displayFrameUrl('https://www.kaggleusercontent.com/kf/123/demo-session-material/__results__.html'),'https://www.kaggleusercontent.com/kf/123/[session]/__results__.html');
});

test('attached pages reject unrelated targets and URLs before changing a page',async()=>{
  const sent=[];
  const cdp={browser:'chrome',send:async(method)=>{sent.push(method);return {result:{targetInfos:[{type:'page',targetId:'aux',url:'https://example.com/aux'},{type:'page',targetId:'other',url:'https://example.com/main'}]}};}};
  const tabs=new ScopedTabs(cdp,['https://example.com/aux']);
  assert.deepEqual((await tabs.listAll()).map(p=>p.targetId),['aux']);
  await assert.rejects(()=>tabs.requirePage('other'),{code:'PAGE_NOT_FOUND'});
  await assert.rejects(()=>tabs.create('https://example.com/main'),/outside/);
  assert.ok(sent.every(m=>m==='Target.getTargets'));
});
test('disconnecting an attached session never closes its browser',async()=>{
  const root=path.join(projectRoot,'work/attached-session-test');const manager=new SessionManager({root});
  try {
    manager.attach({id:'aux',allowedUrls:['https://example.com/aux']});
    let disconnected=false;
    manager.contexts.set('aux',{session:manager.get('aux'),cdp:{connected:true,ws:{close:()=>disconnected=true},send:()=>{throw new Error('Must not send Browser.close');}}});
    assert.equal((await manager.close('aux')).browserClosed,false);assert.equal(disconnected,true);
  } finally {fs.unlinkSync(path.join(root,'sessions.json'));fs.rmdirSync(root);}
});
test('visible identity is checked on the explicitly bound identity page',async()=>{
  const root=path.join(projectRoot,'work/attached-identity-test');const manager=new SessionManager({root});
  try {
    let target,match=true;
    const context={session:{identity:{pageId:'identity',selector:'#account',attribute:'aria-label',value:'aux'}},cdp:{send:async()=>({result:{targetInfos:[{targetId:'identity',type:'page'}]}}),sendToTarget:async(t)=>{target=t;return {result:{result:{value:match}}};}}};
    await manager.checkIdentity(context,'editor');assert.equal(target,'identity');match=false;
    await assert.rejects(()=>manager.checkIdentity(context,'editor'),{code:'IDENTITY_MISMATCH'});
  } finally {fs.rmdirSync(root);}
});
test('iframe file upload uses its own execution context and target',async()=>{
  const calls=[];
  const cdp={sendToTarget:async(target,method,params)=>{calls.push({target,method,params});if(method==='Page.createIsolatedWorld')return {result:{executionContextId:77}};if(method==='Runtime.evaluate')return {result:{result:{objectId:'input-object'}}};return {result:{}};}};
  const frames=new FrameManager(cdp);frames.getFrameTree=async()=>[{frameId:'frame',ownerTargetId:'iframe-target'}];
  await frames.uploadInFrame('page','frame','input[type=file]',['E:/controlled/input.ipynb']);
  assert.ok(calls.every(c=>c.target==='iframe-target'));
  assert.equal(calls.find(c=>c.method==='Runtime.evaluate').params.contextId,77);
  assert.deepEqual(calls.find(c=>c.method==='DOM.setFileInputFiles').params,{objectId:'input-object',files:['E:/controlled/input.ipynb']});
});

test('attached session auto-reconnects after unexpected drop unless manually closed',async()=>{
  const root=path.join(projectRoot,'work/attached-reconnect-test');
  const manager=new SessionManager({root});
  try {
    manager.attach({id:'att-rec',allowedUrls:['https://example.com/']});
    await assert.rejects(()=>manager.context('att-rec'),{code:'SESSION_DISCONNECTED'});
    manager.update('att-rec',{state:'disconnected',everConnected:true,manualDisconnect:false});
    const starts=[];
    const fakeCtx={session:manager.get('att-rec'),cdp:{connected:true,ws:{close:()=>{}}},lastActiveAt:Date.now()};
    manager.start=async id=>{starts.push(id);return fakeCtx;};
    assert.equal(await manager.context('att-rec'),fakeCtx);
    assert.deepEqual(starts,['att-rec']);
    manager.contexts.set('att-rec',fakeCtx);
    await manager.close('att-rec');
    assert.equal(manager.get('att-rec').manualDisconnect,true);
    await assert.rejects(()=>manager.context('att-rec'),{code:'SESSION_DISCONNECTED'});
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('sendToTarget clears stale target session when CDP reports missing session',async()=>{
  const cdp=new CDPConnection({browser:'chrome'});
  cdp.sessions.set('dead-page','stale-sid');
  cdp.send=async()=>{throw new Error('CDP -32001: Session with given id not found.');};
  await assert.rejects(()=>cdp.sendToTarget('dead-page','Runtime.evaluate',{expression:'1'}),err=>err.outcome==='not_sent');
  assert.equal(cdp.sessions.has('dead-page'),false);
});
