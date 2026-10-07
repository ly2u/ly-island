import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {validateEditorContent} from './editor-drafts.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const validSlug=slug=>typeof slug==='string'&&slug.length<=80&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
const digest=post=>createHash('sha256').update(JSON.stringify(post)).digest('hex');
export function historyContent(post){return validateEditorContent({title:post.title,slug:post.slug,body:post.body,summary:post.summary||'',date:post.date,kind:post.kind||'blog',topic:post.topic,cover:post.cover||'',...(post.organization?{organization:post.organization}:{}),project:{status:'active',role:'',period:'',...post.project}});}
export function createContentHistory(dataDir){
 const directory=path.join(dataDir,'content-history');
 const file=slug=>{if(!validSlug(slug))fail('内容地址无效。');return path.join(directory,slug+'.json');};
 const read=slug=>{
  const filename=file(slug);if(!fs.existsSync(filename))return [];
  let value;try{value=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{fail('历史版本暂时无法读取。',503);}
  if(value?.schemaVersion!==1||!Array.isArray(value.versions)||value.versions.length>30)fail('历史版本存档格式无效。',503);
  const ids=new Set();for(const v of value.versions){if(!v?.post||v.post.slug!==slug||v.id!==digest(v.post)||ids.has(v.id)||typeof v.savedAt!=='string'||typeof v.reason!=='string')fail('历史版本存档损坏。',503);historyContent(v.post);ids.add(v.id);}return value.versions;
 };
 const version=(post,reason='当前版本')=>({id:digest(post),savedAt:post.updatedAt||post.date+'T00:00:00Z',reason,post:structuredClone(post)});
 const meta=(v,current=false)=>({id:v.id,savedAt:v.savedAt,reason:current?'当前保存版本':v.reason,current,title:v.post.title,kind:v.post.kind||'blog',published:v.post.published===true,trashed:Boolean(v.post.trashedAt),characters:v.post.body.length});
 return {
  read,
  captureChanges(before,after,reason='修改前的版本'){
   const next=new Map(after.map(p=>[p.slug,p]));
   for(const post of before){if(JSON.stringify(post)===JSON.stringify(next.get(post.slug)))continue;
    const versions=read(post.slug),snapshot=version(post,reason);if(versions.some(v=>v.id===snapshot.id))continue;
    fs.mkdirSync(directory,{recursive:true,mode:0o700});const filename=file(post.slug),temp=filename+'.'+randomBytes(5).toString('hex')+'.tmp';
    try{fs.writeFileSync(temp,JSON.stringify({schemaVersion:1,versions:[snapshot,...versions].slice(0,30)},null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,filename);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
   }
  },
  list(post){const current=version(post);return {currentRevision:digest(post),limit:30,versions:[meta(current,true),...read(post.slug).filter(v=>v.id!==current.id).map(v=>meta(v))]};},
  get(post,id){if(typeof id!=='string'||! /^[a-f0-9]{64}$/.test(id))fail('历史版本地址无效。');const v=id===digest(post)?version(post):read(post.slug).find(v=>v.id===id);if(!v)fail('这个历史版本已不存在。',404);return {...meta(v,id===digest(post)),content:historyContent(v.post)};},
  references(){if(!fs.existsSync(directory))return [];return fs.readdirSync(directory).filter(name=>name.endsWith('.json')&&validSlug(name.slice(0,-5))).flatMap(name=>read(name.slice(0,-5)));},
 };
}
