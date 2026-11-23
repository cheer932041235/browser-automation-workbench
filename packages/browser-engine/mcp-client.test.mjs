import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('stdio MCP initializes and lists tools with PowerShell UTF-8 BOM input without a backend',()=>{
  const input='\uFEFF'+JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n';
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('./workbench-client.mjs',import.meta.url)),'--mcp'],{input,encoding:'utf8',env:{...process.env,BROWSER_WORKBENCH_URL:'http://127.0.0.1:1'},windowsHide:true,timeout:10000});
  assert.equal(run.status,0,run.stderr);
  const replies=run.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(replies[0].result.serverInfo.name,'browser-workbench');
  assert.ok(replies[1].result.tools.some(tool=>tool.name==='browser_task_run'));
});
