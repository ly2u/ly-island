import {validCodeLanguage} from '../../rqly-sites/public/rqly/code-policy.mjs';
import {defaultPresentation} from '../../rqly-sites/public/rqly/presentation-core.mjs';
import {articleLink,inPlaceClick} from '../../rqly-sites/public/rqly/navigation.mjs';
import {setupReader} from '../../rqly-sites/public/rqly/reader-client.mjs';
import {renderReader,bookDrawing,bridgeDrawing,flowDrawing} from '../../rqly-sites/public/rqly/reader-view.mjs';
import {HTML_TAGS,MATH_TAGS,ARTICLE_CLASSES,MATH_ATTRIBUTES,validMathAttribute,validArticleLink} from '../../rqly-sites/public/rqly/article-policy.mjs';
import '../../rqly-sites/public/rqly/writing.css';
import {seriesRecords} from '../../rqly-sites/public/rqly/organization-core.mjs';
import {recommendedRecords,readingPositions,relatedRecords,recordRoom,roomRecords,knowledgeBooks,belongsToRoom,isArticle,findCategoryBook,categoryLabel} from '../../rqly-sites/public/rqly/island-content.mjs';
import './organization.css';
import './rooms.css';
import {renderSearch,highlightArticleMatches} from './search.js';
import {renderPostOffice} from './postoffice.js';

const names={library:'书屋',projects:'工程展馆',workshop:'工坊',about:'岛主',postoffice:'信箱',blog:'最近文章',search:'搜索'};
const captions={library:'THE READING HOUSE',projects:'THE ENGINEERING GALLERY',workshop:'THE MAKER’S WORKBENCH',about:'THE ISLAND KEEPER',postoffice:'THE ISLAND POST OFFICE',blog:'ISLAND JOURNAL',search:'FIND A RECORD'};



