import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {createHash} from 'node:crypto';
import {defaultIsland,LAYOUT_RULES,DECORATION_SLOTS} from '../island-store.mjs';
import {renderIslandHome} from '../public/rqly/presentation-core.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ly-bootstrap-'));let server;
const marker='</script><script>globalThis.__injected=true</script><img src=x onerror=alert(1)>&\u2028\u2029$&';
const shell='<!doctype html><html><head><title>Island</title></head><body><h1 data-display="headline">old</h1></body></html>';
const extract=html=>{const matches=[...html.matchAll(/<script id="island-bootstrap" type="application\/json">([\s\S]*?)<\/script>/g)];assert.equal(matches.length,1);const raw=matches[0][1];assert(!/[<>&\u2028\u2029]/.test(raw));return JSON.parse(raw);};
try{
 const raw={island:{title:marker},posts:[{title:marker}]};assert.deepEqual(extract(renderIslandHome(shell,defaultIsland(),'https://example.test',raw)),raw);
 assert.equal((renderIslandHome(shell,defaultIsland(),'https://example.test').match(/island-bootstrap/g)||[]).length,0);
 fs.mkdirSync(path.join(dir,'shell'));fs.writeFileSync(path.join(dir,'shell/index.html'),shell);
 Object.assign(process.env,{DATA_DIR:dir,ISLAND_SHELL_DIR:path.join(dir,'shell'),NODE_ENV:'test',CODEX_BRIDGE_SOCKET:'',AI_API_KEY:'',AI_MODEL:''});
 const{handler,initializeData}=await import('../server.mjs');initializeData();
 const island=defaultIsland();island.buildings.library.featuredSlugs=['public-record','private-record'];island.presentation.tools.push({name:'PRIVATE_DISABLED_TOOL',detail:'not public',url:'https://private.invalid/',tag:'hidden',enabled:false});fs.writeFileSync(path.join(dir,'island.json'),JSON.stringify(island));
 const record={slug:'public-record',title:marker,summary:marker,body:'PUBLIC_BODY_NOT_NEEDED_IN_BOOTSTRAP',topic:'记录',kind:'note',date:'2026-01-01',published:true,privateField:'PRIVATE_FIELD_MARKER'};
 fs.writeFileSync(path.join(dir,'posts.json'),JSON.stringify([record,{...record,slug:'private-record',title:'PRIVATE_DRAFT_MARKER',published:false},{...record,slug:'trashed-record',title:'PRIVATE_TRASH_MARKER',trashedAt:'2026-01-02T00:00:00Z'}]));
 const hash=()=>Object.fromEntries(fs.readdirSync(dir).filter(n=>fs.statSync(path.join(dir,n)).isFile()).map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(dir,n))).digest('hex')]));const before=hash();
 server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const response=await fetch(base+'/island-home',{headers:{'X-LY-Island-Home':'1'}});assert.equal(response.headers.get('x-island-shell-sha256'),createHash('sha256').update(shell).digest('hex'));const html=await response.text();assert.equal(response.status,200,html);const bootstrap=extract(html);
 for(const secret of['PRIVATE_DISABLED_TOOL','PRIVATE_DRAFT_MARKER','PRIVATE_TRASH_MARKER','PRIVATE_FIELD_MARKER','PUBLIC_BODY_NOT_NEEDED_IN_BOOTSTRAP'])assert(!html.includes(secret),secret);
 const apiIsland=await(await fetch(base+'/api/island')).json(),apiPosts=await(await fetch(base+'/api/posts')).json();assert.deepEqual(bootstrap.island,apiIsland.island);assert.deepEqual(bootstrap.rules,{...LAYOUT_RULES,decorationSlots:DECORATION_SLOTS});assert.deepEqual(bootstrap.posts,apiPosts.posts);assert.deepEqual(bootstrap.island.buildings.library.featuredSlugs,['public-record']);assert.equal(bootstrap.posts.length,1);assert.equal(bootstrap.posts[0].title,marker);assert(!('body'in bootstrap.posts[0]));
 const head=await fetch(base+'/island-home',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal((await fetch(base+'/island-home')).headers.get('x-robots-tag'),'noindex, follow');assert.deepEqual(hash(),before);
 console.log('SSR bootstrap passed: safe inline JSON, exact public API projection, no bodies/private drafts/trash/hidden tools, stable shell digest, HEAD and read-only persistence.');
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}fs.rmSync(dir,{recursive:true,force:true});}
