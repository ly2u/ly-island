import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const clean=(value,max,label,optional=false)=>{if(typeof value!=='string'||value.length>max)throw fail(label+'格式无效。');const s=value.trim();if(!s&&!optional)throw fail('请填写'+label+'。');return s;};
const publicMessage=m=>({id:m.id,name:m.name,body:m.body,createdAt:m.createdAt,reply:m.reply||''});
export function createMailboxStore(dataDir){
 const file=path.join(dataDir,'mailbox.json');
 const read=()=>{if(!fs.existsSync(file))return {schemaVersion:1,messages:[],meter:{day:'',count:0},limits:{}};const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.schemaVersion!==1||!Array.isArray(data.messages)||!data.limits||!data.meter)throw fail('邮局暂时无法读取，请稍后重试。',503);return data;};
 const write=data=>{const temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}};
 return {
  publicList(offset=0){const items=read().messages.filter(m=>m.kind==='guestbook'&&m.status==='published'&&!m.archived).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return {messages:items.slice(offset,offset+12).map(publicMessage),nextOffset:offset+12<items.length?offset+12:null};},
  submit(input,address){
   if(!input||typeof input!=='object'||!['guestbook','letter'].includes(input.kind))throw fail('请选择留言或私信。');
   if(input.website)throw fail('投递未完成，请重新填写。');
   if(typeof input.nonce!=='string'||!/^[a-f0-9-]{36}$/.test(input.nonce))throw fail('请刷新邮局后重新投递。');
   const data=read(),now=Date.now(),day=new Date(now).toISOString().slice(0,10),ipKey=createHash('sha256').update(String(address)).digest('hex');
   const name=clean(input.name||'路过的朋友',32,'称呼'),body=clean(input.body,3000,'内容'),title=clean(input.title||'',80,'信件标题',true),contact=clean(input.contact||'',150,'回信邮箱',true);
   if(contact&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))throw fail('回信邮箱格式无效。');
   const submissionKey=createHash('sha256').update(ipKey+'\0'+input.nonce+'\0'+JSON.stringify({kind:input.kind,name,title,body,contact})).digest('hex');const existing=data.messages.find(m=>m.submissionKey===submissionKey);if(existing)return {received:true,kind:existing.kind};
   const times=(data.limits[ipKey]||[]).filter(t=>now-t<3600000);if(times.length>=5)throw fail('这一小时投递得有些频繁，请稍后再来。',429);
   if(data.meter.day!==day)data.meter={day,count:0};if(data.meter.count>=100)throw fail('今天的邮局已收满，请明天再来。',429);
   if(data.messages.length>=5000)throw fail('信箱暂时已满，请稍后再来。',503);
   data.messages.push({id:randomBytes(16).toString('hex'),revision:1,kind:input.kind,name,title,body,contact,status:input.kind==='guestbook'?'pending':'private',read:false,archived:false,reply:'',createdAt:new Date(now).toISOString(),submissionKey});
   data.meter.count++;data.limits=Object.fromEntries(Object.entries(data.limits).map(([k,v])=>[k,v.filter(t=>now-t<3600000)]).filter(([,v])=>v.length).slice(-1000));data.limits[ipKey]=[...times,now];write(data);return {received:true,kind:input.kind};
  },
  list(filter='unread',offset=0){const all=read().messages,active=all.filter(m=>!m.archived);const matches=m=>filter==='archived'?m.archived:!m.archived&&(filter==='all'||filter==='unread'&&!m.read||filter==='pending'&&m.kind==='guestbook'&&m.status==='pending'||filter==='guestbook'&&m.kind==='guestbook'||filter==='letter'&&m.kind==='letter');const items=all.filter(matches).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return {messages:items.slice(offset,offset+20).map(({submissionKey,...m})=>m),nextOffset:offset+20<items.length?offset+20:null,stats:{unread:active.filter(m=>!m.read).length,pending:active.filter(m=>m.kind==='guestbook'&&m.status==='pending').length,letters:active.filter(m=>m.kind==='letter').length,total:active.length}};},
  update(id,input){
   const data=read(),m=data.messages.find(m=>m.id===id);if(!m)throw fail('没有找到这封来信。',404);if(input.revision!==m.revision)throw fail('这封信已经在其他页面更新，请重新打开。',409);
   const action=input.action;
   if(action==='read')m.read=true;else if(action==='unread')m.read=false;
   else if(action==='archive')m.archived=true;else if(action==='restore')m.archived=false;
   else if(['approve','hide','reply'].includes(action)){
    if(m.kind!=='guestbook')throw fail('给岛主的私信不能公开或添加公开回复。');
    if(action==='approve'){if(m.archived)throw fail('请先恢复这条留言。');m.status='published';m.read=true;}
    else if(action==='hide')m.status='hidden';
    else m.reply=clean(input.reply,2000,'回复',true);
   }else throw fail('邮局操作无效。');
   m.revision++;m.updatedAt=new Date().toISOString();write(data);const {submissionKey,...message}=m;return {message};
  }
 };
}
