import {isPublicRecord,validRecordSlug} from './island-content.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function contentDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d))?$/.test(value))return '';
 const day=value.slice(0,10),date=Date.parse(day+'T00:00:00Z');if(!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==day)return '';
 if(value.length===10)return day;
 if(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)return '';
 const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toISOString():'';
}
export function articleSEO(post,{url,updatedAt}={}){
 if(!isPublicRecord(post)||!validRecordSlug(post.slug))return null;
 try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/notes/'+encodeURIComponent(post.slug))return null;
 const published=contentDate(post.date),modified=contentDate(updatedAt);return {url:u.href,origin:u.origin,type:post.kind==='blog'?'BlogPosting':'Article',published,modified:modified&&Date.parse(modified)<=Date.now()?modified:''};
 }catch{return null;}
}
export function breadcrumbs(post,seo){
 if(!seo)return '';
 const links=[['首页',seo.origin+'/'],['全部记录',seo.origin+'/notes'],[post.title,seo.url]];
 return '<nav class="reader-breadcrumbs" aria-label="当前位置" itemscope itemtype="https://schema.org/BreadcrumbList"><ol>'+links.map(([name,url],i)=>'<li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem"><a itemprop="item" href="'+escape(url)+'"><span itemprop="name">'+escape(name)+'</span></a><meta itemprop="position" content="'+(i+1)+'"></li>').join('')+'</ol></nav>';
}
export function sitemapXML(origin,records,now=Date.now()){
 const root=new URL(origin).origin,seen=new Set(),pages=['/','/notes','/nantan','/about','/privacy'].map(path=>({url:root+path}));
 for(const p of records){if(!isPublicRecord(p)||!validRecordSlug(p.slug)||seen.has(p.slug))continue;seen.add(p.slug);const date=contentDate(p.updatedAt)||contentDate(p.date);pages.push({url:root+'/notes/'+encodeURIComponent(p.slug),lastmod:date&&Date.parse(date)<=now?date:''});}
 return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+pages.map(p=>'<url><loc>'+escape(p.url)+'</loc>'+(p.lastmod?'<lastmod>'+escape(p.lastmod)+'</lastmod>':'')+'</url>').join('')+'</urlset>';
}
