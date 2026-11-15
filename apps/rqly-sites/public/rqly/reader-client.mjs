import {setupCodeBlocks} from './code-blocks.mjs?v=code-tools-v1';
import {inPlaceClick} from './navigation.mjs';
import {readingPositions,validRecordSlug} from './island-content.mjs?v=knowledge-v1';
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
function trackOutline(root,headings,toc,scrollElement,signal){
 const buttons=[...toc.querySelectorAll('.toc-item')];let frame=0,active=-1,manualUntil=0,forced=null,forcedUntil=0;
 const reveal=button=>{
  if(!button||Date.now()<manualUntil)return;
  const bounds=toc.getBoundingClientRect(),item=button.getBoundingClientRect(),gap=8;
  if(item.top<bounds.top+gap)toc.scrollTop-=bounds.top+gap-item.top;
  else if(item.bottom>bounds.bottom-gap)toc.scrollTop+=item.bottom-bounds.bottom+gap;
  if(item.left<bounds.left+gap)toc.scrollLeft-=bounds.left+gap-item.left;
  else if(item.right>bounds.right-gap)toc.scrollLeft+=item.right-bounds.right+gap;
 };
 const select=index=>{
  if(index<0)return;
  if(active!==index){if(buttons[active])buttons[active].removeAttribute('aria-current');buttons[index].setAttribute('aria-current','location');active=index;}
  reveal(buttons[index]);
 };
 const update=()=>{
  frame=0;if(signal.aborted||!root.isConnected||!headings.length)return;
  const view=scrollElement===window?{top:0,height:innerHeight}:scrollElement.getBoundingClientRect(),margin=root.querySelector('.reader-margin');
  const available=Math.max(160,Math.floor(view.height-(parseFloat(getComputedStyle(margin).top)||0)-16))+'px';if(root.style.getPropertyValue('--reader-outline-height')!==available)root.style.setProperty('--reader-outline-height',available);
  if(!toc.clientHeight)return;
  if(forced!==null&&Date.now()<forcedUntil){select(forced);return;}
  forced=null;
  const anchor=view.top+Math.min(130,view.height*.22);
  let lo=0,hi=headings.length;while(lo<hi){const mid=(lo+hi)>>1;if(headings[mid].getBoundingClientRect().top<=anchor)lo=mid+1;else hi=mid;}
  select(Math.max(0,lo-1));
 };
 const queue=()=>{if(!signal.aborted&&!frame)frame=requestAnimationFrame(update);};
 for(const [index,button]of buttons.entries())button.addEventListener('click',()=>{
  forced=index;forcedUntil=Date.now()+900;manualUntil=0;select(index);
  headings[index].scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});queue();
 },{signal});
 for(const type of ['wheel','touchstart','pointerdown','keydown']){
  toc.addEventListener(type,()=>{manualUntil=Date.now()+2500;},{passive:true,signal});
  scrollElement.addEventListener(type,event=>{if(!toc.contains(event.target)){manualUntil=0;forced=null;queue();}},{passive:true,signal});
 }
 scrollElement.addEventListener('scroll',queue,{passive:true,signal});window.addEventListener('resize',queue,{passive:true,signal});root.addEventListener('load',queue,{capture:true,signal});
 const observer=window.ResizeObserver?new ResizeObserver(queue):null;observer?.observe(root.querySelector('.article-body'));
 document.fonts?.ready.then(queue);queue();
 return {refresh:queue,dispose(){cancelAnimationFrame(frame);observer?.disconnect();}};
}
export function setupReader(root,{onBack,onFont,onRecord,onCollection,manageProgress=false,scrollElement=window,initialFont}={}){
 const controller=new AbortController(),signal=controller.signal,spread=root.querySelector('.reader-spread'),body=root.querySelector('.article-body'),toc=root.querySelector('.reader-toc');
 let outline;const codeTools=setupCodeBlocks(body);
 let font=Math.max(16,Math.min(22,Number(initialFont??read('ly-island-reader-font',18))||18)),timer;
 const setFont=size=>{font=Math.max(16,Math.min(22,size));spread.style.setProperty('--reading-size',font+'px');try{localStorage.setItem('ly-island-reader-font',JSON.stringify(font));}catch{}onFont?.(font);outline?.refresh();};setFont(font);
 const headings=[...body.querySelectorAll('h2,h3,h4')];root.classList.toggle('has-long-toc',headings.length>8);
 toc.replaceChildren();for(const [i,h]of headings.entries()){
  h.id='reading-section-'+i;const button=document.createElement('button');button.type='button';button.className='toc-item'+(h.tagName==='H3'?' subheading':'');button.textContent=h.textContent;button.dataset.readerSection=String(i);toc.append(button);
 }if(!toc.children.length){const p=document.createElement('p');p.textContent='从这里开始阅读。';toc.append(p);}
 outline=trackOutline(root,headings,toc,scrollElement,signal);
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
