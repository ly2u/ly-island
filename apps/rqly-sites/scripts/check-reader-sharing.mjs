import assert from 'node:assert/strict';
import {renderReader} from '../public/rqly/reader-view.mjs';
const post={slug:'shared-article',title:'标题 <img src=x onerror=alert(1)> & "引号"',summary:'摘要',body:'正文',date:'2026-11-26',kind:'note',topic:'工程',published:true};
const canonical='https://example.test/notes/shared-article',signature='站点 & 标志';
const page=renderReader(post,'<h2>第一节</h2><p>正文</p>',{standalone:true,signature,seo:{url:canonical}}),aside=page.match(/<aside class="reader-margin">([\s\S]*?)<\/aside>/)[1];
assert(aside.includes('data-reader-pure-outline'));assert(!aside.includes('<details'));assert(!aside.includes('reader-bookmark'));assert(!aside.includes('reader-share'));assert(!aside.includes('margin-drawing'));assert(page.includes('href="#reading-section-0"'));assert(!page.includes('<img src=x onerror=alert(1)>'));
const shares=[...page.matchAll(/href="(https:\/\/(?:service\.weibo\.com|x\.com)\/[^\"]+)"/g)].map(m=>new URL(m[1].replaceAll('&amp;','&')));assert.equal(shares.length,2);
for(const u of shares){assert.equal(u.searchParams.get('url'),canonical);assert.equal(u.searchParams.get(u.hostname==='x.com'?'text':'title'),post.title+' · '+signature);}
assert(page.includes('data-reader-native-share hidden'));assert(page.includes('data-reader-share>复制链接'));
const preview=renderReader({...post,published:false},'<h2>私人草稿</h2>',{preview:true,standalone:true,seo:{url:canonical}});for(const marker of['article-share','data-reader-native-share','data-reader-share','service.weibo.com','x.com/intent'])assert(!preview.includes(marker));assert(preview.includes('<details class="reader-outline"'));assert(preview.includes('私人预览'));
console.log('Reader rendering passed: pure standalone linked outline, escaped canonical sharing links and titles, capability-gated native share, and private preview sharing isolation.');
