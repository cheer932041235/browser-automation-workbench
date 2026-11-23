import test from 'node:test';
import assert from 'node:assert/strict';
import CDPConnection from './core.mjs';
import TabManager from './tabs.mjs';
import NetworkManager from './network.mjs';

test('a timed out page action is sent once and its outcome stays unknown', async () => {
  const cdp = new CDPConnection({browser:'chrome'});
  const sent = [];
  cdp.ws = {readyState:1, send:message=>sent.push(JSON.parse(message))};
  cdp.sessions.set('page','session');
  await assert.rejects(cdp.sendToTarget('page','Runtime.evaluate',{expression:'submitForm()'},10),
    error=>error.code==='CDP_TIMEOUT' && error.outcome==='unknown');
  assert.equal(sent.length,1);
  assert.equal(cdp.pending.size,0);
});

test('exact open does not reuse an unrelated page on the same website', async () => {
  const calls = [];
  const cdp = {send:async (method,params)=>{
    calls.push({method,params});
    if (method==='Target.getTargets') return {result:{targetInfos:[{type:'page',targetId:'home',url:'https://example.com/'}]}};
    assert.equal(method,'Target.createTarget');
    return {result:{targetId:'test-page'}};
  }};
  const tabs = new TabManager(cdp);
  tabs.waitForLoad = async()=>{};
  tabs.getInfo = async()=>({url:'https://example.com/test',title:'Test'});
  assert.deepEqual(await tabs.openExact('https://example.com/test'),{targetId:'test-page',url:'https://example.com/test',reused:false});
  assert.equal(calls.filter(x=>x.method==='Target.createTarget').length,1);
  assert.equal(calls.some(x=>x.method==='Page.navigate'),false);
});

test('closed or foreign page IDs are rejected before reading a document', async () => {
  const tabs = new TabManager({browser:'chrome',send:async()=>({result:{targetInfos:[]}}),
    sendToTarget:()=>{throw new Error('Must not read a foreign page');}});
  await assert.rejects(tabs.inspect('edge-page'),error=>error.code==='PAGE_NOT_FOUND' && error.outcome==='not_sent');
});

test('page inspection reads the live URL rather than a cached title', async () => {
  const tabs = new TabManager({browser:'chrome',connected:true,
    send:async()=>({result:{targetInfos:[{type:'page',targetId:'page',url:'https://example.com/old'}]}}),
    sendToTarget:async()=>({result:{result:{value:JSON.stringify({url:'https://example.com/current',title:'Current',ready:'complete'})}}})});
  assert.equal((await tabs.inspect('page')).url,'https://example.com/current');
});

function monitored() {
  const handlers = new Map();
  const calls = [];
  const cdp = {sendToTarget:async (...args)=>{calls.push(args);return {result:{body:'owned body'}};},
    onTarget:(method,target,handler)=>{const key=target+':'+method;handlers.set(key,handler);return handler;},
    offTarget:(method,target)=>handlers.delete(target+':'+method)};
  return {network:new NetworkManager(cdp),handlers,calls};
}

test('two monitored pages can reuse request IDs without mixing events or responses', async () => {
  const {network,handlers,calls}=monitored();
  await network.enableMonitoring('a');await network.enableMonitoring('b');
  for (const target of ['a','b']) {
    handlers.get(target+':Network.requestWillBeSent')({requestId:'same',frameId:target+'-frame',request:{url:'https://example.com/'+target,method:'GET'}});
    handlers.get(target+':Network.responseReceived')({requestId:'same',response:{status:target==='a'?200:404}});
  }
  assert.equal(network.requestLog.length,2);
  assert.equal(network.getRecentRequests({targetId:'a'})[0].status,200);
  assert.equal(network.getRecentRequests({targetId:'b'})[0].status,404);
  const count=calls.length;
  assert.equal((await network.getResponseBody('foreign','same')).code,'REQUEST_NOT_FOUND');
  assert.equal(calls.length,count);
  assert.equal((await network.getResponseBody('a','same')).body,'owned body');
  network.stopMonitoring('a');
  assert.equal(handlers.has('a:Network.requestWillBeSent'),false);
  assert.equal(handlers.has('b:Network.requestWillBeSent'),true);
});

test('failed monitor activation can be started after the connection is restored', async () => {
  const {network}=monitored();
  network.cdp.sendToTarget=async()=>{throw new Error('connection closed');};
  await assert.rejects(network.enableMonitoring('a'),/connection closed/);
  assert.equal(network._monitoringTargets.has('a'),false);
  network.cdp.sendToTarget=async()=>({result:{}});
  assert.equal((await network.enableMonitoring('a')).monitoring,true);
});
