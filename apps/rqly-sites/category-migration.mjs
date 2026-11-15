// Explicit, offline metadata repair. GET requests never run this operation.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createOrganizationStore} from './organization-store.mjs';
import {createEditorDraftStore} from './editor-drafts.mjs';
import {commitFiles} from './content-portability.mjs';
import {isArticle} from './public/rqly/island-content.mjs';
import {validateOrganization} from './public/rqly/organization-core.mjs';

const legacy={工程:'engineering',探索:'exploration'};
export function migrateLegacyCategories(dataDir,{apply=false,fault}={}){
 if(fs.existsSync(path.join(dataDir,'content-import-transaction')))throw new Error('存在未完成的内容事务，请先恢复，不进行分类修复。');
 const filename=path.join(dataDir,'posts.json');
 for(const name of ['posts.json','organization.json','editor-drafts.json']){
  const file=path.join(dataDir,name);if(!fs.existsSync(file))continue;
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('分类修复只接受普通内容文件。');
 }
 const posts=JSON.parse(fs.readFileSync(filename,'utf8'));if(!Array.isArray(posts))throw new Error('文章存档格式无效。');
 const catalog=createOrganizationStore(dataDir).read(),nextCatalog=structuredClone(catalog),nextPosts=structuredClone(posts);
 const created=[],reused=new Set();let changedRecords=0;
 for(const [index,post]of posts.entries()){
  // An explicit empty classification is the owner's choice. Do not refill it.
  if(!isArticle(post)||post.trashedAt||Object.hasOwn(post,'organization')||!Object.hasOwn(legacy,post.topic))continue;
  const alias=legacy[post.topic],mapped=nextCatalog.legacyBooks?.[alias];
  let category=mapped?nextCatalog.items.find(i=>i.id===mapped&&i.type==='topic'):nextCatalog.items.find(i=>i.type==='topic'&&i.name.normalize('NFKC').toLowerCase()===post.topic.normalize('NFKC').toLowerCase());
  if(!category){
   if(nextCatalog.items.length>=300)throw new Error('分类目录已达上限；修复未写入任何数据。');
   let id;do{id='org-'+randomBytes(8).toString('hex');}while(nextCatalog.items.some(i=>i.id===id));
   category={id,type:'topic',name:post.topic,description:'',archived:false};nextCatalog.items.push(category);created.push(category.name);
  }else reused.add(category.name);
  nextCatalog.legacyBooks={...nextCatalog.legacyBooks,[alias]:category.id};
  nextPosts[index]={...post,organization:validateOrganization({topics:[category.id]})};changedRecords++;
 }
 const drafts=createEditorDraftStore(dataDir).read();
 const report={changedRecords,createdCategories:created,reusedCategories:[...reused],editorDrafts:drafts.length,applied:false};
 if(!apply||!changedRecords)return report;
 if(drafts.length)throw new Error('存在自动保存的编辑草稿；修复未写入任何数据，请先处理草稿版本。');
 nextCatalog.revision++;
 const json=value=>JSON.stringify(value,null,2)+'\n';
 // Reuse the existing fsynced, crash-recoverable content transaction.
 commitFiles(dataDir,[{name:'organization.json',value:json(nextCatalog)},{name:'posts.json',value:json(nextPosts)}],{fault});
 return {...report,applied:true};
}
