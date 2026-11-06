import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {scryptSync} from 'node:crypto';
import {growthStats as serverGrowth,defaultIsland} from '../island-store.mjs';
import {growthStats,growthBreakdown,growthRecords,GROWTH_RULES} from '../public/rqly/growth-core.mjs';
const post=(slug,kind,extra={})=>({slug,kind,title:'合成 '+slug,date:'2026-11-06',topic:'记录',body:'合成正文',published:true,...extra});
const posts=[post('note','note'),post('blog','blog'),post('legacy',undefined),post('active','project',{topic:'工程',project:{status:'active'}}),post('done','project',{project:{status:'done'}}),post('private','project',{published:false,project:{status:'done'},title:'PRIVATE SECRET'}),post('trash','blog',{trashedAt:'2026-11-06T00:00:00Z'})];
let groups=0;
assert.equal(serverGrowth,growthStats);assert(Object.isFrozen(GROWTH_RULES)&&GROWTH_RULES.every(Object.isFrozen));groups++;
const island=defaultIsland(),stats=growthStats(posts,island);assert.deepEqual(stats,{notes:1,blogs:2,projects:2,completed:1,score:27,threshold:30,remaining:3,eligible:false,unlocked:false,stage:1});groups++;
const rows=growthBreakdown(stats);assert.equal(rows.reduce((sum,r)=>sum+r.score,0),27);assert.equal(rows.find(r=>r.id==='projects').score,10);assert.equal(rows.find(r=>r.id==='completed').score,10);groups++;
assert.equal(growthStats(posts,{growth:{threshold:27}}).eligible,true);assert.equal(growthStats(posts,{growth:{threshold:27}}).remaining,0);assert.equal(growthStats(posts,{growth:{threshold:10000}}).remaining,9973);groups++;
assert.deepEqual(growthStats(posts.map(p=>({...p,body:'新的正文',updatedAt:'2026-11-06T01:00:00Z'})),island),stats);groups++;
assert.equal(growthStats([],{phase:'grown',growth:{threshold:30,unlocked:false}}).unlocked,true);const kept=growthStats([],{phase:'initial',growth:{threshold:30,unlocked:true}});assert.equal(kept.unlocked,true);assert.equal(kept.eligible,false);assert.equal(kept.stage,1);groups++;
const trail=growthRecords(posts);assert.equal(trail.length,5);assert.equal(trail.find(p=>p.slug==='done').points,15);assert(!JSON.stringify(trail).includes('PRIVATE SECRET'));assert(!JSON.stringify(trail).includes('合成正文'));assert.equal(growthRecords(posts,2).length,2);assert.equal(growthRecords(posts,0).length,0);groups++;
assert.equal(growthRecords([post('invalid\n','blog')]).length,0);assert.equal(growthRecords([post('explore','note',{topic:'探索'})])[0].topic,'探索');groups++;

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ly-growth-'));let server;
try{
 fs.writeFileSync(path.join(tmp,'posts.json'),JSON.stringify(posts),{mode:0o600});fs.writeFileSync(path.join(tmp,'island.json'),JSON.stringify(island),{mode:0o600});
 Object.assign(process.env,{DATA_DIR:tmp,NODE_ENV:'test',ADMIN_USERNAME:'ly',ADMIN_PASSWORD_HASH:'scrypt:growth:'+scryptSync('fixture-password','growth',64).toString('hex')});
 const {handler,initializeData}=await import('../server.mjs');initializeData();server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const before=fs.readFileSync(path.join(tmp,'island.json')),originalPosts=fs.readFileSync(path.join(tmp,'posts.json'));
 for(const route of ['/?preview=growth','/growth-core.mjs','/api/island'])assert.equal((await fetch(base+route)).status,200,route);
 assert.deepEqual(fs.readFileSync(path.join(tmp,'island.json')),before);assert.deepEqual(fs.readFileSync(path.join(tmp,'posts.json')),originalPosts);assert.deepEqual((await(await fetch(base+'/api/island')).json()).stats,stats);assert.equal((await fetch(base+'/qizui/growth-core.mjs')).status,404);groups++;
 const headers={'Content-Type':'application/json',Origin:base,'X-Requested-With':'rqly-editor'};const login=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({username:'ly',password:'fixture-password'})});assert.equal(login.status,200);headers.Cookie=login.headers.get('set-cookie').split(';')[0];headers['X-CSRF-Token']=(await login.json()).csrfToken;
 const get=()=>fetch(base+'/api/admin/island',{headers}).then(r=>r.json());const save=(state)=>fetch(base+'/api/admin/island',{method:'PUT',headers,body:JSON.stringify({baseRevision:state.revision,island:state})});
 const state=(await get()).island;state.phase='grown';state.growth.unlocked=true;assert.equal((await save(state)).status,409);assert.deepEqual(fs.readFileSync(path.join(tmp,'island.json')),before);groups++;
 state.phase='initial';let response=await save(state);assert.equal(response.status,200);assert.equal((await response.json()).island.growth.unlocked,false);groups++;
 const admin=await fetch(base+'/admin',{headers});const html=await admin.text();assert(html.includes('href="/?preview=growth" target="_blank" rel="noopener noreferrer"'));assert(html.includes('admin-growth-breakdown'));groups++;
 console.log(groups+' growth groups passed: shared scoring, exact bonus/thresholds, withdrawal/unlock retention, safe public records, no GET writes, preview cannot unlock, and owner preview link.');
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}fs.rmSync(tmp,{recursive:true,force:true});}
