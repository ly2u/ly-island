import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {scryptSync,randomBytes} from 'node:crypto';
// Regression guard: request cost must not grow with (posts x size of posts.json) or (images x history files).
// Counts how often data files are read per request. Deterministic; no timing assumptions.
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ly-scale-check-'));
Object.assign(process.env,{DATA_DIR:folder,NODE_ENV:'test',CODEX_BRIDGE_SOCKET:'',ADMIN_USERNAME:'ly',ADMIN_PASSWORD_HASH:'scrypt:scale-check:'+scryptSync('scale-test-password','scale-check',64).toString('hex')});
const reads={posts:0,history:0};const original=fs.readFileSync;
fs.readFileSync=function(file,...rest){const name=String(file);if(name.endsWith(path.sep+'posts.json'))reads.posts++;else if(name.includes(path.sep+'content-history'+path.sep))reads.history++;return original.call(this,file,...rest);};
const {handler,initializeData}=await import('../server.mjs');const {createContentHistory}=await import('../content-history.mjs');initializeData();
const POSTS=80,IMAGES=20,HISTORIED=5;
const make=(i,v)=>({slug:'scale-'+i,title:'记录 '+i,summary:'摘要',body:'桥梁记录。'.repeat(50)+' v'+v,topic:'记录',kind:'note',date:'2026-01-01',cover:'',published:true,updatedAt:new Date(Date.now()-i*1000+v).toISOString()});
const posts=Array.from({length:POSTS},(_,i)=>make(i,0));fs.writeFileSync(path.join(folder,'posts.json'),JSON.stringify(posts));
const history=createContentHistory(folder);history.captureChanges(posts.slice(0,HISTORIED),posts.slice(0,HISTORIED).map((p,i)=>make(i,1)));
fs.mkdirSync(path.join(folder,'media'));for(let i=0;i<IMAGES;i++){const name=randomBytes(16).toString('hex')+'.webp';fs.writeFileSync(path.join(folder,'media',name),Buffer.alloc(100));fs.writeFileSync(path.join(folder,'media',name+'.json'),JSON.stringify({filename:name,url:'/media/'+name,width:10,height:10,bytes:100,createdAt:new Date(Date.now()-i*1000).toISOString()}));}
const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const headers={'Content-Type':'application/json','X-Requested-With':'rqly-editor',Origin:base};
try{
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({username:'ly',password:'scale-test-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];await login.arrayBuffer();
 const admin={headers:{...headers,Cookie:cookie}};
 for(const [url,options] of [['/api/posts',{}],['/api/search?q='+encodeURIComponent('桥'),{}],['/api/admin/search?q='+encodeURIComponent('桥'),admin]]){
  reads.posts=0;const response=await fetch(base+url,options);assert.equal(response.status,200,url);await response.arrayBuffer();
  assert(reads.posts<=3,url+' parsed posts.json '+reads.posts+' times for '+POSTS+' posts; expected a small constant');
 }
 reads.history=0;const media=await fetch(base+'/api/admin/media',admin);assert.equal(media.status,200);const body=await media.json();assert.equal(body.images.length,IMAGES);
 assert(reads.history<=HISTORIED*2,'/api/admin/media read history files '+reads.history+' times for '+IMAGES+' images and '+HISTORIED+' history files; expected one pass over the files');
 console.log('Scale guard passed: list, search and media-library endpoints read data files a constant number of times regardless of post or image count.');
}finally{await new Promise(r=>server.close(r));fs.rmSync(folder,{recursive:true,force:true});}