const wordsDrawing='<svg viewBox="0 0 290 155" fill="none" aria-hidden="true"><rect x="61" y="18" width="122" height="120" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M77 37h65m-65 16h90m-90 16h70m-70 16h90m-90 16h53m-53 16h81m30-8 38-65 12 7-38 65-15 10 3-17Z" stroke="currentColor" stroke-width="1.5"/><circle cx="221" cy="29" r="12" stroke="currentColor"/><path d="m216 29 4 4 7-8" stroke="currentColor" stroke-width="1.5"/></svg>';
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function illustration(svg,cls){const e=el('div',cls);e.innerHTML=svg;return e;}
function button(text,cls,click){const b=el('button',cls,text);b.type='button';b.addEventListener('click',click);return b;}
function readStored(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function safeLink(value){try{const u=new URL(value,location.origin);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;if(['/bridge.jpg','/rqly/bridge.jpg'].includes(decodeURIComponent(u.pathname)))return null;return u;}catch{return null;}}
// Rebuild the server-rendered public Markdown using a narrow DOM allowlist.
// Only our uploaded /media images may be reconstructed; scripts and event attributes are dropped.
export function articleFragment(html){
 const template=document.createElement('template');template.innerHTML=html;
 const allowed=new Set(HTML_TAGS.filter(tag=>tag!=='img')),mathTags=new Set(MATH_TAGS);
 const clean=node=>{
  if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent);
  const fragment=document.createDocumentFragment();if(node.nodeType!==Node.ELEMENT_NODE)return fragment;
  if(node.tagName==='IMG'){
   let url;try{url=new URL(node.getAttribute('src'),location.origin);}catch{return fragment;}
   if(url.origin!==location.origin||!/^\/media\/[a-f0-9]{32}\.webp$/.test(url.pathname)||url.search||url.hash)return fragment;
   const image=document.createElement('img');image.src=url.pathname;image.alt=(node.getAttribute('alt')||'').slice(0,250);image.loading='lazy';image.decoding='async';image.className='content-image';
   for(const dimension of ['width','height']){const value=Number(node.getAttribute(dimension));if(Number.isInteger(value)&&value>0&&value<=2400)image.setAttribute(dimension,String(value));}return image;
  }
  const tag=node.tagName.toLowerCase();
  if(['script','style','iframe','object','svg','annotation-xml','maction'].includes(tag))return fragment;
  const out=mathTags.has(tag)?document.createElementNS('http://www.w3.org/1998/Math/MathML',tag):allowed.has(tag)?document.createElement(tag):fragment;
  if(mathTags.has(tag)){for(const name of MATH_ATTRIBUTES){const value=node.getAttribute(name);if(value!==null&&validMathAttribute(name,value))out.setAttribute(name,value);}}
  if(out.nodeType===Node.ELEMENT_NODE){const classes=(node.getAttribute('class')||'').split(/\s+/).filter(value=>ARTICLE_CLASSES.includes(value));if(classes.length)out.setAttribute('class',classes.join(' '));if(tag==='ol'&&/^\d{1,6}$/.test(node.getAttribute('start')||''))out.setAttribute('start',node.getAttribute('start'));if(tag==='div'&&classes.includes('content-table')){out.setAttribute('role','region');out.setAttribute('tabindex','0');out.setAttribute('aria-label','数据表格，可横向滚动');}}
  if(tag==='pre'&&node.getAttribute('tabindex')==='0')out.setAttribute('tabindex','0');
  if(tag==='div'&&out.nodeType===Node.ELEMENT_NODE&&out.classList.contains('code-block')&&validCodeLanguage(node.getAttribute('data-code-language')))out.setAttribute('data-code-language',node.getAttribute('data-code-language'));
  if(node.tagName==='A'){
   const href=node.getAttribute('href'),url=validArticleLink(href)?safeLink(href):null;
   if(url){out.href=url.href;if(url.origin!==location.origin){out.target='_blank';out.rel='noopener noreferrer';}}
  }
  for(const child of node.childNodes)out.append(clean(child));return out;
 };
 const result=document.createDocumentFragment();for(const node of template.content.childNodes)result.append(clean(node));return result;
}
function coverImage(post,cls){if(!/^\/media\/[a-f0-9]{32}\.webp$/.test(post.cover||''))return null;const image=el('img',cls);image.src=post.cover;image.alt=post.title+' 封面';image.loading='lazy';image.decoding='async';return image;}
export class IslandRooms {
 get presentation(){return this.callbacks.island?.()?.presentation||defaultPresentation();}
 get names(){return Object.fromEntries(Object.entries(names).map(([id,name])=>[id,this.callbacks.island?.()?.buildings?.[id]?.name||(id==='postoffice'?this.presentation.spaces.mailboxName:null)||name]));}
 constructor(callbacks){
  this.baseTitle=document.title;this.callbacks=callbacks;this.room=null;this.slug=null;this.libraryMode='list';this.token=0;this.pending=null;this.font=Math.max(16,Math.min(22,Number(readStored('ly-island-reader-font',18))||18));this.positions=readingPositions(readStored('ly-island-reading-v1',{}));
  this.dialog=el('dialog','island-room');this.dialog.id='room-dialog';this.dialog.setAttribute('aria-labelledby','room-name');
  this.dialog.innerHTML='<div class="room-window"><header class="room-top"><button class="room-home" id="room-close" aria-label="收起阅读空间，回到浮空岛">← <span>回到岛上</span></button><div class="room-heading"><span id="room-caption"></span><h2 id="room-name"></h2></div><nav class="room-switcher" aria-label="切换岛内空间"></nav><a class="room-expand" id="room-expand" hidden>全页打开 ↗</a><button class="room-close-icon" aria-label="关闭阅读空间">×</button></header><div class="room-scroll" tabindex="-1"><div class="room-content"></div></div><footer class="room-bottom"><span class="room-location">LY · 私人的小世界</span><span class="room-footer-hint">把写下的日子，放进书架</span><span class="room-coordinate">ISLAND / 01</span></footer></div>';
  document.body.append(this.dialog);this.content=this.dialog.querySelector('.room-content');this.scroll=this.dialog.querySelector('.room-scroll');
  for(const id of Object.keys(names).filter(id=>id!=='blog')){const b=button(names[id],'room-tab',()=>this.open(id));b.dataset.room=id;this.dialog.querySelector('.room-switcher').append(b);}
  this.dialog.querySelector('#room-close').addEventListener('click',()=>this.close());this.dialog.querySelector('.room-close-icon').addEventListener('click',()=>this.close());
  this.dialog.addEventListener('cancel',e=>{e.preventDefault();this.close();});this.dialog.addEventListener('click',e=>{if(e.target===this.dialog)this.close();});
  this.scroll.addEventListener('scroll',()=>this.saveProgress(),{passive:true});
  window.addEventListener('popstate',()=>this.sync());window.addEventListener('hashchange',()=>this.sync());
  window.addEventListener('pagehide',()=>{this.saveProgress();this.flushProgress();});
  window.addEventListener('storage',event=>{if(event.key==='ly-island-reading-v1'||event.key===null){this.positions=readingPositions(readStored('ly-island-reading-v1',{}));this.callbacks.readingChanged?.();}});
  queueMicrotask(()=>this.sync());
 }
 open(room,slug=null,collection=null,book=null){const q=new URLSearchParams({room});if(slug)q.set('article',slug);if(collection||(slug&&room===this.room&&this.collectionId))q.set('collection',collection||this.collectionId);if(room==='library'&&(book||slug&&room===this.room&&this.bookId))q.set('book',book||this.bookId);this.navigate('#'+q.toString());}
 openCollection(id){this.open('search',null,id);}

