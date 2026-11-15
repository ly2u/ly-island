import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {scryptSync} from 'node:crypto';
import {createMarkdownRenderer} from '../markdown-renderer.mjs';
import {highlightCode} from '../code-highlighter.mjs';
import {CODE_LANGUAGES,codeLanguage,validCodeLanguage} from '../public/rqly/code-policy.mjs';
const render=createMarkdownRenderer(),code='\t# 中文 <tag> & "quotes"\nvalue = 42\nprint("世界")\n',source='```python\n'+code+'```';let groups=0,server;
const text=html=>html.replace(/<[^>]*>/g,'').replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const content=html=>text(html.match(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/)[1]);
let html=render(source);assert.equal(content(html),code);assert(html.includes('hljs-number'));assert(html.includes('hljs-string'));assert(html.includes('data-code-language="python"'));assert(!html.includes('<button'));groups++;
for(const alias of ['py','PYTHON','python3'])assert.equal(codeLanguage(alias).id,'python');assert.equal(codeLanguage('html').id,'xml');assert.equal(codeLanguage('c++').id,'cpp');assert(!validCodeLanguage('python\n'));assert.equal(codeLanguage('constructor').id,'text');assert.equal(codeLanguage('__proto__').id,'text');groups++;
for(const lang of CODE_LANGUAGES){const result=highlightCode(code,lang.id,{});assert.equal(text(result.html),code);assert.equal(result.language,lang.id);}
assert.equal(content(render('```not-a-language\n'+code+'```')),code);assert(!render('```not-a-language\n'+code+'```').includes('hljs-number'));groups++;
for(const info of ['python" onclick="alert(1)','<script>','javascript onmouseover=alert(1)']){const result=render('```'+info+'\nconst s = "</script><img src=x onerror=alert(1)>";\n```');assert(!/<(?:script|img|iframe|button)\b/.test(result));assert(!/<[a-z][^>]*\s(?:onerror|onclick|onmouseover|style)=/i.test(result));}
assert(!render('```latex\n$qL^2$\n```').includes('<math'));assert(!render('`print(42)`').includes('code-block'));groups++;
assert(!highlightCode('x'.repeat(20001),'python',{}).html.includes('<span'));assert(!highlightCode('x = 42\n','python',{codeChars:50000}).html.includes('<span'));assert(!highlightCode('x = 42\n','python',{codeBlocks:200}).html.includes('<span'));groups++;
const mapped=render(source,{sourceMap:true});assert(mapped.includes('<pre tabindex="0" data-source-start="0" data-source-end="4">'));assert.equal(content(mapped),code);assert.equal(content(render(source.replace(/\n/g,'\r\n'))),code);assert.equal(content(render('    x = 42\n\n')), 'x = 42\n');groups++;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ly-code-'));
try{
 Object.assign(process.env,{DATA_DIR:dir,NODE_ENV:'test',ADMIN_USERNAME:'ly',ADMIN_PASSWORD_HASH:'scrypt:code:'+scryptSync('fixture-only-password','code',64).toString('hex')});const {handler,initializeData}=await import('../server.mjs');initializeData();server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const headers={'Content-Type':'application/json',Origin:base,'X-Requested-With':'rqly-editor'},login=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({username:'ly',password:'fixture-only-password'})});assert.equal(login.status,200);headers.Cookie=login.headers.get('set-cookie').split(';')[0];headers['X-CSRF-Token']=(await login.json()).csrfToken;
 let response=await fetch(base+'/api/admin/preview',{method:'POST',headers,body:JSON.stringify({body:source})});assert.equal(response.status,200);assert.equal((await response.json()).html,mapped);groups++;
 response=await fetch(base+'/api/admin/posts',{method:'POST',headers,body:JSON.stringify({slug:'code-example',kind:'note',title:'代码示例',body:source,published:true})});assert.equal(response.status,200);const before=fs.readFileSync(path.join(dir,'posts.json'));
 const article=await(await fetch(base+'/notes/code-example')).text();assert(article.includes(html));assert(article.includes('reader-page.mjs?v=code-tools-v1'));assert.equal(content((await(await fetch(base+'/api/posts/code-example')).json()).html),code);
 for(const asset of ['/code-blocks.mjs','/code-policy.mjs','/reader-client.mjs'])assert.equal((await fetch(base+asset)).status,200);assert.equal((await fetch(base+'/code-highlighter.mjs')).status,404);assert.deepEqual(fs.readFileSync(path.join(dir,'posts.json')),before);groups++;
 console.log(groups+' code-block groups passed: safe pinned language grammars, exact whitespace/Unicode, finite markup, unknown/large-code fallback, source maps, preview/article equivalence, assets and no GET writes.');
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}fs.rmSync(dir,{recursive:true,force:true});}
