// 复现：图片库 /api/admin/media 与公开图片的耗时。用法：node bench-media-library.mjs <rqly-sites 目录> <文章数> <图片数> <每篇历史版本数>。只使用临时数据目录；图片为假文件，不经过 sharp。
// Usage: node bench2.mjs <sites-copy> <posts> <images> <versionsPerPost>
// Cost of the media list (admin) and of serving one public image, as posts/images/history grow.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {scryptSync,randomBytes} from 'node:crypto';
const root=path.resolve(process.argv[2]),N=+process.argv[3],M=+process.argv[4],V=+process.argv[5];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'exp-bench2-'));
Object.assign(process.env,{DATA_DIR:dir,NODE_ENV:'test',ADMIN_USERNAME:'ly',ADMIN_PASSWORD_HASH:'scrypt:s:'+scryptSync('pw-for-bench-123','s',64).toString('hex')});
const {handler,initializeData}=await import(path.join(root,'server.mjs'));const {createContentHistory}=await import(path.join(root,'content-history.mjs'));
initializeData();fs.mkdirSync(path.join(dir,'media'));
const names=Array.from({length:M},()=>randomBytes(16).toString('hex')+'.webp');
names.forEach((n,i)=>{fs.writeFileSync(path.join(dir,'media',n),Buffer.alloc(30000,i%255));fs.writeFileSync(path.join(dir,'media',n+'.json'),JSON.stringify({filename:n,url:'/media/'+n,width:1200,height:800,bytes:30000,createdAt:new Date(Date.now()-i*1000).toISOString()}));});
const mk=(i,v)=>({slug:'post-'+i,title:'记录 '+i,summary:'s',body:('桥梁记录 v'+v+'。').repeat(300)+(names[i%M]?'\n\n![图](/media/'+names[i%M]+')':''),topic:'记录',kind:'note',date:'2026-01-01',cover:'',published:true,updatedAt:new Date(Date.now()-i*1000+v).toISOString()});
let cur=Array.from({length:N},(_,i)=>mk(i,0));fs.writeFileSync(path.join(dir,'posts.json'),JSON.stringify(cur));
const hist=createContentHistory(dir);for(let v=1;v<=V;v++){const next=cur.map((p,i)=>mk(i,v));hist.captureChanges(cur,next);cur=next;}
fs.writeFileSync(path.join(dir,'posts.json'),JSON.stringify(cur));
const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const H={'Content-Type':'application/json','X-Requested-With':'rqly-editor',Origin:base};
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:H,body:JSON.stringify({username:'ly',password:'pw-for-bench-123'})});const cookie=login.headers.get('set-cookie').split(';')[0];
const time=async(label,url,opts={})=>{const ts=[];let st=0,cc='';for(let i=0;i<3;i++){const t=performance.now();const r=await fetch(base+url,opts);st=r.status;cc=r.headers.get('cache-control')||'';await r.arrayBuffer();ts.push(performance.now()-t);}ts.sort((a,b)=>a-b);return `  ${label.padEnd(44)} ${st}  ${String(Math.round(ts[1])).padStart(6)} ms  Cache-Control: ${cc}`;};
console.log(`posts=${N} images=${M} history versions/post=${V}`);
console.log(await time('GET /media/<one published image> (public)','/media/'+names[0]));
console.log(await time('GET /api/admin/media (admin media library)','/api/admin/media',{headers:{...H,Cookie:cookie}}));
fs.rmSync(dir,{recursive:true,force:true});process.exit(0);
