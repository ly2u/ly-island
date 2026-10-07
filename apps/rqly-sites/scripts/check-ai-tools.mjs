import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {createSiteToolService} from '../ai-site-tools.mjs';import {validateRecord} from '../island-store.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ly-ai-tools-'));let posts=[],writes=0;
try{
 const session={tokenHash:'test-session'},service=createSiteToolService({dataDir:dir,readPosts:()=>structuredClone(posts),writePosts:p=>{posts=structuredClone(p);writes++;},summary:()=>({published:posts.filter(p=>p.published).length})});
 let allowed=true;const h=service.toolHandler(session,()=>{if(!allowed)throw Object.assign(new Error('expired'),{status:401});});
 const draft=await h.execute('create_draft',{title:'工程笔记',body:'梁桥项目记录。'.repeat(3000),kind:'note',topic:'工程'},1);assert.equal(posts.length,1);assert.equal(posts[0].published,false);await h.execute('create_draft',{title:'重复请求',body:'x',kind:'note',topic:'工程'},1);assert.equal(posts.length,1);
 const found=await h.execute('search_content',{query:'梁桥',kind:'note',status:'draft'},2);assert.equal(found.total,1);assert.equal((await h.execute('search_content',{query:'梁桥',kind:'note',status:'published'},3)).total,0);
 const chunk=await h.execute('read_content',{slug:draft.slug,offset:0},4);assert.equal(chunk.body.length,12000);assert.equal(chunk.nextOffset,12000);
 await h.execute('prepare_publish',{slug:draft.slug},5);assert.equal(posts[0].published,false);const action=service.list(session)[0];assert.equal(service.list({tokenHash:'other'}).length,0);assert.throws(()=>service.confirm(action.id,{tokenHash:'other'}),e=>e.status===404);
 service.confirm(action.id,session);assert.equal(posts[0].published,true);const once=writes;service.confirm(action.id,session);assert.equal(writes,once);
 await h.execute('prepare_update',{slug:draft.slug,title:'修订笔记',body:'修改后的正文'},6);const update=service.list(session)[0];assert.equal(posts[0].title,'工程笔记');posts[0].body='其他页面的新版本';assert.throws(()=>service.confirm(update.id,session),e=>e.status===409);assert.equal(posts[0].body,'其他页面的新版本');
 await h.execute('prepare_update',{slug:draft.slug,title:'确认更新笔记',body:'经过确认的新正文'},9);const ready=service.list(session).at(-1);service.confirm(ready.id,session);assert.equal(posts[0].title,'确认更新笔记');assert.equal(posts[0].body,'经过确认的新正文');assert.equal(posts[0].published,true);
 await assert.rejects(h.execute('shell',{command:'anything'},7));allowed=false;await assert.rejects(h.execute('site_summary',{},8),e=>e.status===401);
 assert.equal(fs.statSync(path.join(dir,'ai-actions.json')).mode&0o777,0o600);
 console.log('Site tools passed: private draft/idempotency, search/pagination, explicit publication, owner binding, update conflicts, revoked sessions and tool allowlist.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
