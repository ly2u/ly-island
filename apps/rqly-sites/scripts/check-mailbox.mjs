import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createMailboxStore} from '../mailbox-store.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ly-mailbox-'));
try{
 let store=createMailboxStore(dir);const guest={kind:'guestbook',name:'路人',body:'公开留言 <script>test</script>',contact:'private@example.com',nonce:randomUUID()};
 store.submit(guest,'ip1');store.submit(guest,'ip1');assert.equal(store.list('all').messages.length,1);assert.equal(store.publicList().messages.length,0);
 let message=store.list('all').messages[0];store.update(message.id,{action:'approve',revision:message.revision});const pub=store.publicList().messages[0];assert.equal(pub.body,guest.body);for(const key of ['contact','submissionKey','revision','status','read'])assert.equal(pub[key],undefined);
 const letter={kind:'letter',name:'私信者',title:'仅给岛主',body:'不应公开的私信',contact:'secret@example.com',nonce:randomUUID()};store.submit(letter,'ip1');const secret=store.list('letter').messages[0];assert.throws(()=>store.update(secret.id,{action:'approve',revision:secret.revision}),e=>e.status===400);assert.equal(store.publicList().messages.length,1);
 assert.throws(()=>store.update(message.id,{action:'hide',revision:message.revision}),e=>e.status===409);message=store.list('guestbook').messages[0];store.update(message.id,{action:'reply',reply:'岛主回复',revision:message.revision});assert.equal(store.publicList().messages[0].reply,'岛主回复');message=store.list('guestbook').messages[0];store.update(message.id,{action:'archive',revision:message.revision});assert.equal(store.publicList().messages.length,0);message=store.list('archived').messages[0];store.update(message.id,{action:'restore',revision:message.revision});assert.equal(store.publicList().messages.length,1);
 for(let i=0;i<3;i++)store.submit({...guest,nonce:randomUUID()},'ip1');assert.throws(()=>store.submit({...guest,nonce:randomUUID()},'ip1'),e=>e.status===429);store=createMailboxStore(dir);assert.throws(()=>store.submit({...guest,nonce:randomUUID()},'ip1'),e=>e.status===429);assert.equal(store.list('all').messages.length,5);
 assert.throws(()=>store.submit({...guest,website:'bot',nonce:randomUUID()},'ip2'));assert.throws(()=>store.submit({...guest,body:'x'.repeat(3001),nonce:randomUUID()},'ip2'));assert.throws(()=>store.submit({...guest,contact:'invalid',nonce:randomUUID()},'ip2'));
 assert.equal(fs.statSync(path.join(dir,'mailbox.json')).mode&0o777,0o600);assert(!JSON.stringify(store.publicList()).includes('example.com'));console.log('Mailbox passed: moderation, private letters/contact, idempotency, revision conflicts, replies/archive, persisted rate limits and permissions.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}

// Privacy migration, retry preservation, explicit deletion and quota exhaustion use isolated data only.
const privacyDir=fs.mkdtempSync(path.join(os.tmpdir(),'ly-mailbox-privacy-'));
const {createHash}=await import('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const clock=Date.now;let now=clock();Date.now=()=>now;
try{
 const payload={kind:'guestbook',name:'测试访客',title:'',body:'迁移前公开留言',contact:'',nonce:randomUUID()},address='192.0.2.10';
 const legacySubmission=hash(hash(address)+'\0'+payload.nonce+'\0'+JSON.stringify({kind:payload.kind,name:payload.name,title:payload.title,body:payload.body,contact:payload.contact}));
 const old={schemaVersion:1,messages:[{id:'a'.repeat(32),revision:3,kind:'guestbook',name:payload.name,title:'',body:payload.body,contact:'',status:'published',read:true,archived:false,reply:'已有回复',createdAt:new Date(now).toISOString(),submissionKey:legacySubmission}],meter:{day:new Date(now).toISOString().slice(0,10),count:1},limits:{[hash(address)]:[now]}};
 const file=path.join(privacyDir,'mailbox.json'),keyFile=path.join(privacyDir,'mailbox-key.json');fs.writeFileSync(file,JSON.stringify(old),{mode:0o600});
 let store=createMailboxStore(privacyDir);store.initialize();const current=JSON.parse(fs.readFileSync(file));
 assert.equal(current.messages[0].body,old.messages[0].body);assert.equal(current.messages[0].revision,3);assert.equal(current.messages[0].reply,'已有回复');assert.equal(store.publicList().messages.length,1);assert.equal(current.messages[0].submissionKeyVersion,'hmac-v1');assert.notEqual(current.messages[0].submissionKey,legacySubmission);assert(!fs.readFileSync(file,'utf8').includes(hash(address)));assert(!fs.readFileSync(file,'utf8').includes(address));assert.equal(Object.keys(current.limits)[0].startsWith('hmac:'),true);
 store.submit(payload,address);assert.equal(store.list('all').stats.storage.used,1);assert.equal(store.list('all').messages[0].submissionKeyVersion,undefined);assert.equal(store.list('all').messages[0].submissionKey,undefined);
 for(let i=0;i<4;i++)store.submit({...payload,nonce:randomUUID()},address);assert.throws(()=>store.submit({...payload,nonce:randomUUID()},address),e=>e.status===429);store=createMailboxStore(privacyDir);assert.throws(()=>store.submit({...payload,nonce:randomUUID()},address),e=>e.status===429);assert.equal(store.list('all').stats.daily.used,5);
 now+=3600000;store.maintenance();assert.deepEqual(JSON.parse(fs.readFileSync(file)).limits,{});assert.equal(store.list('all').stats.storage.used,5);
 // An old writer after rollback adds a SHA key; re-upgrading wraps it without dropping quota.
 const mixed=JSON.parse(fs.readFileSync(file));mixed.limits[hash(address)]=[now,now,now,now,now];fs.writeFileSync(file,JSON.stringify(mixed));assert.throws(()=>store.submit({...payload,nonce:randomUUID()},address),e=>e.status===429);
 const keyBytes=fs.readFileSync(keyFile);assert.equal(fs.statSync(keyFile).mode&0o777,0o600);fs.unlinkSync(keyFile);assert.throws(()=>store.publicList(),e=>e.status===503);assert(!fs.existsSync(keyFile));fs.writeFileSync(keyFile,keyBytes,{mode:0o600});fs.chmodSync(keyFile,0o644);assert.throws(()=>store.submit(payload,address),e=>e.status===503);fs.chmodSync(keyFile,0o600);assert.throws(()=>store.submit({...payload,nonce:randomUUID()},address),e=>e.status===429);
 now+=3600000;store.maintenance();
 let message=store.list('all').messages[0];assert.throws(()=>store.remove(message.id,{revision:message.revision,confirm:true}),e=>e.status===400);message=store.update(message.id,{action:'archive',revision:message.revision}).message;assert.throws(()=>store.remove(message.id,{revision:message.revision}),e=>e.status===400);assert.throws(()=>store.remove(message.id,{revision:message.revision-1,confirm:true}),e=>e.status===409);const used=store.list('all').stats.daily.used;store.remove(message.id,{revision:message.revision,confirm:true});assert.equal(store.list('all').stats.storage.used,4);assert.equal(store.list('all').stats.daily.used,used);assert.equal(store.publicList().messages.length,0);
 console.log('Mailbox privacy passed: legacy/re-upgrade HMAC migration, retry preservation, same-time/restart quotas, idle cleanup, key restore/permissions, revision-safe explicit deletion without quota refund.');
}finally{Date.now=clock;fs.rmSync(privacyDir,{recursive:true,force:true});}

const quotaDir=fs.mkdtempSync(path.join(os.tmpdir(),'ly-mailbox-quota-'));
try{
 const store=createMailboxStore(quotaDir),guest={kind:'guestbook',body:'quota fixture',nonce:randomUUID()};
 for(let i=0;i<80;i++)store.submit({...guest,nonce:randomUUID()},'quota-ip-'+i);
 assert.throws(()=>store.submit({...guest,nonce:randomUUID()},'other-ip'),e=>e.status===429);
 for(let i=0;i<20;i++)store.submit({...guest,kind:'letter',nonce:randomUUID()},'letter-ip-'+i);
 assert.throws(()=>store.submit({...guest,kind:'letter',nonce:randomUUID()},'last-ip'),e=>e.status===429);assert.equal(store.list('all').stats.daily.remaining,0);
 const file=path.join(quotaDir,'mailbox.json'),data=JSON.parse(fs.readFileSync(file)),template=data.messages[0];data.messages=Array.from({length:5000},(_,i)=>({...template,id:i.toString(16).padStart(32,'0'),archived:true}));data.meter.count=0;data.meter.guestbookCount=0;fs.writeFileSync(file,JSON.stringify(data));const stats=store.list('archived').stats;assert.equal(stats.storage.used,5000);assert.equal(stats.storage.archived,5000);assert.equal(stats.storage.nearFull,true);assert.throws(()=>store.submit({...guest,nonce:randomUUID()},'space-ip'),e=>e.status===503);
 const m=store.list('archived').messages[0];store.remove(m.id,{revision:m.revision,confirm:true});store.submit({...guest,nonce:randomUUID()},'space-ip');assert.equal(store.list('all').stats.storage.used,5000);
 console.log('Mailbox capacity passed: 80 guestbook + 20 reserved letters, global daily bound, archived storage bound, deletion releases space.');
}finally{fs.rmSync(quotaDir,{recursive:true,force:true});}
