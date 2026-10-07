import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash,createHmac} from 'node:crypto';

const HOUR=3600000,MAX_MESSAGES=5000,DAILY_LIMIT=100,GUESTBOOK_DAILY_LIMIT=80;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const digest=value=>createHash('sha256').update(value).digest('hex');
const clean=(value,max,label,optional=false)=>{if(typeof value!=='string'||value.length>max)throw fail(label+'格式无效。');const s=value.trim();if(!s&&!optional)throw fail('请填写'+label+'。');return s;};
const publicMessage=m=>({id:m.id,name:m.name,body:m.body,createdAt:m.createdAt,reply:m.reply||''});

export function createMailboxStore(dataDir){
 const file=path.join(dataDir,'mailbox.json'),keyFile=path.join(dataDir,'mailbox-key.json');
 const read=()=>{
  if(!fs.existsSync(file))return {schemaVersion:1,messages:[],meter:{day:'',count:0,guestbookCount:0},limits:{}};
  let data;try{data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw fail('信箱暂时无法读取，请稍后重试。',503);}
  if(!data||typeof data!=='object'||data.schemaVersion!==1||!Array.isArray(data.messages)||data.messages.length>MAX_MESSAGES||!data.limits||Array.isArray(data.limits)||typeof data.limits!=='object'||!data.meter||!Number.isSafeInteger(data.meter.count)||data.meter.count<0)throw fail('信箱暂时无法读取，请稍后重试。',503);
  return data;
 };
 const write=data=>{const temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}};
 const secret=data=>{
  if(!fs.existsSync(keyFile)){
   // A restored HMAC mailbox needs its original key. Never silently reset its quotas or retry keys.
   if(Object.keys(data.limits).some(k=>k.startsWith('hmac:'))||data.messages.some(m=>m.submissionKeyVersion==='hmac-v1'))throw fail('信箱安全配置缺失，请联系管理员恢复。',503);
   try{fs.writeFileSync(keyFile,JSON.stringify({schemaVersion:1,key:randomBytes(32).toString('hex')})+'\n',{mode:0o600,flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const stat=fs.lstatSync(keyFile);
  if(!stat.isFile()||(stat.mode&0o077))throw fail('信箱安全配置权限无效，请联系管理员。',503);
  let config;try{config=JSON.parse(fs.readFileSync(keyFile,'utf8'));}catch{throw fail('信箱安全配置无效，请联系管理员。',503);}
  if(config.schemaVersion!==1||typeof config.key!=='string'||!/^[a-f0-9]{64}$/.test(config.key))throw fail('信箱安全配置无效，请联系管理员。',503);
  return Buffer.from(config.key,'hex');
 };
 const hmac=(key,value)=>createHmac('sha256',key).update(value).digest('hex');
 function normalized(){
  const data=read(),key=secret(data),now=Date.now(),day=new Date(now).toISOString().slice(0,10);let changed=false;const limits={};
  for(const [old,times] of Object.entries(data.limits)){
   if(!/^(?:hmac:)?[a-f0-9]{64}$/.test(old)||!Array.isArray(times)||times.some(t=>!Number.isFinite(t)))throw fail('信箱限流数据无效，请联系管理员。',503);
   const fresh=times.filter(t=>t<=now&&now-t<HOUR),name=old.startsWith('hmac:')?old:'hmac:'+hmac(key,'ip\0'+old);
   if(fresh.length)limits[name]=[...(limits[name]||[]),...fresh].sort((a,b)=>a-b);
  }
  if(JSON.stringify(limits)!==JSON.stringify(data.limits)){data.limits=limits;changed=true;}
  for(const m of data.messages){
   if(m.submissionKeyVersion==='hmac-v1')continue;
   if(m.submissionKeyVersion!==undefined||typeof m.submissionKey!=='string'||!/^[a-f0-9]{64}$/.test(m.submissionKey))throw fail('信箱重试数据无效，请联系管理员。',503);
   // Wrapping the existing digest preserves retries for pre-upgrade messages without retaining that digest.
   m.submissionKey=hmac(key,'submission\0'+m.submissionKey);m.submissionKeyVersion='hmac-v1';changed=true;
  }
  if(data.meter.day!==day){data.meter={day,count:0,guestbookCount:0};changed=true;}
  else if(!Number.isSafeInteger(data.meter.guestbookCount)||data.meter.guestbookCount<0){data.meter.guestbookCount=data.messages.filter(m=>m.kind==='guestbook'&&m.createdAt.startsWith(day)).length;changed=true;}
  if(changed)write(data);
  return {data,key,now};
 }
 return {
  initialize(){fs.mkdirSync(dataDir,{recursive:true});normalized();},
  maintenance(){normalized();},
  publicList(offset=0){const {data}=normalized(),items=data.messages.filter(m=>m.kind==='guestbook'&&m.status==='published'&&!m.archived).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return {messages:items.slice(offset,offset+12).map(publicMessage),nextOffset:offset+12<items.length?offset+12:null};},
  submit(input,address){
   if(!input||typeof input!=='object'||Array.isArray(input)||!['guestbook','letter'].includes(input.kind))throw fail('请选择留言或私信。');
   if(input.website)throw fail('投递未完成，请重新填写。');
   if(typeof input.nonce!=='string'||!/^[a-f0-9-]{36}$/.test(input.nonce))throw fail('请刷新信箱后重新投递。');
   const name=clean(input.name||'路过的朋友',32,'称呼'),body=clean(input.body,3000,'内容'),title=clean(input.title||'',80,'信件标题',true),contact=clean(input.contact||'',150,'回信邮箱',true);
   if(contact&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))throw fail('回信邮箱格式无效。');
   const {data,key,now}=normalized(),ipDigest=digest(String(address)),ipKey='hmac:'+hmac(key,'ip\0'+ipDigest);
   const submissionKey=hmac(key,'submission\0'+digest(ipDigest+'\0'+input.nonce+'\0'+JSON.stringify({kind:input.kind,name,title,body,contact})));
   const existing=data.messages.find(m=>m.submissionKey===submissionKey);if(existing)return {received:true,kind:existing.kind};
   const times=data.limits[ipKey]||[];if(times.length>=5)throw fail('这一小时投递得有些频繁，请稍后再来。',429);
   if(data.meter.count>=DAILY_LIMIT)throw fail('今天的信箱已收满，请明天再来。',429);
   if(input.kind==='guestbook'&&data.meter.guestbookCount>=GUESTBOOK_DAILY_LIMIT)throw fail('今天的公开留言已收满，仍可给岛主写私信。',429);
   if(data.messages.length>=MAX_MESSAGES)throw fail('信箱暂时已满，请稍后再来。',503);
   if(!Object.hasOwn(data.limits,ipKey)&&Object.keys(data.limits).length>=1000)throw fail('信箱投递较多，请稍后重试。',429);
   data.messages.push({id:randomBytes(16).toString('hex'),revision:1,kind:input.kind,name,title,body,contact,status:input.kind==='guestbook'?'pending':'private',read:false,archived:false,reply:'',createdAt:new Date(now).toISOString(),submissionKey,submissionKeyVersion:'hmac-v1'});
   data.meter.count++;if(input.kind==='guestbook')data.meter.guestbookCount++;data.limits[ipKey]=[...times,now];write(data);return {received:true,kind:input.kind};
  },
  list(filter='unread',offset=0){
   const {data}=normalized(),all=data.messages,active=all.filter(m=>!m.archived);
   const matches=m=>filter==='archived'?m.archived:!m.archived&&(filter==='all'||filter==='unread'&&!m.read||filter==='pending'&&m.kind==='guestbook'&&m.status==='pending'||filter==='guestbook'&&m.kind==='guestbook'||filter==='letter'&&m.kind==='letter');const items=all.filter(matches).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
   return {messages:items.slice(offset,offset+20).map(({submissionKey,submissionKeyVersion,...m})=>m),nextOffset:offset+20<items.length?offset+20:null,stats:{unread:active.filter(m=>!m.read).length,pending:active.filter(m=>m.kind==='guestbook'&&m.status==='pending').length,letters:active.filter(m=>m.kind==='letter').length,total:active.length,storage:{used:all.length,limit:MAX_MESSAGES,archived:all.length-active.length,nearFull:all.length>=4500},daily:{used:data.meter.count,limit:DAILY_LIMIT,guestbookUsed:data.meter.guestbookCount,guestbookLimit:GUESTBOOK_DAILY_LIMIT,remaining:Math.max(0,DAILY_LIMIT-data.meter.count)}}};
  },
  update(id,input){
   const {data}=normalized(),m=data.messages.find(m=>m.id===id);if(!m)throw fail('没有找到这封来信。',404);if(input.revision!==m.revision)throw fail('这封信已经在其他页面更新，请重新打开。',409);
   const action=input.action;
   if(action==='read')m.read=true;else if(action==='unread')m.read=false;
   else if(action==='archive')m.archived=true;else if(action==='restore')m.archived=false;
   else if(['approve','hide','reply'].includes(action)){
    if(m.kind!=='guestbook')throw fail('给岛主的私信不能公开或添加公开回复。');
    if(action==='approve'){if(m.archived)throw fail('请先恢复这条留言。');m.status='published';m.read=true;}
    else if(action==='hide')m.status='hidden';
    else m.reply=clean(input.reply,2000,'回复',true);
   }else throw fail('信箱操作无效。');
   m.revision++;m.updatedAt=new Date().toISOString();write(data);const {submissionKey,submissionKeyVersion,...message}=m;return {message};
  },
  remove(id,input){
   const {data}=normalized(),index=data.messages.findIndex(m=>m.id===id);if(index<0)throw fail('没有找到这封来信。',404);
   const message=data.messages[index];if(input.revision!==message.revision)throw fail('这封信已经在其他页面更新，请重新打开。',409);
   if(!message.archived||input.confirm!==true)throw fail('请先归档，再确认永久删除这封来信。');
   // Quotas remain consumed after deletion; deleting spam must not reopen the day's allowance.
   data.messages.splice(index,1);write(data);return {removed:true};
  }
 };
}
