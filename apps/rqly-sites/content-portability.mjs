import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import yazl from 'yazl';
import yauzl from 'yauzl';
import sharp from 'sharp';
import {validateRecord} from './island-store.mjs';
import {validateEditorContent} from './editor-drafts.mjs';
import {organizationTypes} from './public/rqly/organization-core.mjs';
import {WITHDRAWN_IMAGE_HASHES} from './withdrawn-images.mjs';

const MB=1024*1024;
export const TRANSFER_LIMITS={zipBytes:2200*MB,totalBytes:2200*MB,textBytes:64*MB,files:50000,posts:5000,media:2000,expiresMs:30*60*1000};
const slugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const mediaPattern=/^[a-f0-9]{32}\.webp$/;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const json=value=>JSON.stringify(value,null,2)+'\n';
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
function privateWrite(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,value,{mode:0o600,flag:'wx'});}
async function fileHash(file){const h=createHash('sha256');for await(const part of fs.createReadStream(file))h.update(part);return h.digest('hex');}
function space(dir,bytes){const s=fs.statfsSync(dir);if(s.bavail*s.bsize<bytes+64*MB)fail('磁盘空间不足，请先清理或联系维护者。',507);}
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())fail('内容存档含无效文件。');return s;}
function catalogCheck(value){
 if(!plain(value)||value.schemaVersion!==1||!Array.isArray(value.items)||value.items.length>300)fail('目录存档格式无效。');
 const ids=new Set(),names=new Set();for(const i of value.items){const key=i?.type+':'+String(i?.name).normalize('NFKC').toLowerCase();if(!plain(i)||!/^org-[a-f0-9]{16}$/.test(i.id)||ids.has(i.id)||!Object.hasOwn(organizationTypes,i.type)||typeof i.name!=='string'||!i.name.trim()||i.name.length>60||typeof i.description!=='string'||i.description.length>200||/[\u0000-\u001f\u007f]/.test(i.name+i.description)||typeof i.archived!=='boolean'||names.has(key))fail('目录存档格式无效。');ids.add(i.id);names.add(key);}return value;
}
const localBody=body=>body.replace(/\/media\/([a-f0-9]{32}\.webp)/g,'../media/$1');
function markdownFile(record){const {body,...meta}=record;return '---\n'+Object.entries({...meta,...(meta.cover?{cover:localBody(meta.cover)}:{})}).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n')+'\n---\n\n'+localBody(body);}
function parseMarkdown(file,offsets=[]){
 const source=fs.readFileSync(file,'utf8'),match=source.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);if(!match)fail('Markdown 文件头格式无效。');
 const record={};for(const line of match[1].split('\n')){const entry=line.match(/^([a-zA-Z][a-zA-Z0-9]*): (.+)$/);if(!entry||Object.hasOwn(record,entry[1])||['constructor','prototype'].includes(entry[1]))fail('Markdown 元数据格式无效。');try{record[entry[1]]=JSON.parse(entry[2]);}catch{fail('Markdown 元数据格式无效。');}}
 record.body=match[2];if(!Array.isArray(offsets)||offsets.length>20000)fail('图片位置清单无效。');let previous=Infinity;for(const offset of [...offsets].reverse()){if(!Number.isSafeInteger(offset)||offset<0||offset>=previous||!/^\.\.\/media\/[a-f0-9]{32}\.webp/.test(record.body.slice(offset)))fail('图片位置清单无效。');record.body=record.body.slice(0,offset)+record.body.slice(offset+2);previous=offset;}if(typeof record.cover==='string')record.cover=record.cover.replace(/^\.\.\/media\//,'/media/');return record;
}

// Capture JSON synchronously and hard-link immutable media before any async work.
// A concurrent delete cannot invalidate the snapshot, and no account/mail/AI files enter it.
export async function exportContentZip(dataDir,output){
 const root=path.join(dataDir,'.content-transfer');fs.mkdirSync(root,{recursive:true,mode:0o700});
 const job=fs.mkdtempSync(path.join(root,'export-'));fs.chmodSync(job,0o700);
 try{
  const posts=readJSON(path.join(dataDir,'posts.json')),drafts=fs.existsSync(path.join(dataDir,'editor-drafts.json'))?readJSON(path.join(dataDir,'editor-drafts.json')).drafts:[];
  if(!Array.isArray(posts)||posts.length>TRANSFER_LIMITS.posts||!Array.isArray(drafts)||drafts.length>100)fail('内容数量超过当前导出上限。',413);
  const catalog=fs.existsSync(path.join(dataDir,'organization.json'))?catalogCheck(readJSON(path.join(dataDir,'organization.json'))):{schemaVersion:1,revision:0,items:[]};
  const entries=[],records=[];let textBytes=0,total=0;
  const add=(name,value)=>{const bytes=Buffer.from(value);textBytes+=bytes.length;if(textBytes>TRANSFER_LIMITS.textBytes)fail('正文和历史超过 64 MB，请联系维护者分批导出。',413);privateWrite(path.join(job,name),bytes);entries.push(name);};
  const record=(name,value,type,context={})=>{if(typeof value.body!=='string'||value.body.length>100000)fail('正文存档格式无效。');const mediaOffsets=[...value.body.matchAll(/\/media\/([a-f0-9]{32}\.webp)/g)].map((m,i)=>m.index+i*2);add(name,markdownFile(value));records.push({path:name,type,mediaOffsets,...context});};
  const seen=new Set();for(const p of posts){if(typeof p.slug!=='string'||p.slug.length>80||!slugPattern.test(p.slug)||seen.has(p.slug))fail('内容地址存档无效。');seen.add(p.slug);record('posts/'+p.slug+'.md',p,'post');}
  for(const [i,d] of drafts.entries())record('drafts/draft-'+i+'.md',d.content,'editorDraft',{sourceSlug:d.sourceSlug,updatedAt:d.updatedAt});
  const history=path.join(dataDir,'content-history');if(fs.existsSync(history))for(const name of fs.readdirSync(history)){if(!/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(name))continue;const values=readJSON(path.join(history,name));if(values.schemaVersion!==1||!Array.isArray(values.versions)||values.versions.length>30)fail('历史存档格式无效。');for(const v of values.versions){if(!/^[a-f0-9]{64}$/.test(v.id))fail('历史标识无效。');record('history/'+name.slice(0,-5)+'-'+v.id+'.md',v.post,'history',{savedAt:v.savedAt,reason:v.reason});}}
  add('organization.json',json(catalog));if(fs.existsSync(path.join(dataDir,'island.json')))add('island.json',fs.readFileSync(path.join(dataDir,'island.json'),'utf8'));
  const images=[],mediaDir=path.join(dataDir,'media');if(fs.existsSync(mediaDir))for(const name of fs.readdirSync(mediaDir).filter(n=>mediaPattern.test(n)).sort()){
   const file=path.join(mediaDir,name),info=readJSON(file+'.json'),size=regular(file).size;if(size>8*MB||info.filename!==name||info.bytes!==size)fail('图片存档格式无效。');total+=size;if(total>2*1024*MB||images.length>=TRANSFER_LIMITS.media)fail('图片超过当前导出上限。',413);
   fs.mkdirSync(path.join(job,'media'),{mode:0o700,recursive:true});fs.linkSync(file,path.join(job,'media',name));entries.push('media/'+name);images.push({...info});
  }
  add('README.md','# LY 内容副本\n\nposts/ 每篇一个 Markdown，drafts/ 是自动保存的编辑，history/ 是旧版本，media/ 包含全部图片。JSON 值形式的 YAML 文件头保存元数据，正文图片使用相对路径。organization.json 保存标签、专题和系列，island.json 保存岛屿配置。\n\n此包包含私密草稿、回收站和历史，请妥善保存。没有管理员凭据、信箱或 AI 登录信息。浏览器尚未同步的文字和 CivilFlow 工作流不在其中。\n\n在后台导入时，现有内容不会被覆盖，导入内容保持草稿。历史与岛屿配置留在存档中，不自动写入线上。勿修改 manifest.json；文件校验失败时应重新导出。\n');
  if(entries.length+1>TRANSFER_LIMITS.files)fail('存档文件数量超过上限。',413);space(dataDir,total+textBytes);
  const files={};for(const name of entries){const file=path.join(job,name);files[name]={bytes:regular(file).size,sha256:await fileHash(file)};if(name.startsWith('media/')&&WITHDRAWN_IMAGE_HASHES.includes(files[name].sha256))fail('存档包含已撤回素材，不能导出。');}
  const manifest={format:'ly-content',version:1,exportedAt:new Date().toISOString(),records,media:images,files},manifestBytes=Buffer.from(json(manifest));if(manifestBytes.length>16*MB||textBytes+manifestBytes.length>TRANSFER_LIMITS.textBytes)fail('内容清单和正文超过当前导出上限。',413);privateWrite(path.join(job,'manifest.json'),manifestBytes);entries.push('manifest.json');
  const target=output||path.join(job,'content.zip'),zip=new yazl.ZipFile();
  const written=pipeline(zip.outputStream,fs.createWriteStream(target,{mode:0o600,flags:'wx'}));zip.on('error',error=>zip.outputStream.destroy(error));
  for(const name of entries)zip.addFile(path.join(job,name),name,{mode:0o100600,compress:!name.startsWith('media/')});zip.end();await written;
  if(output){fs.rmSync(job,{recursive:true,force:true});return {file:target,posts:posts.length,editorDrafts:drafts.length,media:images.length};}
  return {file:target,cleanup:()=>fs.rmSync(job,{recursive:true,force:true})};
 }catch(error){fs.rmSync(job,{recursive:true,force:true});if(output)fs.rmSync(output,{force:true});throw error;}
}

function openZip(file){return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>error?reject(error):resolve(zip)));}
async function unpack(file,job){
 const zip=await openZip(file),files=new Map();let bytes=0,text=0;
 try{await new Promise((resolve,reject)=>{
  zip.on('error',reject);zip.on('end',resolve);
  zip.on('entry',entry=>{(async()=>{
   const name=entry.fileName,mode=(entry.externalFileAttributes>>>16)&0xffff;
   if(!/^(?:manifest\.json|README\.md|organization\.json|island\.json|posts\/[a-z0-9-]{1,80}\.md|drafts\/draft-\d+\.md|history\/[a-z0-9-]+-[a-f0-9]{64}\.md|media\/[a-f0-9]{32}\.webp)$/.test(name)||files.has(name)||(mode&0o170000)&&((mode&0o170000)!==0o100000)||entry.generalPurposeBitFlag&1||!Number.isSafeInteger(entry.uncompressedSize))fail('ZIP 包含无效路径、链接、加密或重复文件。');
   bytes+=entry.uncompressedSize;if(!name.startsWith('media/'))text+=entry.uncompressedSize;
   if(bytes>TRANSFER_LIMITS.totalBytes||text>TRANSFER_LIMITS.textBytes||files.size>=TRANSFER_LIMITS.files||entry.uncompressedSize>(name.startsWith('media/')?8*MB:name==='manifest.json'?16*MB:name.endsWith('.md')?512*1024:4*MB))fail('ZIP 解包内容超过安全上限。',413);
   space(path.dirname(job),entry.uncompressedSize);const target=path.join(job,'entry-'+files.size);files.set(name,target);
   const stream=await new Promise((res,rej)=>zip.openReadStream(entry,(error,value)=>error?rej(error):res(value)));await pipeline(stream,fs.createWriteStream(target,{mode:0o600,flags:'wx'}));zip.readEntry();
  })().catch(reject);});zip.readEntry();
 });}catch(error){zip.close();throw error;}
 const manifestFile=files.get('manifest.json');if(!manifestFile)fail('没有找到内容包清单。');const manifest=readJSON(manifestFile);
 if(manifest.format!=='ly-content'||manifest.version!==1||!plain(manifest.files)||!Array.isArray(manifest.records)||manifest.records.length>TRANSFER_LIMITS.files||!Array.isArray(manifest.media)||manifest.media.length>TRANSFER_LIMITS.media)fail('不支持这个内容包版本。');
 if(Object.keys(manifest.files).length+1!==files.size)fail('内容包文件清单不完整。');
 for(const [name,info] of Object.entries(manifest.files)){const target=files.get(name);if(name==='manifest.json'||!target||!plain(info)||info.bytes!==regular(target).size||!/^[a-f0-9]{64}$/.test(info.sha256)||await fileHash(target)!==info.sha256)fail('内容包校验失败，请重新导出。');}
 const records=[],seen=new Set();for(const descriptor of manifest.records){if(!plain(descriptor)||!['post','editorDraft','history'].includes(descriptor.type)||typeof descriptor.path!=='string'||!descriptor.path.startsWith(({post:'posts/',editorDraft:'drafts/',history:'history/'})[descriptor.type])||seen.has(descriptor.path)||!files.has(descriptor.path))fail('正文清单格式无效。');seen.add(descriptor.path);const value=parseMarkdown(files.get(descriptor.path),descriptor.mediaOffsets);if(descriptor.type==='editorDraft')validateEditorContent(value);else{validateRecord(value);if(descriptor.type==='post'&&descriptor.path!=='posts/'+value.slug+'.md')fail('内容地址与文件名不一致。');}records.push({...descriptor,content:value});}
 if([...files.keys()].filter(n=>/^(posts|drafts|history)\//.test(n)).some(n=>!seen.has(n)))fail('正文清单不完整。');
 if(records.filter(r=>r.type==='post').length>TRANSFER_LIMITS.posts)fail('文章数量超过上限。',413);
 const catalog=catalogCheck(readJSON(files.get('organization.json')||'')),media=[],imageNames=new Set();
 for(const info of manifest.media){if(!plain(info)||!mediaPattern.test(info.filename)||imageNames.has(info.filename)||info.url!=='/media/'+info.filename||!files.has('media/'+info.filename)||info.bytes!==regular(files.get('media/'+info.filename)).size||typeof info.createdAt!=='string'||Number.isNaN(Date.parse(info.createdAt)))fail('图片清单格式无效。');imageNames.add(info.filename);const file=files.get('media/'+info.filename),digest=manifest.files['media/'+info.filename].sha256;
  if(WITHDRAWN_IMAGE_HASHES.includes(digest))fail('内容包含已撤回素材，不能导入。');
  try{const image=sharp(file,{limitInputPixels:20000000,failOn:'warning'}),meta=await image.metadata();if(meta.format!=='webp'||(meta.pages||1)>1||meta.width!==info.width||meta.height!==info.height||meta.width<1||meta.height<1||meta.width>2400||meta.height>2400)fail('图片元信息不匹配。');await image.stats();}catch{fail('内容包中有无法读取的图片。');}media.push({info,file,digest});
 }
 if([...files.keys()].filter(n=>n.startsWith('media/')).length!==media.length)fail('图片清单不完整。');
 for(const r of records){const refs=new Set(r.content.body.match(/\/media\/([a-f0-9]{32}\.webp)/g)||[]);if(r.content.cover)refs.add(r.content.cover);for(const ref of refs)if(!imageNames.has(ref.slice(7)))fail('正文引用的图片不在内容包中。');}
 return {records,catalog,media,exportedAt:manifest.exportedAt};
}

const transactionName='content-import-transaction';
function targetAllowed(name){return ['posts.json','editor-drafts.json','organization.json'].includes(name)||/^media\/[a-f0-9]{32}\.webp(?:\.json)?$/.test(name);}
function syncFile(file){const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function syncDir(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function recoverContentImport(dataDir){
 const dir=path.join(dataDir,transactionName);if(!fs.existsSync(dir))return;
 if(!fs.existsSync(path.join(dir,'journal.json'))){fs.rmSync(dir,{recursive:true,force:true});return;}
 const journal=readJSON(path.join(dir,'journal.json'));if(journal.version!==1||!Array.isArray(journal.files))fail('导入恢复记录无效，请联系维护者。',503);
 // Refuse to undo unrelated later writes. Startup remains closed until inspected.
 for(const entry of journal.files){if(!targetAllowed(entry.name)||typeof entry.existed!=='boolean'||!/^before-\d+$/.test(entry.backup)||!/^[a-f0-9]{64}$/.test(entry.next)||entry.existed&&!/^[a-f0-9]{64}$/.test(entry.before))fail('导入恢复记录无效。',503);const target=path.join(dataDir,entry.name);if(fs.existsSync(target)&&![entry.next,entry.before].includes(hash(fs.readFileSync(target))))fail('导入恢复与当前内容冲突，请联系维护者。',503);if(entry.existed&&(!fs.existsSync(path.join(dir,entry.backup))||hash(fs.readFileSync(path.join(dir,entry.backup)))!==entry.before))fail('导入恢复副本缺失。',503);}
 for(const entry of [...journal.files].reverse()){const target=path.join(dataDir,entry.name);if(entry.existed){const temp=target+'.recovery.tmp';fs.copyFileSync(path.join(dir,entry.backup),temp);fs.chmodSync(temp,0o600);syncFile(temp);fs.renameSync(temp,target);}else fs.rmSync(target,{force:true});if(fs.existsSync(path.dirname(target)))syncDir(path.dirname(target));}
 syncDir(dataDir);fs.rmSync(dir,{recursive:true,force:true});
}
function commitFiles(dataDir,changes,{fault=()=>{}}={}){
 const dir=path.join(dataDir,transactionName);fs.mkdirSync(dir,{mode:0o700});const entries=[];
 try{
  for(const [i,change] of changes.entries()){if(!targetAllowed(change.name))fail('导入目标无效。');const target=path.join(dataDir,change.name),next=path.join(dir,'next-'+i),backup='before-'+i,existed=fs.existsSync(target);if(existed){regular(target);fs.copyFileSync(target,path.join(dir,backup));fs.chmodSync(path.join(dir,backup),0o600);syncFile(path.join(dir,backup));}if(change.file)fs.copyFileSync(change.file,next);else privateWrite(next,change.value);fs.chmodSync(next,0o600);syncFile(next);entries.push({name:change.name,existed,backup,next:hash(fs.readFileSync(next)),before:existed?hash(fs.readFileSync(target)):null,stage:'next-'+i});}
  privateWrite(path.join(dir,'journal.json'),json({version:1,files:entries}));syncFile(path.join(dir,'journal.json'));syncDir(dir);syncDir(dataDir);
  for(const [i,entry] of entries.entries()){const target=path.join(dataDir,entry.name);fs.mkdirSync(path.dirname(target),{mode:0o700,recursive:true});fs.renameSync(path.join(dir,entry.stage),target);syncDir(path.dirname(target));fault(i);}
  // Removing the journal is the durable commit point; staged backups are not content history.
  fs.unlinkSync(path.join(dir,'journal.json'));syncDir(dir);fs.rmSync(dir,{recursive:true,force:true});syncDir(dataDir);
 }catch(error){recoverContentImport(dataDir);throw error;}
}

export function createContentPortability(dataDir,{readPosts,organizationStore,editorDrafts,mediaStore,fault}={}){
 const root=path.join(dataDir,'.content-transfer'),plans=new Map();let active=false;
 const maintenance=()=>{for(const [token,plan] of plans)if(plan.expiresAt<Date.now()){fs.rmSync(plan.job,{recursive:true,force:true});plans.delete(token);}};
 function initialize(){recoverContentImport(dataDir);fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(root,{recursive:true,mode:0o700});}
 async function locked(operation){if(active)fail('正在处理内容包，请稍后再试。',429);active=true;try{return await operation();}finally{active=false;}}
 function state(){return hash(json({posts:readPosts(),catalog:organizationStore.read(),drafts:editorDrafts.read(),media:mediaStore.list()}));}
 function buildPlan(bundle,policy){
  if(!['skip','copy'].includes(policy))fail('重复内容处理方式无效。');
  const before=state(),posts=readPosts(),existing=new Map(posts.map(p=>[p.slug,p])),catalog=organizationStore.read(),drafts=editorDrafts.read(),items=structuredClone(catalog.items),orgIds=new Map(),mapping=new Map(),rows=[],newPosts=[],newDrafts=[];
  for(const source of bundle.catalog.items){const same=items.find(i=>i.type===source.type&&i.name.normalize('NFKC').toLowerCase()===source.name.normalize('NFKC').toLowerCase());if(same){orgIds.set(source.id,same.id);continue;}const id=items.some(i=>i.id===source.id)?'org-'+randomBytes(8).toString('hex'):source.id;orgIds.set(source.id,id);items.push({...source,id});}
  if(items.length>300)fail('导入后目录超过 300 项，请先整理目录。',409);
  const assigned=new Set(existing.keys());let newBytes=0;const mediaMap=new Map(),newMedia=[];
  for(const image of bundle.media){let name=image.info.filename;const old=mediaStore.metadata(name);if(!old&&(fs.existsSync(mediaStore.file(name))||fs.existsSync(mediaStore.file(name)+'.json')))fail('现有图片存档不完整，请先检查素材库。',409);if(old&&hash(fs.readFileSync(mediaStore.file(name)))!==image.digest)name=randomBytes(16).toString('hex')+'.webp';mediaMap.set(image.info.filename,name);if(!old||name!==image.info.filename){newMedia.push({...image,name});newBytes+=image.info.bytes;}}
  const currentMedia=mediaStore.summary();if(currentMedia.count+newMedia.length>2000||currentMedia.bytes+newBytes>2*1024*MB)fail('导入后图片超过当前存储限额。',409);space(dataDir,newBytes*2+16*MB);
  const rewrite=value=>value.replace(/\/media\/([a-f0-9]{32}\.webp)/g,(_,name)=>'/media/'+mediaMap.get(name));
  for(const entry of bundle.records.filter(r=>r.type==='post')){const p=entry.content,duplicate=existing.has(p.slug);if(duplicate&&policy==='skip'){mapping.set(p.slug,p.slug);rows.push({title:p.title,kind:p.kind||'blog',from:p.slug,to:p.slug,action:'skip'});continue;}let slug=p.slug;if(assigned.has(slug))slug=slug.slice(0,60)+'-import-'+randomBytes(5).toString('hex');assigned.add(slug);mapping.set(p.slug,slug);const post=validateRecord({...p,slug,body:rewrite(p.body),cover:p.cover?rewrite(p.cover):'',published:false});newPosts.push(post);rows.push({title:post.title,kind:post.kind,from:p.slug,to:slug,action:duplicate?'copy':'add'});}
  if(posts.length+newPosts.length>TRANSFER_LIMITS.posts)fail('导入后内容超过 5000 条，请分批整理。',409);
  for(const entry of bundle.records.filter(r=>r.type==='editorDraft')){const content=validateEditorContent({...entry.content,slug:'',body:rewrite(entry.content.body),cover:entry.content.cover?rewrite(entry.content.cover):''});newDrafts.push({id:'new-import-'+randomBytes(10).toString('hex'),sourceSlug:null,sourceRevision:null,revision:1,updatedAt:new Date().toISOString(),content});rows.push({title:content.title||'未命名编辑草稿',kind:content.kind,from:entry.sourceSlug||'',to:'',action:'editorDraft'});}
  if(drafts.length+newDrafts.length>100)fail('导入后自动保存草稿超过 100 份，请先整理草稿箱。',409);
  let clearedProjects=0;const all=[...posts,...newPosts];for(const p of [...newPosts,...newDrafts.map(d=>d.content)])if(p.organization){const o=p.organization;for(const [ids,type] of [[o.tags,'tag'],[o.topics,'topic'],[o.series?[o.series]:[],'series']])for(const id of ids)if(!bundle.catalog.items.some(i=>i.id===id&&i.type===type))fail('内容引用的目录不在包内。');p.organization={...o,tags:o.tags.map(id=>orgIds.get(id)),topics:o.topics.map(id=>orgIds.get(id)),series:o.series?orgIds.get(o.series):'',projectSlug:o.projectSlug?mapping.get(o.projectSlug)||o.projectSlug:''};if(p.organization.projectSlug&&(p.kind==='project'||!all.some(v=>v.slug===p.organization.projectSlug&&v.kind==='project'&&!v.trashedAt))){p.organization.projectSlug='';clearedProjects++;}}
  return {before,newPosts,newDrafts,newMedia,nextPosts:[...posts,...newPosts],nextDrafts:[...drafts,...newDrafts],nextCatalog:{schemaVersion:1,revision:catalog.revision+1,items},summary:{rows,posts:newPosts.length,editorDrafts:newDrafts.length,skipped:rows.filter(r=>r.action==='skip').length,media:newMedia.length,catalog:items.length-catalog.items.length,history:bundle.records.filter(r=>r.type==='history').length,clearedProjects}};
 }
 return {
  initialize,maintenance,
  exportZip:()=>locked(()=>exportContentZip(dataDir)),
  preview(req,owner,policy='skip'){return locked(async()=>{maintenance();for(const [token,plan] of plans)if(plan.owner===owner){fs.rmSync(plan.job,{recursive:true,force:true});plans.delete(token);}if(plans.size>=1)fail('另一登录窗口正在确认内容包，请先取消或稍后再试。',429);const job=fs.mkdtempSync(path.join(root,'import-'));fs.chmodSync(job,0o700);try{
   if(!['application/zip','application/octet-stream','application/x-zip-compressed'].includes(String(req.headers['content-type']).split(';')[0]))fail('请选择本站导出的 ZIP 内容包。',415);if(Number(req.headers['content-length'])>TRANSFER_LIMITS.zipBytes)fail('内容包超过 2200 MB。',413);space(dataDir,Math.max(64*MB,Number(req.headers['content-length'])||0)*2);
   const file=path.join(job,'upload.zip');let bytes=0;await pipeline(req,new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>TRANSFER_LIMITS.zipBytes)callback(Object.assign(new Error('内容包超过 2200 MB。'),{status:413}));else callback(null,chunk);}}),fs.createWriteStream(file,{mode:0o600,flags:'wx'}));
   const bundle=await unpack(file,job),plan=buildPlan(bundle,policy),token=randomBytes(16).toString('hex'),expiresAt=Date.now()+TRANSFER_LIMITS.expiresMs;plans.set(token,{...plan,job,owner,expiresAt});return {token,expiresAt,exportedAt:bundle.exportedAt,...plan.summary};
  }catch(error){fs.rmSync(job,{recursive:true,force:true});throw error;}});},
  confirm(input,owner){maintenance();if(active)fail('正在处理内容包，请稍后再试。',429);const plan=plans.get(input?.token);if(!plan||plan.owner!==owner)fail('导入预览已失效，请重新选择内容包。',409);if(input.confirm!==true)fail('请先确认导入预览。');mediaStore.assertIdle();if(plan.before!==state())fail('内容、目录或图片已变化，请重新预览再导入。',409);
   const changes=[];for(const image of plan.newMedia){changes.push({name:'media/'+image.name,file:image.file},{name:'media/'+image.name+'.json',value:json({...image.info,filename:image.name,url:'/media/'+image.name})});}
   if(plan.newPosts.length)changes.push({name:'posts.json',value:json(plan.nextPosts)});if(plan.newDrafts.length)changes.push({name:'editor-drafts.json',value:json({schemaVersion:1,drafts:plan.nextDrafts})});if(plan.summary.catalog)changes.push({name:'organization.json',value:json(plan.nextCatalog)});
   try{if(changes.length)commitFiles(dataDir,changes,{fault});return {...plan.summary,rows:undefined,published:false};}finally{plans.delete(input.token);fs.rmSync(plan.job,{recursive:true,force:true});}
  },
  cancel(token,owner){const plan=plans.get(token);if(plan?.owner===owner){fs.rmSync(plan.job,{recursive:true,force:true});plans.delete(token);}return {cancelled:true};},
 };
}
