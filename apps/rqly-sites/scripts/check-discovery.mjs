import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {scryptSync} from 'node:crypto';
import {defaultIsland,createIslandStore,validateIsland,publicIsland} from '../island-store.mjs';
import {roomRecords,recommendedRecords,readingPositions,resumableRecord,relatedRecords,recordRoom,readingHref,validRecordSlug} from '../public/rqly/island-content.mjs';

let groups=0;
const record=(slug,extra={})=>({slug,title:'公开 '+slug,summary:'合成验证记录',date:'2026-11-06',kind:'blog',topic:'记录',published:true,body:'## 线索\n合成正文',...extra});
const posts=[record('recent'),record('older'),record('engineering',{topic:'工程'}),record('project',{kind:'project',topic:'工程',project:{status:'active'}}),record('explore',{topic:'探索'}),record('private',{published:false,title:'PRIVATE TITLE'}),record('trashed',{trashedAt:'2026-11-06T00:00:00Z'})];
assert.equal(roomRecords(posts,'library').length,4);assert.equal(roomRecords(posts,'projects').length,2);assert.equal(roomRecords(posts,'workshop').length,1);groups++;
for(const slug of ['ok\n','ok\r','-bad','bad-','bad--slug','javascript:alert(1)','../private','__proto__','x'.repeat(81),'中文'])assert.equal(validRecordSlug(slug),false,JSON.stringify(slug));groups++;
const state=defaultIsland();state.buildings.library.featuredSlugs=['older'];let selected=recommendedRecords(posts,state,'library');assert.equal(selected.curated,true);assert.deepEqual(selected.recommendations.map(p=>p.slug),['older']);
state.buildings.library.featuredSlugs=['private','trashed'];selected=recommendedRecords(posts,state,'library');assert.equal(selected.curated,false);assert.deepEqual(selected.recommendations.map(p=>p.slug),['recent','older']);assert.deepEqual(publicIsland(state,posts).buildings.library.featuredSlugs,[]);groups++;
for(const featuredSlugs of [['recent','recent'],['a','b','c'],['bad\n'],'recent',[null]])assert.throws(()=>validateIsland({...state,buildings:{...state.buildings,library:{...state.buildings.library,featuredSlugs}}}));groups++;
const now=Date.now(),positions={private:{ratio:.3,updated:now},trashed:{ratio:.4,updated:now-1},recent:{ratio:1,updated:now-2},older:{ratio:.42,updated:now-3,room:'workshop'},engineering:{ratio:0,updated:now-4}};
let resume=resumableRecord(posts,positions);assert.equal(resume.post.slug,'older');assert.equal(resume.room,'library');assert.equal(readingHref(resume.post,resume.room),'#room=library&article=older');assert.equal(recordRoom(posts[3],'library'),'projects');groups++;
const bad=JSON.parse('{"__proto__":{"ratio":0.3,"updated":1},"recent":{"ratio":"0.4","updated":1}}');assert.deepEqual(readingPositions(bad),{});assert.deepEqual(readingPositions([]),{});assert.deepEqual(readingPositions({recent:{ratio:NaN,updated:now},older:{ratio:2,updated:now},private:{ratio:.2,updated:now+10000000}}),{});assert.equal(Object.keys(readingPositions(Object.fromEntries(Array.from({length:60},(_,i)=>['entry-'+i,{ratio:.5,updated:now-i}])))).length,40);groups++;
assert.equal(resumableRecord([posts[5]],positions),null);assert.equal(resumableRecord(posts,{recent:{ratio:.99,updated:now},older:{ratio:.98,updated:now}}),null);groups++;
const related=relatedRecords(record('self',{organization:{series:'series-1',topics:['topic-1'],tags:['tag-1']}}),[record('same-topic'),record('tag',{organization:{tags:['tag-1']}}),record('series',{organization:{series:'series-1'}}),record('self'),record('secret',{published:false,organization:{series:'series-1'}})]);
assert.deepEqual(related.map(p=>p.slug),['series','tag','same-topic']);assert.equal(relatedRecords(record('self',{topic:'探索'}),[record('other')]).length,0);groups++;

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ly-discovery-'));let server;
try{
 const old=defaultIsland(),oldBytes=JSON.stringify(old);fs.writeFileSync(path.join(tmp,'island.json'),oldBytes,{mode:0o600});const store=createIslandStore(tmp);store.initialize();let island=store.read();assert.deepEqual(island.buildings.library.featuredSlugs,[]);assert.equal(fs.readFileSync(path.join(tmp,'island.json'),'utf8'),oldBytes);groups++;
 island.buildings.library.featuredSlugs=['older'];island=store.save(island,0,{posts});assert.equal(store.read().buildings.library.featuredSlugs[0],'older');assert.equal(fs.statSync(path.join(tmp,'island.json')).mode&0o777,0o600);assert.throws(()=>store.save(island,0,{posts}),e=>e.status===409);groups++;
 for(const [room,slug] of [['library','private'],['library','trashed'],['library','project'],['projects','recent']]){const next=structuredClone(island);next.buildings[room].featuredSlugs=[slug];const before=fs.readFileSync(path.join(tmp,'island.json'));assert.throws(()=>store.save(next,island.revision,{posts}),e=>e.status===400);assert.deepEqual(fs.readFileSync(path.join(tmp,'island.json')),before);}groups++;
 const withdrawn=posts.map(p=>p.slug==='older'?{...p,published:false}:p);assert.deepEqual(publicIsland(store.read(),withdrawn).buildings.library.featuredSlugs,[]);island.description='无关修改不受旧精选下线影响';island=store.save(island,island.revision,{posts:withdrawn});assert.equal(island.buildings.library.featuredSlugs[0],'older');groups++;

 // Real HTTP handlers, isolated data and a synthetic owner. Never uses live paths.
 fs.rmSync(path.join(tmp,'island.json'));Object.assign(process.env,{DATA_DIR:tmp,NODE_ENV:'test',ADMIN_USERNAME:'ly',ADMIN_PASSWORD_HASH:'scrypt:discovery:'+scryptSync('fixture-password','discovery',64).toString('hex')});
 const {handler,initializeData}=await import('../server.mjs');initializeData();server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const headers={'Content-Type':'application/json',Origin:base,'X-Requested-With':'rqly-editor'};
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({username:'ly',password:'fixture-password'})});assert.equal(login.status,200);headers.Cookie=login.headers.get('set-cookie').split(';')[0];headers['X-CSRF-Token']=(await login.json()).csrfToken;
 const request=(route,method='GET',body,extra={})=>fetch(base+route,{method,headers:{...headers,...extra},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await fetch(base+'/api/admin/island')).status,401);assert.equal((await fetch(base+'/island-content.mjs')).status,200);assert.equal((await fetch(base+'/qizui/island-content.mjs')).status,404);groups++;
 let response=await request('/api/admin/posts','POST',record('curated-note'));assert.equal(response.status,200);let post=(await response.json()).post;
 response=await request('/api/admin/island');island=(await response.json()).island;island.buildings.library.featuredSlugs=[post.slug];
 assert.equal((await request('/api/admin/island','PUT',{baseRevision:island.revision,island},{'X-CSRF-Token':''})).status,403);
 assert.equal((await request('/api/admin/island','PUT',{baseRevision:island.revision,island},{Origin:'https://evil.invalid'})).status,403);groups++;
 response=await request('/api/admin/island','PUT',{baseRevision:island.revision,island});assert.equal(response.status,200);island=(await response.json()).island;
 let visible=await(await fetch(base+'/api/island')).json();assert.deepEqual(visible.island.buildings.library.featuredSlugs,[post.slug]);assert(!JSON.stringify(visible).includes('passwordHash'));groups++;
 response=await request('/api/admin/posts','PUT',{...post,published:false},{'If-Match':post.revision});assert.equal(response.status,200);
 visible=await(await fetch(base+'/api/island')).json();assert.deepEqual(visible.island.buildings.library.featuredSlugs,[]);assert(!JSON.stringify(visible).includes('curated-note'));assert.equal((await fetch(base+'/api/posts/curated-note')).status,404);
 assert.deepEqual((await(await request('/api/admin/island')).json()).island.buildings.library.featuredSlugs,[post.slug]);groups++;
 const stale=(await(await request('/api/admin/island')).json()).island;stale.title='精选撤回后的岛屿';assert.equal((await request('/api/admin/island','PUT',{baseRevision:stale.revision,island:stale})).status,200);
 const current=(await(await request('/api/admin/island')).json()).island;current.buildings.library.featuredSlugs=['private-never-published'];const before=fs.readFileSync(path.join(tmp,'island.json'));assert.equal((await request('/api/admin/island','PUT',{baseRevision:current.revision,island:current})).status,400);assert.deepEqual(fs.readFileSync(path.join(tmp,'island.json')),before);groups++;
 console.log(groups+' discovery groups passed: shared scopes, curated order/fallback/privacy, strict slugs/limits, legacy no-rewrite persistence, revision/CSRF/origin controls, withdrawal safety, bounded local progress and related records.');
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}fs.rmSync(tmp,{recursive:true,force:true});}
