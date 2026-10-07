// 复现：缺失的白名单静态文件会让进程退出。用法：node crash-missing-static.mjs <rqly-sites 目录的【副本】>。会临时改名 public/rqly/ai.css；进程崩溃时它会停留在 ai.css.gone，请手动改回，所以务必在副本里运行。
// Usage: node crash.mjs <path-to-sites-copy>
// Question: if an allowlisted static file is unreadable at request time, does the process survive?
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
const root=path.resolve(process.argv[2]);
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'exp-crash-'));process.env.NODE_ENV='test';
const {handler,initializeData}=await import(path.join(root,'server.mjs'));
initializeData();
const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const ok=await fetch(base+'/ai.css');console.log('before: /ai.css ->',ok.status);await ok.arrayBuffer();
const target=path.join(root,'public/rqly/ai.css');
fs.renameSync(target,target+'.gone');            // simulate: file vanishes mid-deploy / bad copy
try{const r=await fetch(base+'/ai.css');console.log('after removal: /ai.css ->',r.status);await r.arrayBuffer();}catch(e){console.log('after removal: request failed:',e.cause?.code||e.message);}
await new Promise(r=>setTimeout(r,400));
try{const h=await fetch(base+'/healthz');console.log('healthz after ->',h.status);}catch(e){console.log('healthz after failed:',e.cause?.code||e.message);}
console.log('PROCESS SURVIVED');
fs.renameSync(target+'.gone',target);process.exit(0);
