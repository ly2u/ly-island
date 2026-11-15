import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {scryptSync} from 'node:crypto';
import {isArticle,knowledgeBooks,roomRecords} from '../public/rqly/island-content.mjs';
import {searchContent} from '../public/rqly/search-core.mjs';
import {growthStats,growthRecords} from '../public/rqly/growth-core.mjs';
import {renderReader} from '../public/rqly/reader-view.mjs';

const category={id:'org-1111111111111111',name:'结构与随想',description:'同一分类可收录各种文章',type:'topic',archived:false};
const record=(slug,kind,extra={})=>({slug,kind,title:slug,body:'## 一节\n\n共同内容。',summary:'合成摘要',date:'2026-01-01',topic:'记录',published:true,organization:{tags:[],topics:[category.id],series:'',order:1,projectSlug:''},organizationDetails:{tags:[],topics:[category]},...extra});
const records=[record('knowledge','note'),record('thought','blog'),record('legacy',undefined),record('private','note',{published:false}),record('deleted','blog',{trashedAt:'2026-01-02T00:00:00Z'}),record('project','project')];
let groups=0;
assert(records.slice(0,3).every(isArticle));assert(!isArticle(records[5]));assert(!isArticle({kind:'unknown'}));
assert.deepEqual(knowledgeBooks(records)[0].notes.map(p=>p.slug),['knowledge','thought','legacy']);
assert.deepEqual(roomRecords(records,'library').map(p=>p.slug),roomRecords(records,'blog').map(p=>p.slug));groups++;
assert.equal(searchContent(records.map(record=>({record})),{kind:'article',status:'published'}).length,3);
assert.equal(searchContent(records.map(record=>({record})),{kind:'article',status:'draft'}).length,1);
assert.equal(searchContent(records.map(record=>({record})),{kind:'article',status:'trash'}).length,1);
for(const scope of ['library','blog'])assert.equal(searchContent(records.map(record=>({record})),{scope,status:'published'}).length,3);groups++;
for(const p of records.slice(0,3)){const html=renderReader(p,'<h2>一节</h2><p>正文</p>');assert(html.includes('class="reader-toc"'));assert(html.includes(' / 文章 / '));assert(!html.includes(' / 笔记 / '));assert(!html.includes(' / 博客 / '));assert(html.includes('href="/notes"'));}
groups++;
assert.equal(growthStats(records).articles,3);assert.equal(growthStats(records).score,14);
assert(growthRecords(records).filter(p=>p.kind!=='project').every(p=>p.points===3));groups++;

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ly-unified-'));let server;
try {
 Object.assign(process.env,{DATA_DIR:dir,NODE_ENV:'test',ADMIN_USERNAME:'ly',ADMIN_PASSWORD_HASH:'scrypt:unified:'+scryptSync('fixture-only-password','unified',64).toString('hex')});
 const {handler,initializeData}=await import('../server.mjs');initializeData();
 fs.writeFileSync(path.join(dir,'posts.json'),JSON.stringify(records));fs.writeFileSync(path.join(dir,'organization.json'),JSON.stringify({schemaVersion:1,revision:1,items:[category]}));
 server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const get=route=>fetch(base+route);const original=fs.readFileSync(path.join(dir,'posts.json'));
 for(const route of ['/notes?book='+category.id,'/blog']){const response=await get(route);assert.equal(response.status,200);const html=await response.text();for(const slug of ['knowledge','thought','legacy'])assert(html.includes('href="/notes/'+slug+'"'));for(const slug of ['private','deleted','project'])assert(!html.includes('href="/notes/'+slug+'"'));}
 assert.equal((await get('/api/search?kind=article&q=共同')).status,200);assert.equal((await(await get('/api/search?scope=library&book='+category.id)).json()).total,3);assert.deepEqual(fs.readFileSync(path.join(dir,'posts.json')),original);groups++;
 const headers={'Content-Type':'application/json','X-Requested-With':'rqly-editor',Origin:base};
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({username:'ly',password:'fixture-only-password'})});assert.equal(login.status,200);headers.Cookie=login.headers.get('set-cookie').split(';')[0];headers['X-CSRF-Token']=(await login.json()).csrfToken;
 const request=(route,method,body,extra={})=>fetch(base+route,{method,headers:{...headers,...extra},body:JSON.stringify(body)});
 let response=await request('/api/admin/organization','PUT',{baseRevision:1,action:'create',item:{type:'topic',name:'新分类 <img src=x onerror=alert(1)>',description:'书架介绍',archived:false}});assert.equal(response.status,200);const created=(await response.json()).catalog.items.find(i=>i.id!==category.id);assert(created);
 response=await request('/api/admin/organization','PUT',{baseRevision:1,action:'create',item:{type:'topic',name:'冲突不能写入',description:'',archived:false}});assert.equal(response.status,409);assert(!fs.readFileSync(path.join(dir,'organization.json'),'utf8').includes('冲突不能写入'));groups++;
 const article={...record('new-article','note',{published:false}),organization:{tags:[],topics:[created.id],series:'',order:1,projectSlug:''}};delete article.organizationDetails;
 response=await request('/api/admin/posts','POST',article);assert.equal(response.status,200);const saved=(await response.json()).post;
 assert.equal((await get('/notes?book='+created.id)).status,404);assert.equal((await get('/notes/new-article')).status,404);
 response=await request('/api/admin/posts','PUT',{...saved,published:true},{'If-Match':saved.revision});assert.equal(response.status,200);
 const bookHTML=await(await get('/notes?book='+created.id)).text();assert(bookHTML.includes('新分类 &lt;img'));assert(!bookHTML.includes('<img src=x'));assert(bookHTML.includes('/notes/new-article'));groups++;
 const all=await(await fetch(base+'/api/admin/posts',{headers})).json();const old=all.posts.find(p=>p.slug==='thought');response=await request('/api/admin/posts','PUT',{...old,title:'统一编辑后保留原网址和存储类型'},{'If-Match':old.revision});assert.equal(response.status,200);const updated=(await response.json()).post;assert.equal(updated.kind,'blog');assert.equal(updated.slug,'thought');assert.equal((await get('/notes/thought')).status,200);
 response=await request('/api/admin/posts','POST',{...article,slug:'invalid-kind',kind:'article'});assert.equal(response.status,400);groups++;
 console.log(groups+' unified-article groups passed: legacy kinds share public books/feed/search/readers/points; drafts stay private; inline category revisions and escaping; old edit URLs/types preserved; no implicit data rewrite.');
} finally {
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
 fs.rmSync(dir,{recursive:true,force:true});
}
