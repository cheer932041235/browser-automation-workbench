import fs from 'node:fs';
import path from 'node:path';
import TabManager from './tabs.mjs';
import { urlMatchesScope } from './browsers.mjs';

export async function desktopControl(session,action,data={}) {
  const {port}=JSON.parse(fs.readFileSync(path.join(session.profile,'desktop-control.json'),'utf8'));
  const response=await fetch(`http://127.0.0.1:${port}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error);
  return result;
}

export class DesktopTabs extends TabManager {
  constructor(cdp,session){super(cdp);this.session=session;}
  allows(url){if(!/^https?:\/\//.test(url||''))return false;return !this.session.allowedUrls?.length||this.session.allowedUrls.some(a=>urlMatchesScope(a,url));}
  async listAll(){const {pages}=await desktopControl(this.session,'state');return pages.filter(p=>this.allows(p.url));}
  async create(url){if(!this.allows(url))throw new Error('URL is outside this desktop session scope');return (await desktopControl(this.session,'open',{url})).targetId;}
  async navigate(id,url){await this.requirePage(id);if(!this.allows(url))throw new Error('URL is outside this desktop session scope');return super.navigate(id,url);}
  async close(id){await this.requirePage(id);return desktopControl(this.session,'tab-close',{pageId:id});}
}
