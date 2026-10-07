import {seriesRecords} from '../../rqly-sites/public/rqly/organization-core.mjs';
import './organization.css';
import './rooms.css';
import {renderSearch,highlightArticleMatches} from './search.js';
import {renderPostOffice} from './postoffice.js';

const names={library:'书屋',projects:'工程展馆',workshop:'工坊',about:'岛主',postoffice:'信箱',search:'搜索'};
const captions={library:'THE READING HOUSE',projects:'THE ENGINEERING GALLERY',workshop:'THE MAKER’S WORKBENCH',about:'THE ISLAND KEEPER',postoffice:'THE ISLAND POST OFFICE',search:'FIND A RECORD'};
const bookDrawing='<svg viewBox="0 0 240 170" fill="none" aria-hidden="true"><path d="M120 38C92 15 46 22 25 33v103c31-14 66-12 95 7 29-19 64-21 95-7V33c-21-11-67-18-95 5Z" fill="currentColor" fill-opacity=".06" stroke="currentColor" stroke-width="2"/><path d="M120 38v105M39 45c22-7 49-5 66 7m-66 14c22-7 49-5 66 7m-66 14c22-7 49-5 66 7m30-42c17-12 44-14 66-7m-66 28c17-12 44-14 66-7m-66 28c17-12 44-14 66-7M19 49v98c33-12 65-7 101 10 36-17 68-22 101-10V49" stroke="currentColor" stroke-width="1.5"/></svg>';
const bridgeDrawing='<svg viewBox="0 0 600 280" fill="none" aria-hidden="true"><path d="M30 227h540M48 189h504M62 179h476M102 188V65m396 123V65M92 68h20m376 0h20M102 83c96 105 300 105 396 0" stroke="currentColor" stroke-width="3"/><path d="M145 121v57m43-30v30m45-13v13m45-8v8m45-8v8m45-13v13m45-30v30m43-57v57M102 83 48 179m450-96 54 96M84 190l-10 37m46-37 10 37m350-37-10 37m46-37 10 37M48 189l33-10 24 10 25-10 25 10 25-10 25 10 25-10 25 10 25-10 25 10 25-10 25 10 25-10 25 10 25-10 25 10 25-10 33 10" stroke="currentColor" stroke-width="1.4"/><path d="M62 245h476m-476-7v14m476-14v14M559 65v124m-7-124h14m-14 124h14" stroke="currentColor" stroke-width=".8"/><text x="250" y="268" fill="currentColor" font-size="12" letter-spacing="3">STRUCTURE / PROCESS</text></svg>';
const flowDrawing='<svg viewBox="0 0 290 155" fill="none" aria-hidden="true"><path d="M72 39h45v37h48m-93 39h45V76m90 0h32" stroke="currentColor" stroke-width="1.7"/><rect x="22" y="19" width="50" height="40" rx="5" stroke="currentColor"/><rect x="22" y="94" width="50" height="40" rx="5" stroke="currentColor"/><rect x="165" y="55" width="42" height="42" rx="5" stroke="currentColor"/><rect x="239" y="55" width="30" height="42" rx="5" stroke="currentColor"/><circle cx="47" cy="39" r="6" stroke="currentColor"/><path d="m35 115 7 7 16-18m118-26h19m-19 7h13M247 70h14m-14 7h14m-14 7h9" stroke="currentColor" stroke-width="1.5"/></svg>';
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
 const allowed=new Set(['P','H2','H3','H4','UL','OL','LI','BLOCKQUOTE','PRE','CODE','STRONG','EM','A','BR','HR']);
 const clean=node=>{
  if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent);
  const fragment=document.createDocumentFragment();if(node.nodeType!==Node.ELEMENT_NODE)return fragment;
  if(node.tagName==='IMG'){
   let url;try{url=new URL(node.getAttribute('src'),location.origin);}catch{return fragment;}
   if(url.origin!==location.origin||!/^\/media\/[a-f0-9]{32}\.webp$/.test(url.pathname)||url.search||url.hash)return fragment;
   const image=document.createElement('img');image.src=url.pathname;image.alt=(node.getAttribute('alt')||'').slice(0,250);image.loading='lazy';image.decoding='async';image.className='content-image';
   for(const dimension of ['width','height']){const value=Number(node.getAttribute(dimension));if(Number.isInteger(value)&&value>0&&value<=2400)image.setAttribute(dimension,String(value));}return image;
  }
  if(['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH'].includes(node.tagName))return fragment;
  const out=allowed.has(node.tagName)?document.createElement(node.tagName.toLowerCase()):fragment;
  if(node.tagName==='A'){
   const url=safeLink(node.getAttribute('href'));
   if(url){out.href=url.href;if(url.origin!==location.origin){out.target='_blank';out.rel='noopener noreferrer';}}
  }
  for(const child of node.childNodes)out.append(clean(child));return out;
 };
 const result=document.createDocumentFragment();for(const node of template.content.childNodes)result.append(clean(node));return result;
}
function coverImage(post,cls){if(!/^\/media\/[a-f0-9]{32}\.webp$/.test(post.cover||''))return null;const image=el('img',cls);image.src=post.cover;image.alt=post.title+' 封面';image.loading='lazy';image.decoding='async';return image;}
export class IslandRooms {
 get names(){return Object.fromEntries(Object.entries(names).map(([id,name])=>[id,this.callbacks.island?.()?.buildings?.[id]?.name||name]));}
 constructor(callbacks){
  this.callbacks=callbacks;this.room=null;this.slug=null;this.token=0;this.pending=null;this.font=Math.max(16,Math.min(22,Number(readStored('ly-island-reader-font',18))||18));this.positions=readStored('ly-island-reading-v1',{});if(!this.positions||typeof this.positions!=='object'||Array.isArray(this.positions))this.positions={};
  this.dialog=el('dialog','island-room');this.dialog.id='room-dialog';this.dialog.setAttribute('aria-labelledby','room-name');
  this.dialog.innerHTML='<div class="room-window"><header class="room-top"><button class="room-home" id="room-close" aria-label="收起阅读空间，回到浮空岛">← <span>回到岛上</span></button><div class="room-heading"><span id="room-caption"></span><h2 id="room-name"></h2></div><nav class="room-switcher" aria-label="切换岛内空间"></nav><button class="room-close-icon" aria-label="关闭阅读空间">×</button></header><div class="room-scroll" tabindex="-1"><div class="room-content"></div></div><footer class="room-bottom"><span class="room-location">LY · 私人的小世界</span><span class="room-footer-hint">把写下的日子，放进书架</span><span class="room-coordinate">ISLAND / 01</span></footer></div>';
  document.body.append(this.dialog);this.content=this.dialog.querySelector('.room-content');this.scroll=this.dialog.querySelector('.room-scroll');
  for(const id of Object.keys(names)){const b=button(names[id],'room-tab',()=>this.open(id));b.dataset.room=id;this.dialog.querySelector('.room-switcher').append(b);}
  this.dialog.querySelector('#room-close').addEventListener('click',()=>this.close());this.dialog.querySelector('.room-close-icon').addEventListener('click',()=>this.close());
  this.dialog.addEventListener('cancel',e=>{e.preventDefault();this.close();});this.dialog.addEventListener('click',e=>{if(e.target===this.dialog)this.close();});
  this.scroll.addEventListener('scroll',()=>this.saveProgress(),{passive:true});
  window.addEventListener('popstate',()=>this.sync());window.addEventListener('hashchange',()=>this.sync());
  queueMicrotask(()=>this.sync());
 }
 open(room,slug=null,collection=null){const q=new URLSearchParams({room});if(slug)q.set('article',slug);if(collection||(slug&&room===this.room&&this.collectionId))q.set('collection',collection||this.collectionId);this.navigate('#'+q.toString());}
 openCollection(id){this.open('library',null,id);}
 close(){this.navigate('');}
 navigate(hash){if(location.hash!==hash)history.pushState({islandRoom:true},'',location.pathname+location.search+hash);this.sync();}
 sync(){
  const q=new URLSearchParams(location.hash.slice(1)),room=q.get('room'),slug=q.get('article'),collection=q.get('collection');
  if(!Object.hasOwn(names,room)){this.token++;this.pending?.abort();this.saveProgress();this.room=null;this.slug=null;if(this.dialog.open)this.dialog.close();document.body.classList.remove('room-open');this.callbacks.selection(null);return;}
  if(this.dialog.open&&room===this.room&&slug===this.slug&&collection===this.collectionId)return;
  this.saveProgress();this.token++;this.pending?.abort();this.room=room;this.slug=slug;this.collectionId=collection;
  this.dialog.dataset.room=room;this.dialog.classList.toggle('has-article',Boolean(slug));document.body.classList.add('room-open');
  this.dialog.querySelector('#room-name').textContent=this.names[room];this.dialog.querySelector('#room-caption').textContent=captions[room];
  this.dialog.querySelector('.room-footer-hint').textContent=room==='library'?'把写下的日子，放进书架':room==='projects'?'从过程、线索和证据，认识一项工程':room==='postoffice'?'把一句问候，寄到这个小岛':room==='about'?'做工程，也保持好奇':room==='search'?'从一个词，找回一段记录':'从一个具体问题，开始动手';
  this.dialog.querySelector('.room-coordinate').textContent='ISLAND / '+({library:'01',projects:'02',workshop:'03',about:'LY',postoffice:'POST',search:'FIND'}[room]);
  for(const tab of this.dialog.querySelectorAll('.room-tab')){tab.textContent=this.names[tab.dataset.room];tab.setAttribute('aria-current',tab.dataset.room===room?'page':'false');}
  this.callbacks.selection(room);if(!this.dialog.open)this.dialog.showModal();
  if(room==='search'&&!slug)this.searchCollection();else if(room==='postoffice')this.readPostOffice();else if(room==='about')this.readAbout();else if(slug)this.readArticle(slug);else if(collection)this.renderDirectory(collection);else this.collection();
 }
 refresh(){if(this.room){this.dialog.querySelector('#room-name').textContent=this.names[this.room];for(const tab of this.dialog.querySelectorAll('.room-tab'))tab.textContent=this.names[tab.dataset.room];if(this.room==='search'&&!this.slug)this.searchCollection();else if(this.room==='postoffice')this.readPostOffice();else if(this.room==='about')this.readAbout();else if(!this.slug){if(this.collectionId)this.renderDirectory(this.collectionId);else this.collection();}}}
 readPostOffice(){this.scroll.scrollTop=0;this.pending?.abort();this.pending=new AbortController();renderPostOffice(this.content,this.pending.signal);}
 async readAbout(){
  if(this.aboutData){this.renderAbout(this.aboutData);return;}const token=++this.token;this.pending?.abort();const controller=new AbortController();this.pending=controller;const timeout=setTimeout(()=>controller.abort(),8000);this.content.replaceChildren(el('p','room-empty','正在读岛主留下的介绍…'));
  try{const response=await fetch('/about',{signal:controller.signal});if(!response.ok)throw new Error('介绍暂时没有读取到。');const html=await response.text();const source=new DOMParser().parseFromString(html,'text/html');const content=source.querySelector('.about-content'),heading=source.querySelector('.page-title h1');if(!content||!heading)throw new Error('介绍暂时无法打开。');if(token!==this.token)return;this.aboutData={title:heading.textContent,html:content.innerHTML};this.renderAbout(this.aboutData);}
  catch(error){if(token!==this.token)return;const notice=el('section','reading-error');notice.setAttribute('role','status');notice.append(el('h2','','岛主的介绍，稍后再读'),el('p','',error.name==='AbortError'?'读取超时，可以重新打开。':error.message),button('重新读取','room-action',()=>this.readAbout()));const fallback=el('a','room-text-action','打开文字版介绍 →');fallback.href='/about';notice.append(fallback);this.content.replaceChildren(notice);}
  finally{clearTimeout(timeout);}
 }
 renderAbout(data){
  this.content.replaceChildren();this.scroll.scrollTop=0;const layout=el('div','keeper-layout');const identity=el('aside','keeper-identity');identity.append(el('p','room-eyebrow','THE ISLAND KEEPER'),illustration('<svg viewBox="0 0 240 270" fill="none" aria-hidden="true"><ellipse cx="120" cy="237" rx="86" ry="13" fill="#6b8066" opacity=".08"/><path d="M48 198h144v28H48z" fill="#d7d2bf"/><path d="M43 191h154v12H43z" fill="#ebe6d3"/><path d="m38 144 80-19 81 16v43l-81-12-80 14z" fill="#8b6852"/><path d="m43 135 75-19 76 18v42l-76-13-75 14z" fill="#f4eddb" stroke="#c8c3a7" stroke-width="2"/><path d="M118 117v46m-62-21 46-11m-46 22 46-10m-46 21 46-10m31-22 47 9m-47 2 47 9m-47 2 47 9" stroke="#b6b69a" stroke-width="2"/><path d="m128 154 44-75 10 6-44 75-12 8z" fill="#718875"/><path d="m172 79 6-9 10 6-6 9" fill="#d9c69e"/><path d="m128 154-2 14 12-8" fill="#d6b477"/><path d="m104 164-1 24 10-6 3 5v-22" fill="#a47f5d"/></svg>','keeper-portrait'),el('h2','','LY'),el('p','keeper-signature','记录与求索 / Record & Quest'),el('p','keeper-caption','在工程与日常之间，\n留下自己的线索。'));
  const paper=el('article','keeper-paper');const head=el('header','keeper-heading');head.append(el('p','room-eyebrow','ABOUT / LY'),el('h1','',data.title));paper.append(head);const body=el('div','keeper-body');body.append(articleFragment(data.html));paper.append(body);const end=el('footer','keeper-end');end.append(el('span','','把小的记录留下来，让认识慢慢生长。'),button('走进书屋 →','room-text-action',()=>this.open('library')));paper.append(end);layout.append(identity,paper);this.content.append(layout);
 }
 collection(){
  this.content.replaceChildren();this.scroll.scrollTop=0;const posts=this.callbacks.posts();
  if(this.callbacks.failed?.()){const notice=el('div','collection-error');notice.setAttribute('role','status');notice.append(el('p','','公开记录暂时没有取到，请稍后再试。'),button('重新读取记录','room-action',()=>this.callbacks.retry?.()));this.content.append(notice);}
  const intro=el('section','collection-intro');intro.append(el('p','room-eyebrow',this.room==='library'?'一本一本，慢慢积累':this.room==='projects'?'工程档案 / FIELD NOTES':'工作台 / IN PROGRESS'));
  intro.append(el('h1','',this.room==='library'?'写下的日子，\n都在这里。':this.room==='projects'?'让一项工程，\n留下可以追溯的过程。':'把想法，\n做成用得上的东西。'));
  intro.append(el('p','collection-description',this.callbacks.island?.()?.buildings?.[this.room]?.description||(this.room==='library'?'挑一本，翻开看看。读完之后，小岛还在窗外。':this.room==='projects'?'这里先收录已有工程手记，项目档案会随着实践逐步补齐。':'桌上放着正在使用的工具，也留着每次尝试的手记。')));this.content.append(intro);if(this.room==='library')this.renderDirectoryIndex();renderSearch(this,this.room);const filterCards=()=>{};
  if(this.room==='library'){
   const bar=el('div','shelf-bar');bar.append(el('span','',this.callbacks.loaded()?posts.filter(p=>p.kind!=='project').length+' 本记录 · 按最近更新排列':'正在整理书架…'));const filters=el('div','shelf-filters');let active='',kind='';const type=el('select','shelf-kind-select');type.setAttribute('aria-label','筛选笔记或博客');for(const [value,label] of [['','笔记和博客'],['note','笔记'],['blog','博客']]){const option=el('option','',label);option.value=value;type.append(option);}type.addEventListener('change',()=>{kind=type.value;draw();});
   const shelf=el('div','book-shelf');const draw=()=>{shelf.replaceChildren();for(const [i,p] of posts.filter(p=>p.kind!=='project'&&(!kind||(p.kind||'blog')===kind)&&(!active||p.topic===active)).entries())shelf.append(this.bookCard(p,i));filterCards();if(!shelf.children.length)shelf.append(this.empty(this.callbacks.loaded()?'这一层书架还空着。':'正在读取公开记录…'));};
   for(const category of ['','记录','工程','探索']){const b=button(category||'全部','shelf-filter',()=>{active=category;for(const other of filters.children)other.setAttribute('aria-pressed',String(other===b));draw();});b.setAttribute('aria-pressed',String(!category));filters.append(b);}
   bar.append(type,filters);this.content.append(bar,shelf);draw();
   const end=el('div','shelf-end');end.append(illustration(bookDrawing,'shelf-book-mark'),el('span','','不急着写完，让记录慢慢长成一本书。'));this.content.append(end);
  }else if(this.room==='projects'){
   const wall=el('div','exhibition-wall');const drawing=el('div','engineering-drawing');drawing.append(el('span','drawing-stamp','LY / STRUCTURE STUDY'),illustration(bridgeDrawing,'bridge-drawing'),el('p','drawing-caption','代码绘制的结构概念图 · 不对应实际工程'));const archive=el('div','project-archive');
   const projects=posts.filter(p=>p.kind==='project'),notes=posts.filter(p=>p.kind!=='project'&&p.topic==='工程');if(projects.length)archive.append(el('h2','archive-section-title','项目档案'));for(const [i,p] of projects.entries())archive.append(this.exhibitCard(p,i));if(notes.length)archive.append(el('h2','archive-section-title','工程手记'));for(const [i,p] of notes.entries())archive.append(this.exhibitCard(p,i));if(!archive.children.length)archive.append(this.empty('工程手记会从这里开始积累。'));wall.append(drawing,archive);this.content.append(wall);
  }else{
   const bench=el('div','tool-bench');for(const tool of [{name:'CivilFlow',label:'01 / 建模工作台',detail:'把桥梁参数连成节点工作流，校验、编译，再导出 Civil JSON。',url:'https://midas.rqly.com',svg:flowDrawing,tag:'工作流 · 校验 · 导出'},{name:'七嘴',label:'02 / 文字工作台',detail:'给一份稿件换三个视角，找到值得修改的表达。',url:'https://7zui.com',svg:wordsDrawing,tag:'专业人员 · 听众 · 编辑'}]){
    const t=el('article','tool-station');t.append(el('span','room-eyebrow',tool.label),illustration(tool.svg,'tool-drawing'),el('h2','',tool.name),el('p','',tool.detail),el('span','tool-tag',tool.tag));const a=el('a','tool-open','打开工具 ↗');a.href=tool.url;a.target='_blank';a.rel='noopener noreferrer';t.append(a);bench.append(t);
   }this.content.append(bench);const log=el('section','workshop-log');log.append(el('h2','','研发手记'));for(const p of posts.filter(p=>p.kind!=='project'&&p.topic==='探索')){const b=button(p.title,'workshop-entry',()=>this.open(this.room,p.slug));b.dataset.search=(p.title+' '+p.summary).toLowerCase();b.append(el('span','',p.date+' →'));log.append(b);}this.content.append(log);
  }
 }
 searchCollection(){this.content.replaceChildren();this.scroll.scrollTop=0;const intro=el('section','collection-intro search-heading');intro.append(el('p','room-eyebrow','SEARCH / 小岛里的记录'),el('h1','','从一个词，找回一段记录。'),el('p','collection-description','搜索公开的笔记、博客与项目。标题、摘要、正文和项目资料都能找到；多个关键词用空格分开。'));this.content.append(intro);this.renderDirectoryIndex();renderSearch(this);}
 empty(text){return el('p','room-empty',text);}
 bookCard(p,index){
  const b=button('','book-cover',()=>this.open(this.room,p.slug));b.dataset.search=(p.title+' '+p.summary).toLowerCase();b.dataset.article=p.slug;b.dataset.topic=p.topic;b.style.setProperty('--book-index',index%3);b.setAttribute('aria-label','阅读：'+p.title);
  b.append(el('span','book-edition','LY / '+(p.kind==='note'?'笔记':'博客')+' · '+p.topic),el('span','book-number',String(index+1).padStart(2,'0')),el('h2','',p.title),el('p','book-summary',p.summary));
  const photo=coverImage(p,'book-cover-photo');if(photo)b.append(photo);const art=illustration(p.topic==='工程'?bridgeDrawing:p.topic==='探索'?flowDrawing:bookDrawing,'cover-drawing');if(!photo)b.append(art);
  const bottom=el('span','book-cover-bottom');const saved=this.positions[p.slug]?.ratio;bottom.append(el('time','',p.date),el('span','',Number.isFinite(saved)&&saved>0?'书签 '+Math.round(saved*100)+'%':'翻开这本 →'));b.append(bottom);return b;
 }
 exhibitCard(p,index){
  const b=button('','exhibit-card',()=>this.open(this.room,p.slug));b.dataset.search=(p.title+' '+p.summary).toLowerCase();b.dataset.article=p.slug;const photo=coverImage(p,'archive-cover');if(photo)b.append(photo);b.append(el('span','archive-number','档案 / '+String(index+1).padStart(2,'0')),el('span','archive-type'+(p.kind==='project'?' project':''),p.kind==='project'?'项目 · '+({planning:'计划中',active:'进行中',done:'已完成'}[p.project?.status]||'进行中'):'工程手记'),el('h2','',p.title),el('p','',p.summary));const meta=el('div','archive-meta');meta.append(el('span','',p.date),el('span','','展开档案 →'));b.append(meta);return b;
 }
 async readArticle(slug){
  const token=this.token;this.scroll.scrollTop=0;this.content.replaceChildren(el('div','room-empty','正在翻开这一页…'));const controller=new AbortController();this.pending=controller;const timeout=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch('/api/posts/'+encodeURIComponent(slug),{signal:controller.signal});if(!response.ok)throw new Error(response.status===404?'这篇记录还未公开或已移走。':'暂时没有取到正文，请再试一次。');const data=await response.json();
   if(token!==this.token)return;const p=data.post;if(!p||p.published!==true||p.slug!==slug||typeof p.body!=='string'||typeof data.html!=='string')throw new Error('这篇记录暂时无法打开。');
   this.renderArticle(p,data.html);
  }catch(error){if(token!==this.token)return;const empty=el('div','reading-error');empty.setAttribute('role','status');empty.append(el('h2','','这一页暂时没有翻开'),el('p','',error.name==='AbortError'?'正文读取超时，请再试一次。':error.message),button('重新打开','room-action',()=>this.readArticle(slug)),button('回到'+this.names[this.room],'room-text-action',()=>this.open(this.room)));this.content.replaceChildren(empty);}
  finally{clearTimeout(timeout);}
 }
 renderArticle(p,html){
  this.content.replaceChildren();const controls=el('div','reader-controls');const back=button('← '+(this.room==='library'?'回到书架':this.room==='projects'?'回到展厅':this.room==='search'?'回到搜索结果':'回到工作台'),'reader-back',()=>this.open(this.room,null,this.collectionId));controls.append(back);
  const type=el('div','reader-type-controls');type.append(el('span','','字号'),button('A−','',()=>this.setFont(this.font-1)),button('A+','',()=>this.setFont(this.font+1)));type.children[1].setAttribute('aria-label','减小字号');type.children[2].setAttribute('aria-label','增大字号');controls.append(type);this.content.append(controls);
  const spread=el('div','reader-spread'),margin=el('aside','reader-margin'),paper=el('article','reader-paper');this.spread=spread;spread.style.setProperty('--reading-size',this.font+'px');
  margin.append(el('p','room-eyebrow',this.room==='library'?'READING / 私人藏书':this.room==='projects'?'FIELD NOTES / 工程档案':'MAKER NOTES / 研发手记'),illustration(this.room==='projects'?bridgeDrawing:this.room==='workshop'?flowDrawing:bookDrawing,'margin-drawing'),el('span','reader-category',p.topic));
  const toc=el('nav','reader-toc');toc.setAttribute('aria-label','文章目录');margin.append(el('h3','toc-title','这一页的线索'),toc);
  const bookmark=el('div','reader-bookmark');bookmark.append(el('span','','阅读书签'),el('strong','reader-progress-label','0%'));const track=el('span','reading-track');track.append(el('span','reading-fill'));bookmark.append(track,el('small','','读到的位置，会留在这个浏览器。'));margin.append(bookmark);
  const share=button('复制这页链接 ↗','reader-share',async()=>{try{await navigator.clipboard.writeText(location.href);share.textContent='阅读链接已复制';}catch{share.textContent='复制浏览器地址即可分享';}setTimeout(()=>{share.textContent='复制这页链接 ↗';},3000);});margin.append(share,el('p','paper-signature','LY / 记录与求索'));
  const header=el('header','article-heading');header.append(el('p','article-meta',p.date+' / '+p.topic+' / 约 '+Math.max(1,Math.ceil(p.body.length/350))+' 分钟'),el('h1','',p.title),el('p','article-deck',p.summary));if(p.kind==='project'){const details=el('div','project-details');details.append(el('span','',({planning:'计划中',active:'进行中',done:'已完成'}[p.project?.status]||'进行中')));if(p.project?.role)details.append(el('span','','负责：'+p.project.role));if(p.project?.period)details.append(el('span','','时间：'+p.project.period));header.append(details);}paper.append(header);this.renderArticleOrganization(p,paper);const cover=coverImage(p,'reader-cover');if(cover)paper.append(cover);
  const body=el('div','article-body');body.append(articleFragment(html));paper.append(body);const firstMatch=highlightArticleMatches(body,this.searchStates?.get(this.room==='search'?'':this.room)?.q||'');
  for(const [i,h] of [...body.querySelectorAll('h2,h3,h4')].entries()){h.id='reading-section-'+i;const b=button(h.textContent,'toc-item',()=>h.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));if(h.tagName==='H3')b.classList.add('subheading');toc.append(b);}
  if(!toc.children.length)toc.append(el('p','','从这里开始阅读。'));
  const end=el('footer','article-end');end.append(el('span','','这一页，先写到这里。'),button('合上记录，回到'+(this.room==='library'?'书架':this.room==='projects'?'展厅':this.room==='search'?'搜索结果':'工作台'),'room-text-action',()=>this.open(this.room,null,this.collectionId)));const records=p.organizationDetails?.series?seriesRecords(this.callbacks.posts(),p.organizationDetails.series.id):this.callbacks.posts().filter(item=>this.room==='library'?item.kind!=='project':this.room==='projects'?item.kind==='project'||item.topic==='工程':this.room==='search'?true:item.kind!=='project'&&item.topic==='探索'),at=records.findIndex(item=>item.slug===p.slug);const neighbours=el('nav','reading-neighbours');neighbours.setAttribute('aria-label','继续阅读');for(const [item,label] of [[records[at-1],'← 上一篇'],[records[at+1],'下一篇 →']])if(item)neighbours.append(button(label+' · '+item.title,'',()=>this.open(this.room,item.slug)));paper.append(end,neighbours);this.renderRelatedRecords(p,paper);spread.append(margin,paper);this.content.append(spread);
  const saved=Math.max(0,Math.min(1,Number(this.positions[p.slug]?.ratio)||0));requestAnimationFrame(()=>{if(this.slug!==p.slug)return;this.scroll.scrollTop=saved*(this.scroll.scrollHeight-this.scroll.clientHeight);if(firstMatch)firstMatch.scrollIntoView({block:'center'});this.saveProgress();this.scroll.focus({preventScroll:true});});
 }

 publicDirectories(){const items=new Map();for(const p of this.callbacks.posts()){const d=p.organizationDetails;if(!d)continue;for(const item of [...d.tags,...d.topics,...(d.series?[d.series]:[])])items.set(item.id,item);}return [...items.values()];}
 renderDirectoryIndex(){const items=this.publicDirectories();if(!items.length)return;const section=el('section','island-directories');section.append(el('h2','','沿着一个主题，继续阅读。'));for(const type of ['topic','series','tag']){const group=el('div','directory-group');for(const item of items.filter(i=>i.type===type)){const b=button(({tag:'#',topic:'专题 · ',series:'系列 · '}[type])+item.name,'directory-chip',()=>this.openCollection(item.id));b.dataset.collection=item.id;group.append(b);}if(group.children.length)section.append(group);}this.content.append(section);}
 renderDirectory(id){this.content.replaceChildren();this.scroll.scrollTop=0;const item=this.publicDirectories().find(i=>i.id===id);if(!item){this.content.append(el('h1','','这里还没有公开内容'),el('p','room-empty',this.callbacks.loaded()?'这个目录已移走，或暂时只有未发布的记录。':'正在整理公开目录…'),button('回到书屋','room-action',()=>this.open('library')));return;}
 const intro=el('section','collection-intro');intro.append(button('← 回到书屋','room-text-action',()=>this.open('library')),el('p','room-eyebrow',{tag:'TAG / 标签',topic:'TOPIC / 专题',series:'SERIES / 连续阅读'}[item.type]),el('h1','',item.name));if(item.description)intro.append(el('p','collection-description',item.description));this.content.append(intro);const records=item.type==='series'?seriesRecords(this.callbacks.posts(),id):this.callbacks.posts().filter(p=>(p.organization?.tags||[]).includes(id)||(p.organization?.topics||[]).includes(id));const list=el('div','directory-records');intro.append(el('p','',records.length+' 条公开记录'+(item.type==='series'?' · 按阅读顺序排列':'')));for(const [index,p] of records.entries()){const b=button('','directory-record',()=>this.open(this.room,p.slug,id));b.dataset.article=p.slug;b.append(el('span','directory-number',item.type==='series'?String(index+1).padStart(2,'0'):p.date),el('div'));b.lastChild.append(el('h2','',p.title),el('p','',p.summary),el('small','',(p.kind==='project'?'项目':p.kind==='note'?'笔记':'博客')+' · '+p.date));list.append(b);}this.content.append(list);}
 renderArticleOrganization(p,paper){const d=p.organizationDetails;if(!d)return;const bar=el('nav','article-organization');bar.setAttribute('aria-label','内容归属');for(const item of [...d.tags,...d.topics,...(d.series?[d.series]:[])])bar.append(button(({tag:'#',topic:'专题 · ',series:'系列 · '}[item.type])+item.name,'directory-chip',()=>this.openCollection(item.id)));if(d.project)bar.append(button('项目 · '+d.project.title,'directory-chip',()=>this.open('projects',d.project.slug)));if(bar.children.length)paper.append(bar);}
 renderRelatedRecords(p,paper){const all=this.callbacks.posts(),d=p.organizationDetails,sections=[];if(d?.series)sections.push({title:'系列 · '+d.series.name,records:seriesRecords(all,d.series.id)});if(p.kind==='project')sections.push({title:'这个项目的记录',records:all.filter(item=>item.organization?.projectSlug===p.slug)});else if(d?.project)sections.push({title:'同一项目的记录',records:all.filter(item=>item.organization?.projectSlug===d.project.slug&&item.slug!==p.slug)});
 for(const {title,records} of sections){if(!records.length)continue;const section=el('section','related-records');section.append(el('h2','',title));for(const [index,item] of records.entries()){if(item.slug===p.slug){const current=el('p','related-current',String(index+1).padStart(2,'0')+' · '+item.title+'（正在阅读）');current.setAttribute('aria-current','page');section.append(current);}else{const b=button(item.title,'related-record',()=>this.open(item.kind==='project'?'projects':this.room,item.slug));b.dataset.article=item.slug;b.append(el('span','',item.date+' →'));section.append(b);}}paper.append(section);}
 }
 setFont(size){this.font=Math.max(16,Math.min(22,size));this.spread?.style.setProperty('--reading-size',this.font+'px');try{localStorage.setItem('ly-island-reader-font',JSON.stringify(this.font));}catch{}this.saveProgress();}
 saveProgress(){
  if(!this.slug||!this.dialog.open||!this.content.querySelector('.reader-paper'))return;
  const max=this.scroll.scrollHeight-this.scroll.clientHeight;const ratio=max>5?Math.max(0,Math.min(1,this.scroll.scrollTop/max)):1;
  this.positions[this.slug]={ratio,updated:Date.now()};const label=this.content.querySelector('.reader-progress-label'),fill=this.content.querySelector('.reading-fill');if(label)label.textContent=Math.round(ratio*100)+'%';if(fill)fill.style.width=ratio*100+'%';
  clearTimeout(this.storeTimer);this.storeTimer=setTimeout(()=>{try{const entries=Object.entries(this.positions).sort((a,b)=>b[1].updated-a[1].updated).slice(0,40);localStorage.setItem('ly-island-reading-v1',JSON.stringify(Object.fromEntries(entries)));}catch{}},150);
 }
}
