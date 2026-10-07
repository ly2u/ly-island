import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {scryptSync} from 'node:crypto';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ly-static-check-'));Object.assign(process.env,{DATA_DIR:folder,NODE_ENV:'test',CODEX_BRIDGE_SOCKET:'',ADMIN_USERNAME:'ly',ADMIN_PASSWORD_HASH:'scrypt:static-check:'+scryptSync('static-test-password','static-check',64).toString('hex')});
const {handler,initializeData}=await import('../server.mjs');initializeData();const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
try{
 for(const route of ['/admin-organization.js','/missing-resource.js','/.env','/node_modules/sharp/package.json']){const response=await fetch(base+route);assert.equal(response.status,404,route);await response.arrayBuffer();assert.equal((await fetch(base+'/healthz')).status,200,'Unknown resource must not terminate the server');}
 for(const route of ['/admin.js','/organization-core.mjs','/favicon.svg','/qizui/qizui.js']){const response=await fetch(base+route,{method:'HEAD'});assert.equal(response.status,200,route);assert.equal((await response.arrayBuffer()).byteLength,0);}
 assert.equal((await fetch(base+'/api/posts')).status,200);console.log('Static route resilience passed: missing resources return 404, service survives and HEAD assets remain available.');
}finally{await new Promise(r=>server.close(r));fs.rmSync(folder,{recursive:true,force:true});}
