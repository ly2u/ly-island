// 复现：文章数增长时 /api/posts、/api/search、/api/admin/search 的耗时。用法：node bench-list-endpoints.mjs <rqly-sites 目录> <文章数> [正文字数]。只使用临时数据目录，不触碰生产数据。需要真实 sharp 依赖已安装（npm ci）。
// Usage: node bench.mjs <path-to-sites-copy> <N posts> [bodyChars]
// Measures response time of list/search endpoints as the number of published posts grows.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {scryptSync} from 'node:crypto';
const root=path.resolve(process.argv[2]),N=Number(process.argv[3]),bodyChars=Number(process.argv[4]||4000);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'exp-bench-'));
Object.assign(process.env,{DATA_DIR:dir,NODE_ENV:'test',ADMIN_USERNAME:'ly',ADMIN_PASSWORD_HASH:'scrypt:s:'+scryptSync('pw-for-bench-123','s',64).toString('hex')});
const {handler,initializeData}=await import(path.join(root,'server.mjs'));
initializeData();
const unit='桥梁建造与有限元模型的校核记录，拉索、桥墩、主梁分别核对。';
const posts=Array.from({length:N},(_,i)=>({slug:'post-'+i,title:'记录 '+i+' 桥梁',summary:'摘要 '+i,body:unit.repeat(Math.ceil(bodyChars/unit.length)).slice(0,bodyChars),topic:['记录','工程','探索'][i%3],kind:['note','blog','project'][i%3],date:'2026-0'+(1+i%9)+'-1'+(i%9),cover:'',published:true,updatedAt:new Date(Date.now()-i*1000).toISOString(),...(i%3===2?{project:{status:'active',role:'',period:''}}:{})}));
fs.writeFileSync(path.join(dir,'posts.json'),JSON.stringify(posts));
const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const H={'Content-Type':'application/json','X-Requested-With':'rqly-editor','Origin':base};
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:H,body:JSON.stringify({username:'ly',password:'pw-for-bench-123'})});
const cookie=login.headers.get('set-cookie').split(';')[0];
const time=async(label,url,opts={})=>{const ts=[];let status=0;for(let i=0;i<3;i++){const t=performance.now();const r=await fetch(base+url,opts);status=r.status;await r.arrayBuffer();ts.push(performance.now()-t);}ts.sort((a,b)=>a-b);return {label,status,ms:Math.round(ts[1])};};
const rows=[];
rows.push(await time('GET /api/posts (public, no login)','/api/posts'));
rows.push(await time('GET /api/search?q=桥 (public)','/api/search?q='+encodeURIComponent('桥')));
rows.push(await time('GET /notes (list page)','/notes'));
rows.push(await time('GET /notes/post-0 (one article)','/notes/post-0'));
rows.push(await time('GET /api/admin/search?q=桥 (admin)','/api/admin/search?q='+encodeURIComponent('桥'),{headers:{...H,Cookie:cookie}}));
const size=fs.statSync(path.join(dir,'posts.json')).size;
console.log(`N=${N} posts, body=${bodyChars} chars, posts.json=${(size/1048576).toFixed(2)} MB`);
for(const r of rows)console.log('  '+r.label.padEnd(40),String(r.status).padEnd(4),r.ms+' ms');
fs.rmSync(dir,{recursive:true,force:true});process.exit(0);
