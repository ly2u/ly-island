// Recover only genuine local saved snapshots; never change posts or editor drafts.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createContentHistory,historyContent} from '../content-history.mjs';
const directory=path.resolve(process.env.DATA_DIR||'/app/data'),current=JSON.parse(fs.readFileSync(path.join(directory,'posts.json'),'utf8'));
if(!Array.isArray(current))throw new Error('当前记录格式无效。');
const existing=new Map(current.map(p=>[p.slug,p])),store=createContentHistory(directory),backup=path.join(directory,'backups');
const files=fs.existsSync(backup)?fs.readdirSync(backup).filter(name=>/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]+\.json$/.test(name)).sort():[];
const snapshots=[];for(const name of files){const records=JSON.parse(fs.readFileSync(path.join(backup,name),'utf8'));if(!Array.isArray(records))throw new Error('旧保存记录格式无效。');for(const post of records){if(!existing.has(post.slug)||JSON.stringify(existing.get(post.slug))===JSON.stringify(post))continue;historyContent(post);snapshots.push(post);}}
const ids=new Set(store.references().map(v=>v.id)),unique=[];for(const post of snapshots){const id=createHash('sha256').update(JSON.stringify(post)).digest('hex');if(ids.has(id))continue;ids.add(id);unique.push(post);}
if(process.argv.includes('--apply'))for(const post of unique)store.captureChanges([post],current,'本机旧保存记录');
console.log(JSON.stringify({mode:process.argv.includes('--apply')?'applied':'read-only',availableSnapshots:unique.length,sourceFiles:files.length,productionContentChanged:false}));
