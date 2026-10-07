import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {scryptSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rqly-check-'));
process.env.DATA_DIR=tmp;process.env.NODE_ENV='test';process.env.ADMIN_USERNAME='ly';process.env.ADMIN_PASSWORD_HASH='scrypt:test-salt:'+scryptSync('test-only-password','test-salt',64).toString('hex');
const {handler,initializeData,readPosts,markdown,renderRqly,renderQizui,normalizeAI}=await import('../server.mjs');
const {EXAMPLE_TEXT,reviewRules}=await import('../public/qizui/review-core.mjs');
const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
let checks=0;const pass=()=>checks++;const headers={'Content-Type':'application/json','X-Requested-With':'qizui','Origin':base};const adminHeaders={...headers,'X-Requested-With':'rqly-editor'};
let provider;
try{
 initializeData();
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:adminHeaders,body:JSON.stringify({username:'ly',password:'test-only-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');assert(cookie.includes('HttpOnly')&&cookie.includes('SameSite=Strict')&&cookie.includes('Path=/'));assert(!login.headers.has('www-authenticate'));const authData=await login.json();adminHeaders.Cookie=cookie.split(';')[0];adminHeaders['X-CSRF-Token']=authData.csrfToken;
 assert.equal((await fetch(base+'/api/auth/session')).status,200);assert.equal((await(await fetch(base+'/api/auth/session')).json()).authenticated,false);assert.equal((await(await fetch(base+'/api/auth/session',{headers:adminHeaders})).json()).authenticated,true);assert.equal(fs.statSync(path.join(tmp,'admin-sessions.json')).mode&0o777,0o600);assert(!fs.readFileSync(path.join(tmp,'admin-sessions.json'),'utf8').includes(cookie.split(';')[0].split('=')[1]));pass();
 
 for(const file of ['server.mjs','island-store.mjs','admin-auth.mjs','public/rqly/login.js','public/rqly/admin.js','public/qizui/qizui.js','public/qizui/review-core.mjs','scripts/setup.mjs'])execFileSync(process.execPath,['--check',file],{cwd:root,stdio:'pipe'});pass();
 for(const route of ['/','/notes','/notes?topic=工程','/nantan','/about','/notes/start-with-a-note','/qizui/','/site.css','/qizui/qizui.js','/qizui/review-core.mjs','/feed.xml','/sitemap.xml']){const r=await fetch(base+route);assert.equal(r.status,200,route);const text=await r.text();assert(!text.includes('{{RECENT_POSTS}}'));}pass();
 const neutral=renderRqly('/notes','<img src=x onerror=alert(1)>');assert(!neutral.includes('<img src=x'));assert(neutral.includes('所有记录'));pass();
 const html=markdown('<script>alert(1)</script>\n\n[点击](javascript:alert)\n\n[文档](https://example.com)');assert(!html.includes('<script>'));assert(!html.includes('href="javascript:'));assert(html.includes('https://example.com'));pass();
 assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/content/posts.json')).status,404);assert.equal((await fetch(base+'/admin',{redirect:'manual'})).status,302);assert.equal((await fetch(base+'/login')).status,200);assert.equal((await fetch(base+'/api/admin/posts')).status,401);pass();
 const post={slug:'test-new-record',title:'测试记录',topic:'工程',date:'2026-10-04',summary:'验证草稿与发布。',body:'## 新记录\n\n一条完整的测试记录。',published:false};let r=await fetch(base+'/api/admin/posts',{method:'POST',headers:adminHeaders,body:JSON.stringify(post)});assert.equal(r.status,200);assert.equal((await fetch(base+'/notes/'+post.slug)).status,404);assert(readPosts().some(p=>p.slug===post.slug));pass();
 assert.equal((await fetch(base+'/api/posts/'+post.slug)).status,404);assert.equal((await fetch(base+'/api/posts/not-a-public-record')).status,404);assert.equal((await fetch(base+'/qizui/api/posts/start-with-a-note')).status,404);assert.equal((await fetch(base+'/api/posts/start-with-a-note',{method:'POST'})).status,405);pass();
 const revision=(await (await fetch(base+'/api/admin/posts',{headers:adminHeaders})).json()).posts.find(p=>p.slug===post.slug).revision;r=await fetch(base+'/api/admin/posts',{method:'PUT',headers:{...adminHeaders,'If-Match':revision},body:JSON.stringify({...post,published:true})});assert.equal(r.status,200);assert.equal((await fetch(base+'/notes/'+post.slug)).status,200);assert(fs.readdirSync(path.join(tmp,'backups')).length>0);const publicRecord=await fetch(base+'/api/posts/'+post.slug);assert.equal(publicRecord.status,200);const readable=await publicRecord.json();assert.equal(readable.post.body,post.body);assert.equal(readable.post.published,true);assert(readable.html.includes('一条完整的测试记录'));assert.equal(publicRecord.headers.get('cache-control'),'no-store');pass();
 r=await fetch(base+'/api/admin/posts',{method:'POST',headers:adminHeaders,body:JSON.stringify({...post,published:true})});assert.equal(r.status,409);pass();
 r=await fetch(base+'/api/admin/posts',{method:'PUT',headers:{...adminHeaders,Origin:'https://untrusted.example'},body:JSON.stringify(post)});assert.equal(r.status,403);pass();

 // Unified CMS: automatic metadata, revisions, private drafts, recoverable deletion.
 const mutate=async(method,route,body,revision)=>fetch(base+route,{method,headers:{...adminHeaders,...(revision?{'If-Match':revision}:{})},...(body?{body:JSON.stringify(body)}:{})});
 for(const kind of ['note','blog','project']){
  const value={title:'A '+kind,body:'## Test\n\nOnly temporary data.',kind,published:false,...(kind==='project'?{project:{status:'done',role:'Engineer',period:'2026'}}:{})};
  r=await mutate('POST','/api/admin/posts',value);assert.equal(r.status,200);let created=(await r.json()).post;assert(created.slug.startsWith(kind+'-'));assert(created.summary&&created.date&&created.revision);assert.equal((await fetch(base+'/api/posts/'+created.slug)).status,404);
  assert.equal((await mutate('PUT','/api/admin/posts',created)).status,428);
  const stale=created.revision;r=await mutate('PUT','/api/admin/posts',{...created,published:true},stale);assert.equal(r.status,200);created=(await r.json()).post;
  assert.equal((await mutate('PUT','/api/admin/posts',{...created,title:'stale'},stale)).status,409);
  const pub=(await (await fetch(base+'/api/posts/'+created.slug)).json()).post;assert.equal(pub.kind,kind);assert(!pub.revision&&!pub.updatedAt);if(kind==='project')assert.equal(pub.project.status,'done');
  r=await mutate('DELETE','/api/admin/posts/'+created.slug,null,created.revision);assert.equal(r.status,200);created=(await r.json()).post;assert(created.trashedAt);assert.equal((await fetch(base+'/api/posts/'+created.slug)).status,404);
  assert.equal((await mutate('PUT','/api/admin/posts',{...created,title:'trash edit'},created.revision)).status,409);
  r=await mutate('POST','/api/admin/posts/'+created.slug+'/restore',null,created.revision);assert.equal(r.status,200);created=(await r.json()).post;assert(!created.published&&!created.trashedAt);assert.equal((await fetch(base+'/api/posts/'+created.slug)).status,404);
 }pass();
 assert.equal((await mutate('POST','/api/admin/posts',{title:'Bad',body:'Test',summary:42})).status,400);pass();
 // Island state: validation and optimistic concurrency; saved state survives reinitialization.
 assert.equal((await fetch(base+'/api/admin/island')).status,401);assert.equal((await fetch(base+'/qizui/api/island')).status,404);
 let state=(await (await fetch(base+'/api/island')).json()).island;assert.equal(state.revision,0);assert.equal(fs.statSync(path.join(tmp,'island.json')).mode&0o777,0o600);
 const saveIsland=value=>mutate('PUT','/api/admin/island',{baseRevision:state.revision,island:value});
 let bad=structuredClone(state);bad.layouts.initial.library=[99,99];assert.equal((await saveIsland(bad)).status,400);
 bad=structuredClone(state);bad.layouts.initial.library=bad.layouts.initial.projects;assert.equal((await saveIsland(bad)).status,400);
 state.title='A saved island';state.layouts.initial.library=[-2.4,1.4];r=await saveIsland(state);assert.equal(r.status,200);const saved=(await r.json()).island;assert.equal(saved.revision,1);assert.equal((await saveIsland(state)).status,409);initializeData();
 assert.deepEqual((await (await fetch(base+'/api/island')).json()).island,saved);assert(fs.readdirSync(path.join(tmp,'backups')).some(name=>name.startsWith('island-')));pass();
 const input={text:EXAMPLE_TEXT,audience:'旅游与交通跨界受众',duration:25,engine:'rules'};r=await fetch(base+'/qizui/api/review',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(r.status,200);const rules=(await r.json()).result;assert.equal(rules.method,'rules');assert.equal(Object.keys(rules.roles).length,3);pass();
 r=await fetch(base+'/qizui/api/review',{method:'POST',headers,body:JSON.stringify({...input,text:'太短'})});assert.equal(r.status,400);r=await fetch(base+'/qizui/api/review',{method:'POST',headers,body:JSON.stringify({...input,text:'x'.repeat(12001)})});assert.equal(r.status,400);pass();
 r=await fetch(base+'/qizui/api/review',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:JSON.stringify(input)});assert.equal(r.status,403);pass();
 delete process.env.AI_API_KEY;delete process.env.AI_MODEL;r=await fetch(base+'/qizui/api/review',{method:'POST',headers,body:JSON.stringify({...input,engine:'ai'})});assert.equal(r.status,503);pass();
 const ai=structuredClone(reviewRules(input));for(const role of Object.values(ai.roles))role.rewrite='这是接口测试中的表达参考。';
 let called=0;provider=http.createServer(async(req,res)=>{let chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));assert.equal(req.url,'/v1/chat/completions');assert.equal(body.messages[0].role,'system');assert.equal(body.response_format.type,'json_object');assert(body.messages[1].content.includes('presentationMinutes'));called++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(ai)}}]}));});await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));process.env.AI_BASE_URL='http://127.0.0.1:'+provider.address().port+'/v1';process.env.AI_API_KEY='test-only-key';process.env.AI_MODEL='test-only-model';process.env.REVIEW_ACCESS_TOKEN='test-only-access';process.env.AI_HOURLY_PER_IP='1';
 r=await fetch(base+'/qizui/api/config');const config=await r.json();assert(config.aiEnabled&&config.tokenRequired);r=await fetch(base+'/qizui/api/review',{method:'POST',headers,body:JSON.stringify({...input,engine:'ai'})});assert.equal(r.status,401);assert.equal(called,0);pass();
 r=await fetch(base+'/qizui/api/review',{method:'POST',headers:{...headers,Authorization:'Bearer test-only-access'},body:JSON.stringify({...input,engine:'ai'})});assert.equal(r.status,200);const result=(await r.json()).result;assert.equal(result.method,'ai');assert(result.roles.editor.rewrite);assert.equal(called,1);assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'ai-meter.json'),'utf8')).count,1);pass();
 r=await fetch(base+'/qizui/api/review',{method:'POST',headers:{...headers,Authorization:'Bearer test-only-access'},body:JSON.stringify({...input,engine:'ai'})});assert.equal(r.status,429);assert.equal(called,1);pass();
 assert.throws(()=>normalizeAI({roles:{expert:{assessment:'不完整'}}}));pass();
 for(const route of ['/','/notes','/nantan','/about',...readPosts().filter(p=>p.published).map(p=>'/notes/'+p.slug)])assert(!/\{\{[A-Z_]+\}\}/.test(renderRqly(route)));assert(!/\{\{[A-Z_]+\}\}/.test(renderQizui()));pass();

 // Cookie authentication: logout, CSRF, cross-origin, revocation, expiry and credential changes.
 assert.equal((await fetch(base+'/api/admin/posts',{headers:{Authorization:'Basic '+Buffer.from('ly:test-only-password').toString('base64')}})).status,401);
 assert.equal((await fetch(base+'/api/admin/preview',{method:'POST',headers:{...adminHeaders,'X-CSRF-Token':''},body:JSON.stringify({body:'Test'})})).status,403);
 assert.equal((await fetch(base+'/api/auth/logout',{method:'POST',headers:{...adminHeaders,Origin:'https://untrusted.example'}})).status,403);
 assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:JSON.stringify({username:'ly',password:'test-only-password'})})).status,403);
 const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:adminHeaders});assert.equal(logout.status,200);assert(logout.headers.get('set-cookie').includes('Max-Age=0'));assert.equal((await fetch(base+'/api/admin/posts',{headers:adminHeaders})).status,401);assert.equal((await(await fetch(base+'/api/auth/session',{headers:adminHeaders})).json()).authenticated,false);pass();
 const relogin=await fetch(base+'/api/auth/login',{method:'POST',headers:adminHeaders,body:JSON.stringify({username:'ly',password:'test-only-password'})});assert.equal(relogin.status,200);const freshCookie=relogin.headers.get('set-cookie').split(';')[0];adminHeaders.Cookie=freshCookie;adminHeaders['X-CSRF-Token']=(await relogin.json()).csrfToken;
 initializeData();assert.equal((await fetch(base+'/api/admin/posts',{headers:adminHeaders})).status,200);const oldHash=process.env.ADMIN_PASSWORD_HASH;process.env.ADMIN_PASSWORD_HASH+='changed';assert.equal((await fetch(base+'/api/admin/posts',{headers:adminHeaders})).status,401);process.env.ADMIN_PASSWORD_HASH=oldHash;
 const sessionPath=path.join(tmp,'admin-sessions.json');const db=JSON.parse(fs.readFileSync(sessionPath));db.sessions.forEach(s=>s.expiresAt=Date.now()-1);fs.writeFileSync(sessionPath,JSON.stringify(db));assert.equal((await fetch(base+'/api/admin/posts',{headers:adminHeaders})).status,401);pass();
 for(let i=0;i<10;i++)assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:adminHeaders,body:JSON.stringify({username:'ly',password:'incorrect'})})).status,401);assert.equal((await fetch(base+'/api/auth/login',{method:'POST',headers:adminHeaders,body:JSON.stringify({username:'ly',password:'incorrect'})})).status,429);pass();

 const {createAdminAuth}=await import('../admin-auth.mjs');const secureDir=path.join(tmp,'secure-auth');fs.mkdirSync(secureDir);const secureAuth=createAdminAuth({dataDir:secureDir,username:()=> 'ly',passwordHash:()=> oldHash,address:()=> 'secure-test',secure:true});secureAuth.initialize();let secureCookie;await secureAuth.login({headers:{}},{setHeader:(name,value)=>{assert.equal(name,'Set-Cookie');secureCookie=value;}},{username:'ly',password:'test-only-password'});assert(secureCookie.includes('; Secure')&&secureCookie.includes('HttpOnly')&&secureCookie.includes('SameSite=Strict'));pass();
 console.log(`${checks} groups of checks passed: routes, authoring persistence, draft visibility, input validation, origin checks, AI auth, provider contract and rate limits.`);
}finally{await new Promise(resolve=>server.close(resolve));if(provider)await new Promise(resolve=>provider.close(resolve));fs.rmSync(tmp,{recursive:true,force:true});}