 close(){this.navigate('');}
 navigate(hash){if(location.hash!==hash)history.pushState({islandRoom:true},'',location.pathname+location.search+hash);this.sync();}
 sync(){
  const q=new URLSearchParams(location.hash.slice(1)),room=q.get('room'),slug=q.get('article'),collection=q.get('collection'),book=room==='library'?q.get('book'):null;
  if(!Object.hasOwn(names,room)){this.token++;this.pending?.abort();this.saveProgress();this.room=null;this.slug=null;if(this.dialog.open)this.dialog.close();document.body.classList.remove('room-open');this.callbacks.selection(null);document.title=this.baseTitle;return;}
  if(this.dialog.open&&room===this.room&&slug===this.slug&&collection===this.collectionId&&book===this.bookId)return;
  this.saveProgress();this.token++;this.pending?.abort();this.room=room;this.slug=slug;this.collectionId=collection;this.bookId=book;document.title=this.names[room]+' · '+this.baseTitle;
  this.dialog.dataset.room=room;this.dialog.classList.toggle('has-article',Boolean(slug));document.body.classList.add('room-open');
  this.dialog.querySelector('#room-name').textContent=this.names[room];this.dialog.querySelector('#room-caption').textContent=captions[room];
  this.dialog.querySelector('.room-location').textContent=this.presentation.owner.name+' · '+this.presentation.home.brand;this.dialog.querySelector('.room-footer-hint').textContent=this.presentation.home.footer;
  this.dialog.querySelector('.room-coordinate').textContent='ISLAND / '+({library:'01',projects:'02',workshop:'03',about:this.presentation.home.symbol,postoffice:'POST',blog:'JOURNAL',search:'FIND'}[room]);
  for(const tab of this.dialog.querySelectorAll('.room-tab')){tab.textContent=this.names[tab.dataset.room];tab.setAttribute('aria-current',tab.dataset.room===(room==='blog'?'about':room)?'page':'false');}
  this.callbacks.selection(room);if(!this.dialog.open)this.dialog.showModal();
  this.updateExpandLink();
  if(slug)this.readArticle(slug);else if(collection)this.renderDirectory(collection);else if(room==='search')this.searchCollection();else if(room==='postoffice')this.readPostOffice();else if(room==='about')this.readAbout();else if(room==='blog')this.renderBlog();else this.collection();
 }
 updateExpandLink(){
  const link=this.dialog.querySelector('#room-expand');if(!link)return;
  const href=this.slug?'/notes/'+encodeURIComponent(this.slug):this.room==='library'?(this.bookId?'/notes?book='+encodeURIComponent(this.bookId):this.libraryMode==='books'?'/notes?view=books':'/notes'):this.room==='projects'?'/notes?kind=project':this.room==='about'?'/about':this.room==='blog'?'/blog':'';
  link.hidden=!href;if(href)link.href=href;
 }
 refresh(){if(!this.room)return;this.dialog.querySelector('#room-name').textContent=this.names[this.room];for(const tab of this.dialog.querySelectorAll('.room-tab'))tab.textContent=this.names[tab.dataset.room];if(this.slug)return;if(this.collectionId)this.renderDirectory(this.collectionId);else if(this.room==='search')this.searchCollection();else if(this.room==='postoffice')this.readPostOffice();else if(this.room==='about')this.readAbout();else if(this.room==='blog')this.renderBlog();else this.collection();}
 renderBlog(){
  this.content.replaceChildren();this.scroll.scrollTop=0;const p=this.presentation,head=el('header','journal-heading');head.append(el('p','room-eyebrow','ARTICLES / '+p.owner.name),el('h1','',p.spaces.blog),el('p','',p.spaces.blogIntro));this.content.append(head);
  const posts=roomRecords(this.callbacks.posts(),'blog');if(this.callbacks.failed?.()){this.content.append(el('p','room-empty','文章暂未读取到，请稍后再试。'),button('重新读取','room-action',()=>this.callbacks.retry?.()));return;}if(!this.callbacks.loaded()){this.content.append(el('p','room-empty','正在读取最近文章…'));return;}
  renderSearch(this,'blog');const list=el('div','journal-timeline');for(const post of posts){const card=articleLink('','journal-entry',post.slug,()=>this.open('blog',post.slug));card.dataset.article=post.slug;const time=el('time','journal-date',post.date);time.dateTime=post.date;card.append(time,el('h2','',post.title),el('p','',post.summary));const cover=coverImage(post,'journal-cover');if(cover)card.append(cover);card.append(el('span','journal-open','阅读文章 →'));list.append(card);}if(!posts.length)list.append(this.empty('还没有公开文章，可以先认识岛主。'));this.content.append(list);
 }
 renderLibrary(){
  const posts=roomRecords(this.callbacks.posts(),'library'),books=knowledgeBooks(posts);if(!this.callbacks.loaded()){this.content.append(this.empty('正在整理文章…'));return;}if(this.bookId){this.renderNotebook(books);return;}
  const switcher=el('nav','owner-section-tabs');switcher.setAttribute('aria-label','文章视图');
  for(const [mode,label]of [['list','全部文章'],['books','分类书架']]){const b=button(label,'',()=>{if(this.libraryMode!==mode){this.libraryMode=mode;this.updateExpandLink();this.collection();this.scroll.scrollTop=0;}});b.setAttribute('aria-current',this.libraryMode===mode?'page':'false');switcher.append(b);}
  this.content.append(switcher);
  renderSearch(this,'library');
  if(this.libraryMode==='list'){
   if(books.length){const chips=el('nav','library-book-chips');chips.setAttribute('aria-label','按分类查看');for(const book of books){const chip=el('a','directory-chip',book.title+' · '+book.notes.length);chip.href='/notes?book='+encodeURIComponent(book.id);chip.addEventListener('click',e=>{if(!inPlaceClick(e))return;e.preventDefault();this.open('library',null,null,book.id);});chips.append(chip);}this.content.append(chips);}
   const list=el('div','notebook-list');
   for(const [i,p]of posts.entries()){const a=articleLink('','notebook-row',p.slug,()=>this.open('library',p.slug));a.dataset.article=p.slug;a.append(el('span','notebook-number',String(i+1).padStart(2,'0')),el('div'));a.lastChild.append(el('small','',categoryLabel(p)+' · '+p.date),el('h3','',p.title),el('p','',p.summary));list.append(a);}
   if(!posts.length)list.append(this.empty('文章还在整理中，可以先逛逛工程展馆或工坊。'));
   this.content.append(list);return;
  }
  const shelf=el('div','knowledge-shelf');shelf.dataset.style=this.presentation.reading.libraryView==='notes'?'catalog':'shelf';
  for(const [i,book]of books.entries()){const card=el('a','category-book');card.href='/notes?book='+encodeURIComponent(book.id);card.dataset.book=book.id;card.style.setProperty('--book-index',i%3);card.append(el('span','book-edition','NO. '+String(i+1).padStart(2,'0')+' · 分类书'),el('h2','',book.title),el('p','',book.description||'按分类整理的笔记与资料。'),illustration(bookDrawing,'cover-drawing'),el('span','category-book-count',book.notes.length+' 篇文章 · 打开目录 →'));card.addEventListener('click',e=>{if(!inPlaceClick(e))return;e.preventDefault();this.open('library',null,null,book.id);});shelf.append(card);}
  if(!books.length)shelf.append(el('p','room-empty','分类书架还在整理。发布文章后，对应分类会成为一本书。'));
  this.content.append(shelf);
 }
 renderNotebook(books){const book=findCategoryBook(books,this.bookId);const back=button('← 返回全部文章','room-text-action',()=>this.open('library'));this.content.append(back);if(!book){this.content.append(el('h2','','这本书暂时没有公开文章'),el('p','room-empty','分类可能已调整，或其中的笔记尚未公开。'));return;}const head=el('header','notebook-heading');head.append(el('p','room-eyebrow','BOOK / 分类文章'),el('h2','',book.title),el('p','',book.description),el('small','',book.notes.length+' 篇公开文章'));this.content.append(head);renderSearch(this,'library',{book:book.id});const list=el('div','notebook-list');for(const [i,p]of book.notes.entries()){const a=articleLink('','notebook-row',p.slug,()=>this.open('library',p.slug,null,book.id));a.dataset.article=p.slug;a.append(el('span','notebook-number',String(i+1).padStart(2,'0')),el('div'));a.lastChild.append(el('h3','',p.title),el('p','',p.summary),el('small','',p.date));list.append(a);}this.content.append(list);}

