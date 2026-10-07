import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {organizationTypes,validateOrganization,usesOrganization} from './public/rqly/organization-core.mjs';
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const clean=(v,max)=>{if(typeof v!=='string'||v.trim().length>max||/[\u0000-\u001f\u007f]/.test(v))throw error('名称或介绍格式无效。');return v.trim();};
export function createOrganizationStore(dataDir,{references=()=>[]}={}){
 const file=path.join(dataDir,'organization.json');
 function read(){if(!fs.existsSync(file))return {schemaVersion:1,revision:0,items:[]};try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.schemaVersion!==1||!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.items)||data.items.length>300)throw new Error();const seen=new Set();for(const item of data.items){if(!/^org-[a-f0-9]{16}$/.test(item.id)||seen.has(item.id)||!Object.hasOwn(organizationTypes,item.type)||!clean(item.name,60)||clean(item.description,200)!==item.description||typeof item.archived!=='boolean')throw new Error();seen.add(item.id);}return data;}catch{throw error('内容目录数据无法读取，请检查备份。',503);}}
 function mutate(input){const data=read();if(input.baseRevision!==data.revision)throw error('目录已更新，请刷新后再修改。',409);const value=input.item||{},index=data.items.findIndex(i=>i.id===value.id);
  if(input.action==='delete'){if(index<0)throw error('目录不存在。',404);if(references().some(p=>usesOrganization(p,value.id)))throw error('仍有内容、编辑草稿或历史版本引用它。可以先停用，已有归属会保留。',409);data.items.splice(index,1);}
  else if(['create','update'].includes(input.action)){if(input.action==='update'&&index<0)throw error('目录不存在。',404);if(!Object.hasOwn(organizationTypes,value.type))throw error('目录类型无效。');const name=clean(value.name,60),description=clean(value.description??'',200);if(!name)throw error('请填写名称。');if(typeof value.archived!=='boolean')throw error('目录状态无效。');if(index>=0&&data.items[index].type!==value.type)throw error('已有目录不能改变类型。');if(data.items.some(i=>i.type===value.type&&i.name.normalize('NFKC').toLowerCase()===name.normalize('NFKC').toLowerCase()&&i.id!==value.id))throw error('同类目录已存在这个名称。',409);const item={id:index>=0?value.id:'org-'+randomBytes(8).toString('hex'),type:value.type,name,description,archived:value.archived};if(index>=0)data.items[index]=item;else {if(data.items.length>=300)throw error('目录已达300项，请先整理。',409);data.items.push(item);}}
  else throw error('目录操作无效。');data.revision++;fs.mkdirSync(dataDir,{recursive:true});const temp=file+'.'+randomBytes(5).toString('hex')+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}return data;
 }
 function validate(post,posts){if(!post.organization)return;const o=validateOrganization(post.organization),catalog=read();for(const [ids,type] of [[o.tags,'tag'],[o.topics,'topic'],[o.series?[o.series]:[],'series']])for(const id of ids)if(!catalog.items.some(i=>i.id===id&&i.type===type))throw error('所选内容目录已不存在，请重新选择。',409);if(o.projectSlug){if(post.kind==='project'||o.projectSlug===post.slug)throw error('项目自身不能关联到另一个项目。');if(!posts.some(p=>p.slug===o.projectSlug&&p.kind==='project'&&!p.trashedAt))throw error('关联项目已移走，请重新选择。',409);}}
 function publicCatalog(posts){return {schemaVersion:1,items:read().items.filter(item=>posts.some(p=>usesOrganization(p,item.id))).map(item=>({...item,count:posts.filter(p=>usesOrganization(p,item.id)).length}))};}
 return {read,mutate,validate,publicCatalog};
}
