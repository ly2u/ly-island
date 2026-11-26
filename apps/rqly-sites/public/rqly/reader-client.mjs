import {setupCodeBlocks} from './code-blocks.mjs?v=code-tools-v1';
import {inPlaceClick} from './navigation.mjs';
import {readingPositions,validRecordSlug} from './island-content.mjs';
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
function buildOutlineTree(headings,toc){
 toc.replaceChildren();
 if(!headings.length){const p=document.createElement('p');p.textContent='从这里开始阅读。';toc.append(p);return {buttons:[],groups:[],itemGroup:[]};}
 const levels=headings.map(h=>Number(h.tagName.slice(1)));
 const topLevel=Math.min(...levels);
 const buttons=[],groups=[],itemGroup=[];
 let currentGroup=null;
 const makeButton=(h,i,level)=>{
  h.id='reading-section-'+i;
  const button=document.createElement('button');button.type='button';
  const depth=level-topLevel;
  button.className='toc-item'+(depth===1?' subheading':depth>=2?' subheading-deep':'');
  button.textContent=h.textContent;button.dataset.readerSection=String(i);
  buttons.push(button);
  return button;
 };
 for(const [i,h]of headings.entries()){
  const level=levels[i],button=makeButton(h,i,level);
  if(level===topLevel||!currentGroup){
   const groupEl=document.createElement('div');groupEl.className='toc-group';
   const headEl=document.createElement('div');headEl.className='toc-group-head';
   headEl.append(button);groupEl.append(headEl);toc.append(groupEl);
   currentGroup={id:groups.length,el:groupEl,head:headEl,children:null,toggle:null};
   groups.push(currentGroup);
   itemGroup.push(currentGroup.id);
  }else{
   if(!currentGroup.children){
    const toggle=document.createElement('button');toggle.type='button';toggle.className='toc-toggle';
    toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','展开或收起子目录');
    toggle.textContent='▸';
    currentGroup.head.append(toggle);
    const children=document.createElement('div');children.className='toc-children';children.hidden=true;
    currentGroup.el.append(children);
    currentGroup.toggle=toggle;currentGroup.children=children;
   }
   currentGroup.children.append(button);
   itemGroup.push(currentGroup.id);
  }
 }
 return {buttons,groups,itemGroup};
}
function attachTocTooltip(toc,signal){
 const tip=document.createElement('div');tip.className='toc-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;
 document.body.append(tip);
 const hide=()=>{tip.hidden=true;};
 const show=button=>{
  if(button.scrollWidth<=button.clientWidth+1){hide();return;}
  tip.textContent=button.textContent;tip.hidden=false;
  const r=button.getBoundingClientRect(),tw=tip.offsetWidth,th=tip.offsetHeight,gap=10;
  let left=r.left-tw-gap;
  if(left<12)left=Math.min(innerWidth-tw-12,Math.max(12,r.left));
  let top=r.top+(r.height-th)/2;
  if(left>=r.left-10)top=r.top-th-8;
  top=Math.max(12,Math.min(innerHeight-th-12,top));
  tip.style.left=Math.round(left)+'px';tip.style.top=Math.round(top)+'px';
 };
 toc.addEventListener('pointerover',event=>{
  if(event.pointerType!=='mouse')return;
  const btn=event.target.closest('.toc-item');if(btn&&toc.contains(btn))show(btn);
 },{signal});
 toc.addEventListener('pointerout',event=>{
  const btn=event.target.closest('.toc-item');
  if(btn&&(!event.relatedTarget||!btn.contains(event.relatedTarget)))hide();
 },{signal});
 toc.addEventListener('scroll',hide,{passive:true,signal});
 window.addEventListener('scroll',hide,{passive:true,signal});
 window.addEventListener('resize',hide,{passive:true,signal});
 return ()=>{tip.remove();};
}
function setupMobileTocDrawer(root,headings,onOpen,signal){
 if(!headings.length)return {close(){},dispose(){}};
 const margin=root.querySelector('.reader-margin'),details=root.querySelector('.reader-outline');
 if(!margin||!details)return {close(){},dispose(){}};
 const backdrop=document.createElement('div');backdrop.className='toc-fab-backdrop';backdrop.hidden=true;
 const fab=document.createElement('button');fab.type='button';fab.className='toc-fab';
 fab.setAttribute('aria-label','打开文章目录');fab.setAttribute('aria-expanded','false');
 fab.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h11"/></svg>';
 const closeBtn=document.createElement('button');closeBtn.type='button';closeBtn.className='toc-drawer-close';
 closeBtn.setAttribute('aria-label','关闭文章目录');closeBtn.textContent='×';
 const summary=details.querySelector('.toc-title');
 if(summary)summary.append(closeBtn);
 root.append(backdrop,fab);
 let opened=false;
 const setOpen=value=>{
  opened=value;
  root.classList.toggle('toc-drawer-open',value);
  backdrop.hidden=!value;
  fab.setAttribute('aria-expanded',String(value));
  fab.setAttribute('aria-label',value?'关闭文章目录':'打开文章目录');
  if(value){details.open=true;onOpen?.();}
 };
 fab.addEventListener('click',()=>setOpen(!opened),{signal});
 backdrop.addEventListener('click',()=>setOpen(false),{signal});
 closeBtn.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();setOpen(false);},{signal});
 window.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened){setOpen(false);fab.focus();}},{signal});
 return {close:()=>setOpen(false),dispose(){backdrop.remove();fab.remove();closeBtn.remove();root.classList.remove('toc-drawer-open');}};
}
function trackOutline(root,headings,toc,tree,scrollElement,signal){
 const {buttons,groups,itemGroup}=tree;
 let frame=0,active=-1,activeGroup=-1,manualUntil=0,forced=null,forcedUntil=0;
 const manualOverrides=new Map();
 const details=root.querySelector('.reader-outline'),current=root.querySelector('.toc-current');
 const removeTooltip=attachTocTooltip(toc,signal);
 let onDrawerOpen=()=>{};
 const drawer=setupMobileTocDrawer(root,headings,()=>onDrawerOpen(),signal);
 const applyGroups=()=>{
  for(const group of groups){
   const isCurrent=group.id===activeGroup;
   group.el.classList.toggle('has-active',isCurrent);
   if(!group.children)continue;
   const open=manualOverrides.has(group.id)?manualOverrides.get(group.id):isCurrent;
   group.children.hidden=!open;
   group.el.classList.toggle('is-open',open);
   group.toggle.setAttribute('aria-expanded',String(open));
  }
 };
 const reveal=button=>{
  if(!button||!toc.clientHeight||Date.now()<manualUntil)return;
  const bounds=toc.getBoundingClientRect(),item=button.getBoundingClientRect(),gap=12;
  if(!item.height)return;
  if(item.top<bounds.top+gap)toc.scrollTop-=bounds.top+gap-item.top;
  else if(item.bottom>bounds.bottom-gap)toc.scrollTop+=item.bottom-bounds.bottom+gap;
 };
 const select=index=>{
  if(index<0)return;
  const nextGroup=itemGroup[index]??-1;
  const groupChanged=nextGroup!==activeGroup;
  if(groupChanged){manualOverrides.clear();activeGroup=nextGroup;applyGroups();}
  if(active!==index){if(buttons[active])buttons[active].removeAttribute('aria-current');buttons[index].setAttribute('aria-current','location');active=index;if(current)current.textContent=headings[index].textContent;}
  reveal(buttons[index]);
 };
 for(const group of groups){
  if(!group.toggle)continue;
  group.toggle.addEventListener('click',event=>{
   event.stopPropagation();
   const nextOpen=group.children.hidden;
   manualOverrides.set(group.id,nextOpen);
   manualUntil=Date.now()+2500;
   applyGroups();
  },{signal});
 }
 const update=()=>{
  frame=0;if(signal.aborted||!root.isConnected||!headings.length)return;
  const view=scrollElement===window?{top:0,height:innerHeight}:scrollElement.getBoundingClientRect(),margin=root.querySelector('.reader-margin');
  const available=Math.max(160,Math.floor(view.height-(parseFloat(getComputedStyle(margin).top)||0)-16))+'px';if(root.style.getPropertyValue('--reader-outline-height')!==available)root.style.setProperty('--reader-outline-height',available);
  if(forced!==null&&Date.now()<forcedUntil){select(forced);return;}
  forced=null;
  const anchor=view.top+Math.min(130,view.height*.22);
  let lo=0,hi=headings.length;while(lo<hi){const mid=(lo+hi)>>1;if(headings[mid].getBoundingClientRect().top<=anchor)lo=mid+1;else hi=mid;}
  select(Math.max(0,lo-1));
 };
 const queue=()=>{if(!signal.aborted&&!frame)frame=requestAnimationFrame(update);};
 onDrawerOpen=()=>{manualUntil=0;manualOverrides.clear();applyGroups();queue();};
 for(const [index,button]of buttons.entries())button.addEventListener('click',()=>{
  forced=index;forcedUntil=Date.now()+900;manualUntil=0;
  const g=itemGroup[index]??-1;if(g>=0){manualOverrides.delete(g);activeGroup=g;applyGroups();}
  select(index);if(matchMedia('(max-width:1024px)').matches||root.clientWidth<=680)drawer.close();
  headings[index].scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});queue();
 },{signal});
 for(const type of ['wheel','touchstart','pointerdown','keydown']){
  toc.addEventListener(type,()=>{manualUntil=Date.now()+2500;},{passive:true,signal});
  scrollElement.addEventListener(type,event=>{if(!toc.contains(event.target)){manualUntil=0;forced=null;queue();}},{passive:true,signal});
 }
 scrollElement.addEventListener('scroll',queue,{passive:true,signal});window.addEventListener('resize',queue,{passive:true,signal});root.addEventListener('load',queue,{capture:true,signal});
 let syncDetails=()=>{};if(details){const compact=matchMedia('(max-width:1024px)');let wasCompact;syncDetails=()=>{const next=compact.matches||root.clientWidth<=680;if(next!==wasCompact){if(!next){drawer.close();details.open=true;}wasCompact=next;}queue();};syncDetails();compact.addEventListener('change',syncDetails,{signal});window.addEventListener('resize',syncDetails,{passive:true,signal});details.addEventListener('toggle',queue,{signal});}
 const observer=window.ResizeObserver?new ResizeObserver(()=>{syncDetails();queue();}):null;observer?.observe(root.querySelector('.article-body'));observer?.observe(root);
 document.fonts?.ready.then(queue);queue();
 return {refresh:queue,dispose(){cancelAnimationFrame(frame);observer?.disconnect();removeTooltip();drawer.dispose();}};
}
export function setupReader(root,{onBack,onFont,onRecord,onCollection,manageProgress=false,scrollElement=window,initialFont}={}){
 const controller=new AbortController(),signal=controller.signal,spread=root.querySelector('.reader-spread'),body=root.querySelector('.article-body'),toc=root.querySelector('.reader-toc');
 let outline;const codeTools=setupCodeBlocks(body);
 let font=Math.max(16,Math.min(22,Number(initialFont??read('ly-island-reader-font',18))||18)),timer;
 const setFont=size=>{font=Math.max(16,Math.min(22,size));spread.style.setProperty('--reading-size',font+'px');try{localStorage.setItem('ly-island-reader-font',JSON.stringify(font));}catch{}onFont?.(font);outline?.refresh();};setFont(font);
 const headings=[...body.querySelectorAll('h2,h3,h4')];root.classList.toggle('has-long-toc',headings.length>8);
 const tree=buildOutlineTree(headings,toc);
 outline=trackOutline(root,headings,toc,tree,scrollElement,signal);
 root.addEventListener('click',event=>{
  const target=event.target.closest('button,a');if(!target||!root.contains(target))return;if(target.tagName==='A'&&!inPlaceClick(event))return;
  if(target.hasAttribute('data-reader-font')){event.preventDefault();setFont(font+Number(target.dataset.readerFont));}
  if(target.hasAttribute('data-reader-back')||target.hasAttribute('data-reader-end')){if(onBack){event.preventDefault();onBack();}}
  if(target.dataset.readerCollection&&onCollection){event.preventDefault();onCollection(target.dataset.readerCollection);}
  if(target.dataset.readerRecord&&onRecord){event.preventDefault();onRecord(target.dataset.readerRecord,target.dataset.readerRoom);}
  if(target.hasAttribute('data-reader-share')){event.preventDefault();const slug=root.dataset.readerSlug;if(!validRecordSlug(slug)||root.dataset.readerPreview==='true')return;Promise.resolve().then(()=>navigator.clipboard.writeText(new URL('/notes/'+encodeURIComponent(slug),location.origin).href)).then(()=>{target.textContent='阅读链接已复制';}).catch(()=>{target.textContent='可使用独立文章页地址分享';});}
 },{signal});
 const slug=root.dataset.readerSlug,preview=root.dataset.readerPreview==='true';
 if(manageProgress&&!preview&&validRecordSlug(slug)){
  const entries=readingPositions(read('ly-island-reading-v1',{})),saved=entries[slug];
  const flush=()=>{clearTimeout(timer);try{const current=readingPositions(read('ly-island-reading-v1',{}));current[slug]=entries[slug];localStorage.setItem('ly-island-reading-v1',JSON.stringify(readingPositions(current)));}catch{}};
  const update=()=>{const max=scrollElement===window?document.documentElement.scrollHeight-innerHeight:scrollElement.scrollHeight-scrollElement.clientHeight,top=scrollElement===window?scrollY:scrollElement.scrollTop,ratio=max>5?Math.max(0,Math.min(1,top/max)):1;entries[slug]={ratio,updated:Date.now(),room:root.dataset.room};const label=root.querySelector('.reader-progress-label'),fill=root.querySelector('.reading-fill');if(label)label.textContent=Math.round(ratio*100)+'%';if(fill)fill.style.width=ratio*100+'%';clearTimeout(timer);timer=setTimeout(flush,150);};
  scrollElement.addEventListener('scroll',update,{passive:true,signal});window.addEventListener('pagehide',()=>{update();flush();},{signal});
  let interacted=false;for(const type of ['wheel','touchstart','pointerdown','keydown'])window.addEventListener(type,()=>{interacted=true;},{passive:true,signal,once:true});
  requestAnimationFrame(async()=>{if(saved&&!location.hash){await Promise.race([document.fonts?.ready||Promise.resolve(),new Promise(resolve=>setTimeout(resolve,750))]);await new Promise(resolve=>requestAnimationFrame(resolve));if(signal.aborted)return;if(!interacted){const max=document.documentElement.scrollHeight-innerHeight;window.scrollTo(0,saved.ratio*Math.max(0,max));}}update();});
 }
 return {setFont,dispose(){controller.abort();outline.dispose();codeTools.dispose();clearTimeout(timer);}};
}
