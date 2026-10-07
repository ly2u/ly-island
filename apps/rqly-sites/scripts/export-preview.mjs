import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.argv.push('--preview');
const {ROOT,initializeData,readPosts,renderRqly,renderQizui}=await import('../server.mjs');initializeData();
const target=path.resolve(process.argv.find((x,i)=>i>1&&!x.startsWith('--'))||path.join(ROOT,'preview'));fs.mkdirSync(target,{recursive:true});
const mainCSS=fs.readFileSync(path.join(ROOT,'public/rqly/site.css'),'utf8');const toolCSS=fs.readFileSync(path.join(ROOT,'public/qizui/qizui.css'),'utf8');
const photo='data:image/jpeg;base64,'+fs.readFileSync(path.join(ROOT,'public/rqly/bridge.jpg')).toString('base64');
const mainFavicon='data:image/svg+xml,'+encodeURIComponent(fs.readFileSync(path.join(ROOT,'public/rqly/favicon.svg'),'utf8'));
const toolFavicon='data:image/svg+xml,'+encodeURIComponent(fs.readFileSync(path.join(ROOT,'public/qizui/favicon.svg'),'utf8'));
const routes=['/','/notes','/notes?topic=记录','/notes?topic=工程','/notes?topic=探索','/nantan','/about',...readPosts().filter(p=>p.published).map(p=>'/notes/'+p.slug)];
const pages={};for(const route of routes){const url=new URL(route,'https://rqly.com');let html=renderRqly(url.pathname,url.searchParams.get('topic')||'');let body=html.match(/<body>([\s\S]*)<\/body>/)[1];body=body.replaceAll('src="/bridge.jpg"',`src="${photo}"`).replaceAll('href="/bridge.jpg"',`href="${photo}"`).replaceAll('href="/qizui/"','href="qizui-preview.html"');body=body.replace(/href="(\/(?:notes|about|nantan)[^"]*|\/)"/g,(_,href)=>`href="#${href}"`);body=body.replace('<a href="/feed.xml">RSS</a>','<span>RSS · 上线后可订阅</span>');pages[route]={title:html.match(/<title>(.*?)<\/title>/)[1],body};}
const data=JSON.stringify(pages).replaceAll('<','\\u003c');
const router=`const pages=JSON.parse(document.getElementById('preview-pages').textContent);function show(){const route=decodeURIComponent(location.hash.startsWith('#/')?location.hash.slice(1):'/');const page=pages[route]||pages['/'];document.title=page.title;document.body.innerHTML=page.body;window.scrollTo(0,0);}window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#/'))show();});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show,{once:true});else show();`;
const main=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>记录与求索 · LY</title><link rel="icon" href="${mainFavicon}"><style>${mainCSS}</style><script id="preview-pages" type="application/json">${data}</script><script defer>${router}</script></head><body>${pages['/'].body}</body></html>`;
fs.writeFileSync(path.join(target,'rqly-preview.html'),main);
const core=fs.readFileSync(path.join(ROOT,'public/qizui/review-core.mjs'),'utf8').replace(/^export /gm,'');let script=fs.readFileSync(path.join(ROOT,'public/qizui/qizui.js'),'utf8').replace(/^import .*\n/,'');script=script.replace("if(location.protocol!=='file:')","if(false)");
let tool=renderQizui().replace('<link rel="stylesheet" href="./qizui.css">',`<style>${toolCSS}</style>`).replace('<link rel="icon" href="./favicon.svg" type="image/svg+xml">',`<link rel="icon" href="${toolFavicon}">`).replace('<script type="module" src="./qizui.js"></script>','').replaceAll('href="/"','href="rqly-preview.html"').replace('href="./"','href="qizui-preview.html"');tool=tool.replace('</body>',`<script>(()=>{${core}\n${script}})();</script></body>`);fs.writeFileSync(path.join(target,'qizui-preview.html'),tool);
console.log(JSON.stringify({files:[path.join(target,'rqly-preview.html'),path.join(target,'qizui-preview.html')]}));