 renderRecommendations(){
  const {recommendations,curated}=recommendedRecords(this.callbacks.posts(),this.callbacks.island?.(),this.room);if(!recommendations.length)return;
  const section=el('section','room-recommendations');section.setAttribute('aria-label',curated?'岛主精选':'最近记录');
  const head=el('header');head.append(el('h2','',curated?'先从这几篇认识这里':'最近留在这里的记录'),el('span','',curated?'岛主精选 / PICKED FOR YOU':'最近更新 / LATEST'));section.append(head);
  const grid=el('div','recommended-grid');for(const post of recommendations){const card=articleLink('','recommended-record',post.slug,()=>this.open(this.room,post.slug));card.dataset.article=post.slug;card.append(el('span','',({note:'笔记',blog:'最近文章',project:'项目'}[post.kind||'blog'])+' · '+post.date),el('h3','',post.title),el('p','',post.summary),el('small','','翻开这条记录 →'));grid.append(card);}section.append(grid);this.content.append(section);
 }
 readPostOffice(){this.scroll.scrollTop=0;this.pending?.abort();this.pending=new AbortController();renderPostOffice(this.content,this.pending.signal,this.presentation.spaces);}
 async readAbout(){
  if(this.aboutData){this.renderAbout(this.aboutData);return;}const token=++this.token;this.pending?.abort();const controller=new AbortController();this.pending=controller;const timeout=setTimeout(()=>controller.abort(),8000);this.content.replaceChildren(el('p','room-empty','正在读岛主留下的介绍…'));
  try{const response=await fetch('/about',{signal:controller.signal});if(!response.ok)throw new Error('介绍暂时没有读取到。');const html=await response.text();const source=new DOMParser().parseFromString(html,'text/html');const content=source.querySelector('.about-content'),heading=source.querySelector('.page-title h1');if(!content||!heading)throw new Error('介绍暂时无法打开。');if(token!==this.token)return;const clone=content.cloneNode(true);clone.querySelector('.about-actions')?.remove();this.aboutData={title:heading.textContent,html:clone.innerHTML};this.renderAbout(this.aboutData);}
  catch(error){if(token!==this.token)return;const notice=el('section','reading-error');notice.setAttribute('role','status');notice.append(el('h2','','岛主的介绍，稍后再读'),el('p','',error.name==='AbortError'?'读取超时，可以重新打开。':error.message),button('重新读取','room-action',()=>this.readAbout()));const fallback=el('a','room-text-action','打开文字版介绍 →');fallback.href='/about';notice.append(fallback);this.content.replaceChildren(notice);}
  finally{clearTimeout(timeout);}
 }
 renderAbout(data){
  this.content.replaceChildren();this.scroll.scrollTop=0;const layout=el('div','keeper-layout');const identity=el('aside','keeper-identity');identity.append(el('p','room-eyebrow','THE ISLAND KEEPER'),illustration('<svg viewBox="0 0 240 270" fill="none" aria-hidden="true"><ellipse cx="120" cy="237" rx="86" ry="13" fill="#6b8066" opacity=".08"/><path d="M48 198h144v28H48z" fill="#d7d2bf"/><path d="M43 191h154v12H43z" fill="#ebe6d3"/><path d="m38 144 80-19 81 16v43l-81-12-80 14z" fill="#8b6852"/><path d="m43 135 75-19 76 18v42l-76-13-75 14z" fill="#f4eddb" stroke="#c8c3a7" stroke-width="2"/><path d="M118 117v46m-62-21 46-11m-46 22 46-10m-46 21 46-10m31-22 47 9m-47 2 47 9m-47 2 47 9" stroke="#b6b69a" stroke-width="2"/><path d="m128 154 44-75 10 6-44 75-12 8z" fill="#718875"/><path d="m172 79 6-9 10 6-6 9" fill="#d9c69e"/><path d="m128 154-2 14 12-8" fill="#d6b477"/><path d="m104 164-1 24 10-6 3 5v-22" fill="#a47f5d"/></svg>','keeper-portrait'),el('h2','',this.presentation.owner.name),el('p','keeper-signature',this.presentation.owner.tagline),el('p','keeper-caption',this.presentation.owner.caption));
  const paper=el('article','keeper-paper');const head=el('header','keeper-heading');head.append(el('p','room-eyebrow','ABOUT / '+this.presentation.owner.name),el('h1','',data.title));paper.append(head);const body=el('div','keeper-body');body.append(articleFragment(data.html));paper.append(body);const end=el('footer','keeper-end');const endActions=el('div','keeper-end-actions');endActions.append(button('给岛主写信 →','room-text-action',()=>this.open('postoffice')),button('走进书屋 →','room-text-action',()=>this.open('library')));end.append(el('span','',this.presentation.home.footer),endActions);paper.append(end);layout.append(identity,paper);this.content.append(layout);
 }
 collection(){
  this.content.replaceChildren();this.scroll.scrollTop=0;const posts=this.callbacks.posts();
  if(this.callbacks.failed?.()){const notice=el('div','collection-error');notice.setAttribute('role','status');notice.append(el('p','','公开记录暂时没有取到，请稍后再试。'),button('重新读取记录','room-action',()=>this.callbacks.retry?.()));this.content.append(notice);}
  const intro=el('section','collection-intro');intro.append(el('p','room-eyebrow',this.room==='library'?'一本一本，慢慢积累':this.room==='projects'?'工程档案 / FIELD NOTES':'工作台 / IN PROGRESS'));
  intro.append(el('h1','',this.presentation.spaces[this.room]));
  intro.append(el('p','collection-description',this.callbacks.island?.()?.buildings?.[this.room]?.description||(this.room==='library'?'挑一本，翻开看看。读完之后，小岛还在窗外。':this.room==='projects'?'这里收录项目档案与工程实践过程，会随实践逐步补齐。':'桌上放着正在使用的工具，也留着每次尝试的手记。')));this.content.append(intro);if(this.room==='library'){if(this.bookId)this.content.replaceChildren();this.renderLibrary();return;}const vacant=this.callbacks.loaded()&&!this.callbacks.failed?.()&&roomRecords(posts,this.room).length===0;if(vacant){this.content.append(this.emptyGuide());if(this.room!=='workshop')return;}if(this.room!=='workshop')this.renderRecommendations();if(!vacant)renderSearch(this,this.room);
  if(this.room==='projects'){
   const wall=el('div','exhibition-wall');const drawing=el('div','engineering-drawing');drawing.append(el('span','drawing-stamp','LY / STRUCTURE STUDY'),illustration(bridgeDrawing,'bridge-drawing'),el('p','drawing-caption','代码绘制的结构概念图 · 不对应实际工程'));const archive=el('div','project-archive');
   const projects=posts.filter(p=>p.kind==='project'),notes=posts.filter(p=>isArticle(p)&&p.topic==='工程');if(projects.length)archive.append(el('h2','archive-section-title','项目档案'));for(const [i,p] of projects.entries())archive.append(this.exhibitCard(p,i));if(notes.length)archive.append(el('h2','archive-section-title','工程手记'));for(const [i,p] of notes.entries())archive.append(this.exhibitCard(p,i));if(!archive.children.length)archive.append(this.empty('工程档案会从这里开始积累。'));wall.append(drawing,archive);this.content.append(wall);
  }else{
   const bench=el('div','tool-bench');for(const [index,tool] of this.presentation.tools.filter(t=>t.enabled).entries()){
    const label=String(index+1).padStart(2,'0')+' / 工具与实践',svg=index===0?flowDrawing:wordsDrawing;
    const t=el('article','tool-station');t.append(el('span','room-eyebrow',label),illustration(svg,'tool-drawing'),el('h2','',tool.name),el('p','',tool.detail),el('span','tool-tag',tool.tag));const a=el('a','tool-open','打开工具 ↗');a.href=tool.url;a.target='_blank';a.rel='noopener noreferrer';t.append(a);bench.append(t);
   }this.content.append(bench);this.renderRecommendations();const log=el('section','workshop-log');log.append(el('h2','','研发手记'));for(const p of posts.filter(p=>isArticle(p)&&p.topic==='探索')){const b=articleLink(p.title,'workshop-entry',p.slug,()=>this.open(this.room,p.slug));b.dataset.search=(p.title+' '+p.summary).toLowerCase();b.append(el('span','',p.date+' →'));log.append(b);}this.content.append(log);
  }
 }
 emptyGuide(){
  const section=el('section','collection-guide');section.setAttribute('aria-label','这个空间的下一步');
  section.append(el('h2','',this.room==='library'?'书架还在慢慢整理':this.room==='projects'?'工程档案，等待下一次公开记录':'工具先放在这里，手记慢慢补上'),el('p','',this.room==='library'?'这里暂时没有公开文章。可以先认识岛主，或到工坊看看正在使用的工具。':this.room==='projects'?'这里暂时没有公开的项目或工程手记。先逛逛书屋，或认识留下记录的人。':'这里暂时没有公开手记，下方的 CivilFlow 与七嘴工具入口仍可使用。'));
  const actions=el('div','collection-guide-actions');actions.append(button('认识岛主 →','',()=>this.open('about')),button(this.room==='library'?'去工坊看看 →':'走进书屋 →','',()=>this.open(this.room==='library'?'workshop':'library')));section.append(actions);return section;
 }
 searchCollection(){this.content.replaceChildren();this.scroll.scrollTop=0;const intro=el('section','collection-intro search-heading');intro.append(el('p','room-eyebrow','SEARCH / 小岛里的记录'),el('h1','','从一个词，找回一段记录。'),el('p','collection-description','搜索公开文章与项目。标题、摘要、正文和项目资料都能找到；多个关键词用空格分开。'));this.content.append(intro);this.renderDirectoryIndex();renderSearch(this);}
 empty(text){return el('p','room-empty',text);}
 exhibitCard(p,index){
  const b=articleLink('','exhibit-card',p.slug,()=>this.open(this.room,p.slug));b.dataset.search=(p.title+' '+p.summary).toLowerCase();b.dataset.article=p.slug;const photo=coverImage(p,'archive-cover');if(photo)b.append(photo);b.append(el('span','archive-number','档案 / '+String(index+1).padStart(2,'0')),el('span','archive-type'+(p.kind==='project'?' project':''),p.kind==='project'?'项目 · '+({planning:'计划中',active:'进行中',done:'已完成'}[p.project?.status]||'进行中'):'工程手记'),el('h2','',p.title),el('p','',p.summary));const meta=el('div','archive-meta');meta.append(el('span','',p.date),el('span','','展开档案 →'));b.append(meta);return b;
 }
 async readArticle(slug){
  const token=this.token;this.scroll.scrollTop=0;this.content.replaceChildren(el('div','room-empty','正在翻开这一页…'));const controller=new AbortController();this.pending=controller;const timeout=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch('/api/posts/'+encodeURIComponent(slug),{signal:controller.signal});if(!response.ok){if(response.status===404&&token===this.token){delete this.positions[slug];this.flushProgress();}throw new Error(response.status===404?'这篇记录还未公开或已移走。':'暂时没有取到正文，请再试一次。');}const data=await response.json();
   if(token!==this.token)return;const p=data.post;if(!p||p.published!==true||p.slug!==slug||typeof p.body!=='string'||typeof data.html!=='string')throw new Error('这篇记录暂时无法打开。');
   if(this.room!=='search'&&!belongsToRoom(p,this.room)){const q=new URLSearchParams({room:recordRoom(p),article:slug});history.replaceState(history.state,'',location.pathname+location.search+'#'+q);this.sync();return;}this.renderArticle(p,data.html);
  }catch(error){if(token!==this.token)return;const empty=el('div','reading-error');empty.setAttribute('role','status');empty.append(el('h2','','这一页暂时没有翻开'),el('p','',error.name==='AbortError'?'正文读取超时，请再试一次。':error.message),button('重新打开','room-action',()=>this.readArticle(slug)),button('回到'+this.names[this.room],'room-text-action',()=>this.open(this.room)));this.content.replaceChildren(empty);}
  finally{clearTimeout(timeout);}
 }
 renderArticle(p,html){
  this.readerTools?.dispose();document.title=p.title+' · '+this.baseTitle;this.content.innerHTML=renderReader(p,'',{room:this.room,author:this.presentation.owner.name,signature:this.presentation.home.brand});
  const surface=this.content.querySelector('.reader-surface'),body=surface.querySelector('.article-body');body.append(articleFragment(html));this.spread=surface.querySelector('.reader-spread');
  const firstMatch=highlightArticleMatches(body,this.searchStates?.get(this.room==='search'?'':this.room==='library'&&this.bookId?'library:'+this.bookId:this.room)?.q||'');
  this.readerTools=setupReader(surface,{scrollElement:this.scroll,initialFont:this.font,onFont:size=>{this.font=size;},onBack:()=>this.open(this.room,null,this.collectionId,this.bookId),onCollection:id=>this.openCollection(id),onRecord:(slug,room)=>this.open(room||this.room,slug)});
  const records=this.room==='library'&&this.bookId?(findCategoryBook(knowledgeBooks(this.callbacks.posts()),this.bookId)?.notes||[]):p.organizationDetails?.series?seriesRecords(this.callbacks.posts(),p.organizationDetails.series.id):this.room==='search'?this.callbacks.posts():roomRecords(this.callbacks.posts(),this.room),at=records.findIndex(item=>item.slug===p.slug),neighbours=surface.querySelector('.reading-neighbours');
  for(const [item,label] of [[records[at-1],'← 上一篇'],[records[at+1],'下一篇 →']])if(item)neighbours.append(articleLink(label+' · '+item.title,'',item.slug,()=>this.open(this.room,item.slug)));
  this.renderRelatedRecords(p,surface.querySelector('[data-reader-related]'));
  const saved=Math.max(0,Math.min(1,Number(this.positions[p.slug]?.ratio)||0));requestAnimationFrame(()=>{if(this.slug!==p.slug)return;this.scroll.scrollTop=saved*(this.scroll.scrollHeight-this.scroll.clientHeight);if(firstMatch)firstMatch.scrollIntoView({block:'center'});this.saveProgress();this.scroll.focus({preventScroll:true});});
 }

 publicDirectories(){const items=new Map();for(const p of this.callbacks.posts()){const d=p.organizationDetails;if(!d)continue;for(const item of [...d.tags,...d.topics,...(d.series?[d.series]:[])])items.set(item.id,item);}return [...items.values()];}
 renderDirectoryIndex(){const items=this.publicDirectories();if(!items.length)return;const section=el('section','island-directories');section.append(el('h2','','沿着一个主题，继续阅读。'));for(const type of ['topic','series','tag']){const group=el('div','directory-group');for(const item of items.filter(i=>i.type===type)){const b=button(({tag:'#',topic:'分类 · ',series:'系列 · '}[type])+item.name,'directory-chip',()=>this.openCollection(item.id));b.dataset.collection=item.id;group.append(b);}if(group.children.length)section.append(group);}this.content.append(section);}
 renderDirectory(id){this.content.replaceChildren();this.scroll.scrollTop=0;const item=this.publicDirectories().find(i=>i.id===id);if(!item){this.content.append(el('h1','','这里还没有公开内容'),el('p','room-empty',this.callbacks.loaded()?'这个目录已移走，或暂时只有未发布的记录。':'正在整理公开目录…'),button('回到书屋','room-action',()=>this.open('library')));return;}
 const intro=el('section','collection-intro');intro.append(button('← 回到书屋','room-text-action',()=>this.open('library')),el('p','room-eyebrow',{tag:'TAG / 标签',topic:'CATEGORY / 分类',series:'SERIES / 连续阅读'}[item.type]),el('h1','',item.name));if(item.description)intro.append(el('p','collection-description',item.description));this.content.append(intro);const records=item.type==='series'?seriesRecords(this.callbacks.posts(),id):this.callbacks.posts().filter(p=>(p.organization?.tags||[]).includes(id)||(p.organization?.topics||[]).includes(id));const list=el('div','directory-records');intro.append(el('p','',records.length+' 条公开记录'+(item.type==='series'?' · 按阅读顺序排列':'')));for(const [index,p] of records.entries()){const b=articleLink('','directory-record',p.slug,()=>this.open(recordRoom(p),p.slug));b.dataset.article=p.slug;b.append(el('span','directory-number',item.type==='series'?String(index+1).padStart(2,'0'):p.date),el('div'));b.lastChild.append(el('h2','',p.title),el('p','',p.summary),el('small','',(p.kind==='project'?'项目':'文章')+' · '+p.date));list.append(b);}this.content.append(list);}
 renderArticleOrganization(p,paper){const d=p.organizationDetails;if(!d)return;const bar=el('nav','article-organization');bar.setAttribute('aria-label','内容归属');for(const item of [...d.tags,...d.topics,...(d.series?[d.series]:[])])bar.append(button(({tag:'#',topic:'分类 · ',series:'系列 · '}[item.type])+item.name,'directory-chip',()=>this.openCollection(item.id)));if(d.project)bar.append(button('项目 · '+d.project.title,'directory-chip',()=>this.open('projects',d.project.slug)));if(bar.children.length)paper.append(bar);}
 renderRelatedRecords(p,paper){const all=this.callbacks.posts(),d=p.organizationDetails,sections=[];if(d?.series)sections.push({title:'系列 · '+d.series.name,records:seriesRecords(all,d.series.id)});if(p.kind==='project')sections.push({title:'这个项目的记录',records:all.filter(item=>item.organization?.projectSlug===p.slug)});else if(d?.project)sections.push({title:'同一项目的记录',records:all.filter(item=>item.organization?.projectSlug===d.project.slug&&item.slug!==p.slug)});
 const shown=new Set(sections.flatMap(section=>section.records.map(item=>item.slug))),related=relatedRecords(p,all,all.length).filter(item=>!shown.has(item.slug)).slice(0,3);if(related.length)sections.push({title:'沿着这些线索，继续读',records:related});
 for(const {title,records} of sections){if(!records.length)continue;const section=el('section','related-records');section.append(el('h2','',title));for(const [index,item] of records.entries()){if(item.slug===p.slug){const current=el('p','related-current',String(index+1).padStart(2,'0')+' · '+item.title+'（正在阅读）');current.setAttribute('aria-current','page');section.append(current);}else{const b=articleLink(item.title,'related-record',item.slug,()=>this.open(recordRoom(item,this.room),item.slug));b.dataset.article=item.slug;b.append(el('span','',item.date+' →'));section.append(b);}}paper.append(section);}
 }
 setFont(size){this.font=Math.max(16,Math.min(22,size));this.spread?.style.setProperty('--reading-size',this.font+'px');try{localStorage.setItem('ly-island-reader-font',JSON.stringify(this.font));}catch{}this.saveProgress();}
 saveProgress(){
  if(!this.slug||!this.dialog.open||!this.content.querySelector('.reader-paper'))return;
  const max=this.scroll.scrollHeight-this.scroll.clientHeight;const ratio=max>5?Math.max(0,Math.min(1,this.scroll.scrollTop/max)):1;
  this.positions[this.slug]={ratio,updated:Date.now(),room:this.room};const label=this.content.querySelector('.reader-progress-label'),fill=this.content.querySelector('.reading-fill');if(label)label.textContent=Math.round(ratio*100)+'%';if(fill)fill.style.width=ratio*100+'%';
  clearTimeout(this.storeTimer);this.storeTimer=setTimeout(()=>this.flushProgress(),150);
 }
 flushProgress(){clearTimeout(this.storeTimer);this.positions=readingPositions(this.positions);try{localStorage.setItem('ly-island-reading-v1',JSON.stringify(this.positions));}catch{}this.callbacks.readingChanged?.();}
 clearReadingHistory(){clearTimeout(this.storeTimer);this.positions={};try{localStorage.removeItem('ly-island-reading-v1');}catch{}this.callbacks.readingChanged?.();}
}
