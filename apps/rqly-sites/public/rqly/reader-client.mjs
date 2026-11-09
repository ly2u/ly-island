import {inPlaceClick} from './navigation.mjs';
import {readingPositions,validRecordSlug} from './island-content.mjs';
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
export function setupReader(root,{onBack,onFont,onRecord,onCollection,manageProgress=false,scrollElement=window,initialFont}={}){
 const controller=new AbortController(),signal=controller.signal,spread=root.querySelector('.reader-spread'),body=root.querySelector('.article-body'),toc=root.querySelector('.reader-toc');
 let font=Math.max(16,Math.min(22,Number(initialFont??read('ly-island-reader-font',18))||18)),timer;
 const setFont=size=>{font=Math.max(16,Math.min(22,size));spread.style.setProperty('--reading-size',font+'px');try{localStorage.setItem('ly-island-reader-font',JSON.stringify(font));}catch{}onFont?.(font);};setFont(font);
 toc.replaceChildren();for(const [i,h] of [...body.querySelectorAll('h2,h3,h4')].entries()){
  h.id='reading-section-'+i;const b=document.createElement('button');b.type='button';b.className='toc-item'+(h.tagName==='H3'?' subheading':'');b.textContent=h.textContent;b.addEventListener('click',()=>h.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}),{signal});toc.append(b);
 }if(!toc.children.length){const p=document.createElement('p');p.textContent='从这里开始阅读。';toc.append(p);}
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
 return {setFont,dispose(){controller.abort();clearTimeout(timer);}};
}
