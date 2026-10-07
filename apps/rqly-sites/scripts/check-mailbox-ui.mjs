import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.dataset={};this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.classList={toggle(){}};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(){}
 addEventListener(name,handler){this.listeners[name]=handler;}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
get('mailbox-workspace').hidden=true;get('mailbox-filter').value='archived';let observe,confirmed=false,removed=false;const requests=[];
const message={id:'a'.repeat(32),revision:4,kind:'letter',name:'fixture',title:'private fixture',body:'isolated UI fixture',contact:'',createdAt:'2026-10-07T00:00:00Z',reply:'',read:true,archived:true,status:'private'};
const context={document:{getElementById:get,createElement:tag=>new Element(tag)},MutationObserver:class{constructor(callback){observe=callback;}observe(){}},confirm:()=>confirmed,fetch:async(route,options={})=>{
 requests.push({route,options});
 if(route==='/api/auth/session')return {json:async()=>({authenticated:true,csrfToken:'fixture-csrf'})};
 if(options.method==='DELETE'){
  assert.equal(route,'/api/admin/mailbox/'+message.id);assert.equal(options.headers['X-CSRF-Token'],'fixture-csrf');assert.deepEqual(JSON.parse(options.body),{revision:4,confirm:true});removed=true;return {ok:true,json:async()=>({removed:true})};
 }
 assert(route.startsWith('/api/admin/mailbox?'));return {ok:true,json:async()=>({messages:removed?[]:[message],nextOffset:null,stats:{unread:0,pending:0,letters:0,storage:{used:removed?0:1,limit:5000,archived:removed?0:1,nearFull:false},daily:{used:1,limit:100,remaining:99}}})};
}};
vm.runInNewContext(fs.readFileSync(new URL('../public/rqly/admin-mailbox.js',import.meta.url),'utf8'),context);
const tick=()=>new Promise(resolve=>setImmediate(resolve));await tick();get('mailbox-workspace').hidden=false;observe();await tick();
assert(get('mailbox-capacity').textContent.includes('1 / 5000'));assert(get('mailbox-capacity').textContent.includes('1 / 100'));
const row=get('mailbox-list').children[0];await row.listeners.click();assert.equal(get('mailbox-delete').hidden,false);
await get('mailbox-delete').listeners.click();assert.equal(requests.filter(r=>r.options.method==='DELETE').length,0);assert.equal(removed,false);
confirmed=true;await get('mailbox-delete').listeners.click();assert.equal(removed,true);assert.equal(requests.filter(r=>r.options.method==='DELETE').length,1);assert.equal(get('mailbox-letter').hidden,true);assert(get('mailbox-status').textContent.includes('永久删除'));assert(get('mailbox-capacity').textContent.includes('0 / 5000'));
console.log('Mailbox UI passed: capacity display, cancel causes no deletion, confirmed archive deletion sends CSRF/revision and refreshes list/capacity.');
