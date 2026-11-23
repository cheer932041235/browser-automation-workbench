import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { projectRoot } from '../packages/browser-engine/sessions.mjs';
const [browser='edge',url]=process.argv.slice(2);
if(!['edge','chrome'].includes(browser)||!url||!/^https?:\/\//.test(url))throw new Error('Usage: node scripts/verify-existing.mjs <edge|chrome> <exact-authorized-page-url>');
const cases=[[browser,url]];
const result=[];
for(const [browser,url] of cases) {
  const base='http://127.0.0.1:3456';
  const health=await(await fetch(`${base}/health?browser=${browser}`)).json();assert.equal(health.connected,true);
  const tabs=await(await fetch(`${base}/tabs?browser=${browser}`)).json();const page=tabs.find(p=>p.url===url);assert.ok(page,'Expected authorized page is not open');
  const info=await(await fetch(`${base}/tabs/info?browser=${browser}&target=${page.targetId}`)).json();assert.equal(info.url,url);
  result.push({browser,url,readable:true,title:info.title});
}
await fs.mkdir(path.join(projectRoot,'outputs/existing-browser-acceptance'),{recursive:true});
await fs.writeFile(path.join(projectRoot,'outputs/existing-browser-acceptance/result.json'),JSON.stringify({passed:true,scope:'Read-only regression through the unchanged 3456 service',pages:result},null,2));
console.log(JSON.stringify({passed:true,pages:result},null,2));
