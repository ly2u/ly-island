import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {scryptSync,randomUUID} from 'node:crypto';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ly-mailbox-http-'));
Object.assign(process.env,{DATA_DIR:dir,NODE_ENV:'test',ADMIN_USERNAME:'ly',ADMIN_PASSWORD_HASH:'scrypt:mailbox-test:'+scryptSync('mailbox-test-password','mailbox-test',64).toString('hex')});
const {handler,initializeData}=await import('../server.mjs');initializeData();const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const headers={'Content-Type':'application/json','X-Requested-With':'rqly-editor',Origin:base};
const request=(route,method='GET',data,extra={})=>fetch(base+route,{method,headers:{...headers,...extra},...(data?{body:JSON.stringify(data)}:{})});
try{
 const login=await request('/api/auth/login','POST',{username:'ly',password:'mailbox-test-password'});assert.equal(login.status,200);const auth={Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await login.json()).csrfToken};
 const body={kind:'letter',body:'HTTP private fixture',contact:'fixture@example.invalid',nonce:randomUUID()};assert.equal((await request('/api/mailbox','POST',body)).status,201);
 let inbox=await(await request('/api/admin/mailbox?filter=letter','GET',null,auth)).json();let m=inbox.messages[0];assert.equal(m.contact,body.contact);assert.equal(m.submissionKeyVersion,undefined);assert.equal(inbox.stats.storage.used,1);
 const route='/api/admin/mailbox/'+m.id,input={revision:m.revision,confirm:true};
 assert.equal((await request(route,'DELETE',input)).status,401);assert.equal((await request(route,'DELETE',input,{...auth,'X-CSRF-Token':''})).status,403);assert.equal((await request(route,'DELETE',input,{...auth,Origin:'https://untrusted.invalid'})).status,403);assert.equal((await request(route,'DELETE',input,auth)).status,400);assert.equal((await request(route,'PUT',{revision:m.revision,action:'approve'},auth)).status,400);
 m=(await(await request(route,'PUT',{revision:m.revision,action:'archive'},auth)).json()).message;assert.equal((await request(route,'DELETE',{revision:m.revision},auth)).status,400);assert.equal((await request(route,'DELETE',{revision:m.revision-1,confirm:true},auth)).status,409);
 assert([404,405].includes((await request('/qizui'+route,'DELETE',{revision:m.revision,confirm:true},auth)).status));
 for(const p of ['/mailbox-key.json','/data/mailbox-key.json','/mailbox.json','/data/mailbox.json'])assert.equal((await fetch(base+p)).status,404);
 const result=await request(route,'DELETE',{revision:m.revision,confirm:true},auth);assert.equal(result.status,200);assert.equal((await result.json()).removed,true);inbox=await(await request('/api/admin/mailbox?filter=all','GET',null,auth)).json();assert.equal(inbox.stats.storage.used,0);assert.equal(inbox.stats.daily.used,1);assert(!fs.readFileSync(path.join(dir,'mailbox.json'),'utf8').includes(body.body));assert.deepEqual((await(await request('/api/mailbox')).json()).messages,[]);
 console.log('Mailbox HTTP passed: owner-only CSRF/origin/revision/explicit-delete enforcement, private-letter protection, key/data routes blocked, deletion retains daily quota.');
}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
