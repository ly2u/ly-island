import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {scryptSync} from 'node:crypto';import os from 'node:os';import {fileURLToPath} from 'node:url';
const repo=path.resolve(process.env.REVIEW_REPO_ROOT||path.join(path.dirname(fileURLToPath(import.meta.url)),'../..'));
if(fs.existsSync(path.join(repo,'apps/rqly-sites/.env')))throw new Error('Run browser checks in a clean checkout without .env');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'ly-browser-fixture-'));
Object.assign(process.env,{DATA_DIR:data,NODE_ENV:'test',ADMIN_USERNAME:'ly',ADMIN_PASSWORD_HASH:'scrypt:review:'+scryptSync('review-only-password','review',64).toString('hex')});
const {handler,initializeData}=await import(path.join(repo,'apps/rqly-sites/server.mjs'));const {validateRecord,defaultIsland}=await import(path.join(repo,'apps/rqly-sites/island-store.mjs'));initializeData();
const body='| 参数 | 数值 |\n| --- | --- |\n| 跨径 | 30m |\n\n$$ M=\\frac{qL^2}{8} $$\n\n'+Array.from({length:20},(_,i)=>'## 第 '+(i+1)+' 条线索\n\n把过程留在这里，让认识慢慢生长。仅用于隔离浏览器验证。\n').join('\n');
const posts=[{slug:'recent',title:'最近的一页',topic:'记录',kind:'note'},{slug:'older',title:'书屋精选 <img src=x onerror=alert(1)>',topic:'工程',kind:'blog'},{slug:'project',title:'桥梁项目档案',topic:'工程',kind:'project',project:{status:'active'}},{slug:'explore',title:'工坊的一次尝试',topic:'探索',kind:'blog'},{slug:'private',title:'PRIVATE SECRET',topic:'记录',kind:'blog',published:false}].map((p,i)=>({...validateRecord({body,summary:'合成内容，用于检查推荐、阅读与维护。',date:'2026-11-06',published:true,...p}),updatedAt:i===1?'2026-11-01T00:00:00Z':'2026-11-06T00:00:00Z'}));
fs.writeFileSync(path.join(data,'posts.json'),JSON.stringify(posts),{mode:0o600});fs.writeFileSync(path.join(data,'island.json'),JSON.stringify(defaultIsland()),{mode:0o600});
fs.writeFileSync(path.join(data,'site-status.json'),JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),release:{id:'v2026.11.06-123456abcdef',commit:'a'.repeat(40),deployedAt:new Date().toISOString()},backup:{lastSucceededAt:new Date().toISOString(),lastRestoreVerifiedAt:new Date().toISOString(),archive:'ly-stack-20261106T120000Z.tar.gz'}}),{mode:0o600});
const root=path.join(repo,'apps/ly-island-preview/dist');const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://review');res.setHeader('X-LY-Review','isolated-fixture');
 if(url.pathname==='/__review'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({fixture:'ly-island-product-review',version:1}));}
 if(url.pathname==='/'||url.pathname.startsWith('/island/')){
  const file=path.join(root,url.pathname==='/'||url.pathname==='/island/'?'index.html':url.pathname.slice(8));
  if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end('not found');}
  const ext=path.extname(file);res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[ext]||'application/octet-stream');res.setHeader('cache-control','no-store');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  let data=fs.readFileSync(file);if(ext==='.js'&&data.includes(Buffer.from('this.renderer.render(this.scene,this.camera)')))data=Buffer.from(data.toString().replace('this.renderer.render(this.scene,this.camera)','this.renderer.render(this.scene,this.camera),window.__island=this'));
  return res.end(data);
 }
 handler(req,res);
});server.listen(Number(process.env.REVIEW_PORT||0),'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,fixture:'ly-island-product-review'})));
process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>{fs.rmSync(data,{recursive:true,force:true});process.exit(0);});});
