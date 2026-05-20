#!/usr/bin/env node
// Browser Engine CLI - 快捷命令行工具
// Usage: node be.mjs <command> [args...]
// Examples:
//   node be.mjs health
//   node be.mjs tabs
//   node be.mjs new https://www.bing.com
//   node be.mjs info <targetId>
//   node be.mjs click <targetId> "#submit"
//   node be.mjs fill <targetId> "#search" "hello"
//   node be.mjs key <targetId> Enter
//   node be.mjs shot <targetId> [file]
//   node be.mjs eval <targetId> "document.title"
//   node be.mjs text <targetId>
//   node be.mjs elements <targetId>
//   node be.mjs frames <targetId>
//   node be.mjs stealth <targetId>
//   node be.mjs wait <targetId> [selector]
//   node be.mjs close <targetId>
//   node be.mjs closeAll

import http from 'node:http';

const BASE = 'http://127.0.0.1:3456';
const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
  console.log(`
Browser Engine CLI
==================
  health              Check engine status
  tabs                List all tabs
  new <url>           Create new tab
  info <id>           Get tab info
  nav <id> <url>      Navigate tab
  back <id>           Go back
  close <id>          Close tab
  closeAll            Close all managed tabs

  eval <id> <js>      Execute JavaScript
  click <id> <sel>    Click element (CSS selector)
  clickText <id> <t>  Click by text content
  clickAt <id> <sel>  Real mouse click
  fill <id> <sel> <v> Fill input field
  key <id> <key>      Press key (Enter/Tab/Escape...)
  type <id> <text>    Type text char by char
  scroll <id> [dir]   Scroll (top/bottom/number)
  hover <id> <sel>    Hover element

  elements <id>       List interactive elements
  text <id>           Get page text content
  links <id>          Get page links
  forms <id>          Get form fields
  shot <id> [file]    Take screenshot

  frames <id>         List iframes
  feval <id> <idx> <js>  Eval in frame by index
  fclick <id> <fid> <sel>  Click in frame
  ffill <id> <fid> <sel> <val>  Fill in frame
  ftext <id> <fid>    Get frame text
  findText <id> <t>   Search text across frames

  stealth <id>        Inject anti-detection
  stealthCheck <id>   Check detection status

  wait <id> [sel]     Wait for element or page load
  waitText <id> <t>   Wait for text
  waitNet <id>        Wait for network idle
  waitStable <id>     Wait for page stable

  help                Show this help
`.trim());
  process.exit(0);
}

