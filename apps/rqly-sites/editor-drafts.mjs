import {validateOrganization} from './public/rqly/organization-core.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const idPattern=/^[a-z0-9][a-z0-9-]{0,119}$/;
const slugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hashPattern=/^[a-f0-9]{64}$/;
function string(value,max,name){if(typeof value!=='string'||value.length>max)fail(name+'过长或格式无效。');return value;}
export function validateEditorContent(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('编辑草稿格式无效。');
 if(!['note','blog','project'].includes(value.kind)||!['记录','工程','探索'].includes(value.topic))fail('草稿类型或分类无效。');
 const project=value.project||{};if(!['planning','active','done'].includes(project.status))fail('项目状态无效。');
 const cover=value.cover??'';if(typeof cover!=='string'||(cover&&!/^\/media\/[a-f0-9]{32}\.webp$/.test(cover)))fail('封面地址无效。');
 return {...(Object.hasOwn(value,'organization')?{organization:validateOrganization(value.organization)}:{}),cover,title:string(value.title,100,'标题'),slug:string(value.slug??'',80,'地址'),body:string(value.body,100000,'正文'),summary:string(value.summary,250,'摘要'),date:string(value.date,10,'日期'),kind:value.kind,topic:value.topic,project:{status:project.status,role:string(project.role,120,'职责'),period:string(project.period,80,'时间')}};
}
export function createEditorDraftStore(dataDir){
 const filename=path.join(dataDir,'editor-drafts.json');
 const validateId=id=>{if(typeof id!=='string'||!idPattern.test(id))fail('草稿地址无效。');};
 const read=()=>{
  if(!fs.existsSync(filename))return [];
  let value;try{value=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{fail('编辑草稿暂时无法读取。',503);}
  if(value?.schemaVersion!==1||!Array.isArray(value.drafts)||value.drafts.length>100)fail('编辑草稿存档格式无效。',503);
  const seen=new Set();for(const draft of value.drafts){
   if(!draft||typeof draft.id!=='string'||!idPattern.test(draft.id)||seen.has(draft.id)||!Number.isSafeInteger(draft.revision)||draft.revision<1||typeof draft.updatedAt!=='string')fail('编辑草稿存档格式无效。',503);
   seen.add(draft.id);validateEditorContent(draft.content);if(draft.sourceSlug!==null&&(!slugPattern.test(draft.sourceSlug)||draft.id!=='post-'+draft.sourceSlug||!hashPattern.test(draft.sourceRevision)))fail('编辑草稿来源无效。',503);
   if(draft.sourceSlug===null&&draft.sourceRevision!==null)fail('编辑草稿来源无效。',503);
  }return value.drafts;
 };
 const write=drafts=>{const temp=filename+'.'+randomBytes(5).toString('hex')+'.tmp';try{fs.writeFileSync(temp,JSON.stringify({schemaVersion:1,drafts},null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,filename);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}};
 const get=id=>{validateId(id);return read().find(d=>d.id===id)||null;};
 const requireRevision=(draft,revision)=>{if(revision!==draft?.revision&&!(draft===null&&revision===null))fail('这份编辑草稿已在其他页面更新。当前输入已保留，请重新载入草稿后再继续。',409);};
 return {
  read,get,
  save(id,value){
   validateId(id);if(!value||typeof value!=='object')fail('草稿格式无效。');const drafts=read(),current=drafts.find(d=>d.id===id)||null;requireRevision(current,value.baseRevision);
   const sourceSlug=value.sourceSlug??null,sourceRevision=value.sourceRevision??null;
   if(sourceSlug!==null&&(typeof sourceSlug!=='string'||sourceSlug.length>80||!slugPattern.test(sourceSlug)||id!=='post-'+sourceSlug||!hashPattern.test(sourceRevision)))fail('草稿来源无效。');
   if(sourceSlug===null&&(!id.startsWith('new-')||sourceRevision!==null))fail('新草稿地址无效。');
   if(current&&(current.sourceSlug!==sourceSlug||current.sourceRevision!==sourceRevision))fail('草稿来源已变化，请重新载入。',409);
   if(!current&&drafts.length>=100)fail('编辑草稿已达到 100 份，请先整理草稿箱。',409);
   const next={id,sourceSlug,sourceRevision,revision:(current?.revision||0)+1,updatedAt:new Date().toISOString(),content:validateEditorContent(value.content)};
   write([...drafts.filter(d=>d.id!==id),next]);return next;
  },
  remove(id,revision){const current=get(id);if(!current)fail('这份草稿已被移除，请刷新草稿箱。',409);requireRevision(current,revision);write(read().filter(d=>d.id!==id));},
  prepareConsumption(reference,sourceSlug){
   if(!reference)return null;validateId(reference.id);const current=get(reference.id);if(!current)fail('这份草稿已在其他页面保存或移除，请刷新后再继续。',409);requireRevision(current,reference.revision);
   if(current.sourceSlug!==(sourceSlug||null))fail('编辑草稿与内容不匹配。',409);return current;
  },
 };
}
