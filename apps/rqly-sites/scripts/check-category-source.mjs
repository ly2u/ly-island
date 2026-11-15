import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {migrateLegacyCategories} from '../category-migration.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {knowledgeBooks,findCategoryBook,categoryLabel} from '../public/rqly/island-content.mjs';
import {decorateOrganization} from '../public/rqly/organization-core.mjs';
import {renderReader} from '../public/rqly/reader-view.mjs';
import {searchContent} from '../public/rqly/search-core.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ly-category-')),json=value=>JSON.stringify(value,null,2)+'\n';let server,groups=0;
const empty={tags:[],topics:[],series:'',order:1,projectSlug:''};
const old={slug:'old-exploration',title:'旧文章',date:'2026-01-01',summary:'合成摘要',topic:'探索',body:'正文',published:true};
const posts=[old,{...old,slug:'explicit-empty',organization:empty},{...old,slug:'project',kind:'project'},{...old,slug:'normal',topic:'记录'}];
try{
 fs.writeFileSync(path.join(dir,'posts.json'),json(posts));fs.writeFileSync(path.join(dir,'organization.json'),json({schemaVersion:1,revision:0,items:[]}));
 const original=fs.readFileSync(path.join(dir,'posts.json')),originalCatalog=fs.readFileSync(path.join(dir,'organization.json'));
 let report=migrateLegacyCategories(dir);assert.equal(report.changedRecords,1);assert.deepEqual(fs.readFileSync(path.join(dir,'posts.json')),original);assert.deepEqual(fs.readFileSync(path.join(dir,'organization.json')),originalCatalog);groups++;
 assert.equal(knowledgeBooks(posts).length,1);assert.equal(knowledgeBooks(posts)[0].id,'general');assert.equal(categoryLabel(old),'未分类');groups++;
 assert.throws(()=>migrateLegacyCategories(dir,{apply:true,fault:()=>{throw Error('injected');}}),/injected/);assert.deepEqual(fs.readFileSync(path.join(dir,'posts.json')),original);assert.deepEqual(fs.readFileSync(path.join(dir,'organization.json')),originalCatalog);assert(!fs.existsSync(path.join(dir,'content-import-transaction')));groups++;
 report=migrateLegacyCategories(dir,{apply:true});assert(report.applied);const migrated=JSON.parse(fs.readFileSync(path.join(dir,'posts.json'))),store=createOrganizationStore(dir,{references:()=>migrated}),catalog=store.read(),category=catalog.items.find(i=>i.name==='探索');assert(category);assert.deepEqual(migrated[0].organization.topics,[category.id]);assert.deepEqual({...migrated[0],organization:undefined},{...old,organization:undefined});assert.deepEqual(migrated.slice(1),posts.slice(1));assert.equal(migrateLegacyCategories(dir,{apply:true}).changedRecords,0);groups++;
 const publicRecords=()=>{const selected=migrated.filter(p=>p.published&&!p.trashedAt);return selected.map(p=>decorateOrganization(p,store.publicCatalog(selected),selected));};
 let books=knowledgeBooks(publicRecords());assert.equal(findCategoryBook(books,'exploration').id,category.id);let current=store.read();store.mutate({baseRevision:current.revision,action:'update',item:{...category,name:'工具与实践'}});books=knowledgeBooks(publicRecords());assert.equal(findCategoryBook(books,'exploration').title,'工具与实践');assert.equal(categoryLabel(publicRecords()[0]),'工具与实践');const html=renderReader(publicRecords()[0],'<p>正文</p>');assert(html.includes('>工具与实践</span>'));assert(!html.includes('>探索</span>'));assert.equal(searchContent(publicRecords().map(record=>({record})),{q:'工具与实践'})[0].category,'工具与实践');groups++;
 Object.assign(process.env,{DATA_DIR:dir,NODE_ENV:'test'});const {handler,initializeData}=await import('../server.mjs');initializeData();server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const native=await(await fetch(base+'/notes?book=exploration')).text();assert(native.includes('href="https://rqly.com/notes?book='+category.id+'"'));assert(native.includes('工具与实践'));assert.equal((await(await fetch(base+'/api/search?scope=library&book=exploration')).json()).total,1);assert.equal((await fetch(base+'/category-migration.mjs')).status,404);groups++;
 // Clearing a real category must not resurrect the historic fixed group.
 migrated[0].organization=empty;fs.writeFileSync(path.join(dir,'posts.json'),json(migrated));assert.equal(knowledgeBooks(publicRecords()).length,1);assert.equal(knowledgeBooks(publicRecords())[0].id,'general');assert.equal(categoryLabel(publicRecords()[0]),'未分类');assert(!JSON.stringify(store.publicCatalog(migrated.filter(p=>p.published))).includes('工具与实践'));groups++;
 current=store.read();store.mutate({baseRevision:current.revision,action:'delete',item:{id:category.id}});assert.deepEqual(store.read().legacyBooks,{});groups++;
 // Pending editor drafts prevent an offline repair from invalidating their bases.
 fs.writeFileSync(path.join(dir,'posts.json'),original);fs.writeFileSync(path.join(dir,'editor-drafts.json'),json({schemaVersion:1,drafts:[{id:'new-test',sourceSlug:null,sourceRevision:null,revision:1,updatedAt:'2026-01-01T00:00:00Z',content:{...old,slug:'',kind:'note',project:{status:'active',role:'',period:''}}}]}));assert.throws(()=>migrateLegacyCategories(dir,{apply:true}),/编辑草稿/);assert.deepEqual(fs.readFileSync(path.join(dir,'posts.json')),original);groups++;
 console.log(groups+' category-source groups passed: no synthetic categories, read-only plan, transactional rollback, metadata-only/idempotent repair, editable stable aliases, real detail/search labels, clear does not reclassify, and draft/version protection.');
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}fs.rmSync(dir,{recursive:true,force:true});}