// --- HTTP helpers ---
function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, { timeout: 60000 }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    }).on('error', reject);
  });
}

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    const isJSON = typeof data !== 'string';
    const headers = { 'Content-Length': Buffer.byteLength(body) };
    if (isJSON) headers['Content-Type'] = 'application/json';
    const req = http.request(BASE + path, { method: 'POST', headers, timeout: 60000 }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function out(data) {
  if (typeof data === 'string') console.log(data);
  else console.log(JSON.stringify(data, null, 2));
}

// --- Resolve short target ID (first 4+ chars match) ---
async function resolveTarget(id) {
  if (!id) return null;
  if (id.length >= 20) return id; // already full ID
  try {
    const tabs = await get('/tabs');
    const match = tabs.find(t => t.targetId.startsWith(id.toUpperCase()));
    if (match) return match.targetId;
    // try case-insensitive
    const matchCI = tabs.find(t => t.targetId.toLowerCase().startsWith(id.toLowerCase()));
    if (matchCI) return matchCI.targetId;
  } catch {}
  return id; // return as-is
}

// --- Command dispatch ---
async function main() {
  try {
    switch (cmd) {
      case 'health': case 'h':
        return out(await get('/health'));

      case 'tabs': case 'ls': {
        const tabs = await get('/tabs');
        if (!Array.isArray(tabs)) return out(tabs);
        console.log(`${tabs.length} tab(s):`);
        for (const t of tabs) {
          const m = t.managed ? ' [managed]' : '';
          const g = t.group ? ` (${t.group})` : '';
          console.log(`  ${t.targetId.slice(0, 8)}  ${(t.title || '').slice(0, 50).padEnd(50)}  ${(t.url || '').slice(0, 60)}${m}${g}`);
        }
        return;
      }

      case 'new': case 'open': {
        const url = rest[0] || 'about:blank';
        return out(await get(`/tabs/new?url=${encodeURIComponent(url)}`));
      }

      case 'info': case 'i': {
        const id = await resolveTarget(rest[0]);
        return out(await get(`/tabs/info?target=${id}`));
      }

      case 'nav': case 'navigate': case 'go': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/tabs/navigate?target=${id}`, { url: rest[1] }));
      }

      case 'back': {
        const id = await resolveTarget(rest[0]);
        return out(await get(`/tabs/back?target=${id}`));
      }

      case 'close': {
        const id = await resolveTarget(rest[0]);
        return out(await get(`/tabs/close?target=${id}`));
      }

      case 'closeAll': case 'ca':
        return out(await get('/tabs/closeAll'));

      case 'eval': case 'e': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/eval?target=${id}`, rest.slice(1).join(' ')));
      }

      case 'click': case 'c': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/click?target=${id}`, rest[1]));
      }

      case 'clickText': case 'ct': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/clickByText?target=${id}`, { text: rest[1], tag: rest[2] || '' }));
      }

      case 'clickAt': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/clickAt?target=${id}`, rest[1]));
      }

      case 'fill': case 'f': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/fill?target=${id}`, { selector: rest[1], value: rest[2] }));
      }

      case 'key': case 'k': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/pressKey?target=${id}`, { key: rest[1] }));
      }

      case 'type': case 't': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/type?target=${id}`, { text: rest.slice(1).join(' ') }));
      }

      case 'scroll': case 's': {
        const id = await resolveTarget(rest[0]);
        const dir = rest[1] || 'bottom';
        const opts = isNaN(dir) ? { direction: dir } : { y: parseInt(dir) };
        return out(await post(`/scroll?target=${id}`, opts));
      }

      case 'hover': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/hover?target=${id}`, rest[1]));
      }

      case 'elements': case 'el': {
        const id = await resolveTarget(rest[0]);
        const els = await post(`/page/elements?target=${id}`, { maxItems: parseInt(rest[1]) || 30 });
        if (!Array.isArray(els)) return out(els);
        for (const el of els) {
          console.log(`  [${el.idx}] <${el.tag}${el.type ? ' type=' + el.type : ''}> "${(el.text || '').slice(0, 60)}"${el.id ? ' #' + el.id : ''}${el.selector ? ' → ' + el.selector : ''}`);
        }
        return;
      }

      case 'text': case 'txt': {
        const id = await resolveTarget(rest[0]);
        const r = await post(`/page/text?target=${id}`, { maxLength: parseInt(rest[1]) || 3000 });
        return console.log(r.text || r);
      }

      case 'links': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/page/links?target=${id}`, { filter: rest[1] || '' }));
      }

      case 'forms': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/page/forms?target=${id}`, {}));
      }

      case 'shot': case 'ss': {
        const id = await resolveTarget(rest[0]);
        const file = rest[1] || `E:/study/browser-shot-${Date.now()}.png`;
        return out(await post(`/screenshot?target=${id}`, { file }));
      }

      // --- Frames ---
      case 'frames': case 'fr': {
        const id = await resolveTarget(rest[0]);
        const fr = await get(`/frames?target=${id}`);
        if (!Array.isArray(fr)) return out(fr);
        for (const f of fr) {
          console.log(`  [${f.index}] ${' '.repeat(f.depth * 2)}${f.name || '(unnamed)'}  ${f.url.slice(0, 80)}  id=${f.frameId.slice(0, 12)}...`);
        }
        return;
      }

      case 'feval': case 'fe': {
        const id = await resolveTarget(rest[0]);
        const frameIndex = parseInt(rest[1]);
        return out(await post(`/frames/eval?target=${id}`, { frameIndex, expression: rest.slice(2).join(' ') }));
      }

      case 'fclick': case 'fc': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/frames/click?target=${id}`, { frameId: rest[1], selector: rest[2] }));
      }

      case 'ffill': case 'ff': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/frames/fill?target=${id}`, { frameId: rest[1], selector: rest[2], value: rest[3] }));
      }

      case 'ftext': case 'ft': {
        const id = await resolveTarget(rest[0]);
        const r = await post(`/frames/text?target=${id}`, { frameId: rest[1] });
        return console.log(r.text || r);
      }

      case 'findText': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/frames/findText?target=${id}`, { text: rest[1] }));
      }

      // --- Stealth ---
      case 'stealth': case 'st': {
        const id = await resolveTarget(rest[0]);
        return out(await get(`/stealth/inject?target=${id}`));
      }

      case 'stealthCheck': case 'sc': {
        const id = await resolveTarget(rest[0]);
        return out(await get(`/stealth/check?target=${id}`));
      }

      // --- Wait ---
      case 'wait': case 'w': {
        const id = await resolveTarget(rest[0]);
        if (rest[1]) {
          return out(await post(`/wait/element?target=${id}`, { selector: rest[1], timeout: parseInt(rest[2]) || 10000 }));
        }
        return out(await post(`/wait/stable?target=${id}`, {}));
      }

      case 'waitText': case 'wt': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/wait/text?target=${id}`, { text: rest[1] }));
      }

      case 'waitNet': case 'wn': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/wait/network?target=${id}`, {}));
      }

      case 'waitStable': case 'ws': {
        const id = await resolveTarget(rest[0]);
        return out(await post(`/wait/stable?target=${id}`, {}));
      }

      default:
        console.error(`Unknown command: ${cmd}\nRun: node be.mjs help`);
        process.exit(1);
    }
  } catch (e) {
    console.error('Error:', e.message);
    console.error('Is Browser Engine running? Check: node be.mjs health');
    process.exit(1);
  }
}

main();
