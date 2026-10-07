(()=>{
 const source=document.getElementById('body'),article=document.getElementById('live-preview-body'),scroll=document.querySelector('.live-preview-scroll'),workspace=document.getElementById('writing-workspace'),toggle=document.getElementById('preview-follow');
 let rendered=null,lines=[],starts=[],blocks=[],intent=null,following=false,frame=0,active=null,mirrorValue=null,mirrorSignature=null;
 const mirror=document.createElement('div');mirror.className='preview-source-measure';mirror.setAttribute('aria-hidden','true');const mirrorText=document.createTextNode('');mirror.append(mirrorText);document.body.append(mirror);
 try{toggle.checked=localStorage.getItem('ly-preview-follow-v1')!=='off';}catch{}
 function measure(){
  if(!mirror.isConnected)document.body.append(mirror);
  if(!source.clientWidth)return mirrorValue!==null;
  const c=getComputedStyle(source),props=['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','textIndent','textTransform','tabSize','paddingTop','paddingBottom','paddingLeft','paddingRight','direction'];
  const signature=source.clientWidth+'|'+props.map(k=>c[k]).join('|');
  if(signature!==mirrorSignature){mirror.style.width=source.clientWidth+'px';for(const key of props)mirror.style[key]=c[key];mirrorSignature=signature;}
  if(mirrorValue!==source.value){mirrorText.textContent=source.value+'\u200b';mirrorValue=source.value;}
  return true;
 }
 function charRect(offset){const range=document.createRange(),length=mirrorText.length;offset=Math.min(Math.max(0,offset),length-1);range.setStart(mirrorText,offset);range.setEnd(mirrorText,offset+1);return range.getBoundingClientRect();}
 function offsetAtHeight(y){let lo=0,hi=source.value.length;while(lo<hi){const mid=(lo+hi)>>1;if(charRect(mid).top<y)lo=mid+1;else hi=mid;}return lo;}
 function lineAt(offset){let lo=0,hi=starts.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(starts[mid]<=offset)lo=mid;else hi=mid-1;}return lo;}
 function blockAt(line){let lo=0,hi=blocks.length;while(lo<hi){const mid=(lo+hi)>>1;if(blocks[mid].start<=line)lo=mid+1;else hi=mid;}const prev=blocks[Math.max(0,lo-1)],next=blocks[lo];if(next&&line>prev.end&&next.start-line<line-prev.end)return next;return prev;}
 function textRect(element,offset){
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node,last=null;
  while(node=walker.nextNode()){last=node;if(offset<node.length){const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+1);return range.getBoundingClientRect();}offset-=node.length;}
  if(last&&last.length){const range=document.createRange();range.setStart(last,last.length-1);range.setEnd(last,last.length);return range.getBoundingClientRect();}return element.getBoundingClientRect();
 }
 function previewRect(block,line,column){
  const element=block.element,start=block.start+(element.tagName==='PRE'&&/^```/.test(lines[block.start])?1:0);
  const text=element.textContent,parts=text.split('\n'),row=Math.min(Math.max(line-start,0),parts.length-1),raw=lines[Math.min(Math.max(line,start),block.end)]||'';
  if(/^\s*!\[/.test(raw)&&element.querySelector('img')){const images=element.querySelectorAll('img'),prior=lines.slice(start,line).filter(v=>/^\s*!\[/.test(v)).length;return(images[Math.min(prior,images.length-1)]).getBoundingClientRect();}
  const prefix=element.tagName==='PRE'?0:(raw.match(/^(?:#{1,3}\s+|>\s?|\s*(?:[-*]\s+|\d+\.\s+))/)?.[0].length||0),plainColumn=Math.min(parts[row].length,Math.round(Math.max(0,column-prefix)/Math.max(1,raw.length-prefix)*parts[row].length));
  const offset=parts.slice(0,row).reduce((n,s)=>n+s.length+1,0)+plainColumn;return textRect(element,offset);
 }
 function clearMark(){active?.classList.remove('is-source-current');active=null;}
 function sync(){
  frame=0;if(!toggle.checked||!following||!intent||rendered!==source.value||!blocks.length||!scroll.offsetParent)return;
  let offset=intent.offset,anchor=intent.anchor??.25;
  if(source.offsetParent&&measure()){
   const top=mirror.getBoundingClientRect().top+parseFloat(getComputedStyle(source).paddingTop||0),height=Math.max(1,source.clientHeight-parseFloat(getComputedStyle(source).paddingTop)-parseFloat(getComputedStyle(source).paddingBottom));
   if(intent.type==='scroll'){anchor=.25;offset=offsetAtHeight(top+source.scrollTop+height*anchor);}else{offset=source.selectionDirection==='backward'?source.selectionStart:source.selectionEnd;anchor=Math.max(.1,Math.min(.85,(charRect(offset).top-top-source.scrollTop)/height));}
  }
  offset=Math.min(Math.max(0,offset??0),rendered.length);intent={...intent,offset,anchor};const line=lineAt(offset),block=blockAt(line),column=offset-starts[line];
  if(active!==block.element){clearMark();active=block.element;active.classList.add('is-source-current');}
  const rect=previewRect(block,line,column),bounds=scroll.getBoundingClientRect();let target=scroll.scrollTop+rect.top-bounds.top-scroll.clientHeight*anchor;
  if(intent.type==='scroll'&&source.scrollTop<=1)target=0;else if(intent.type==='scroll'&&source.scrollHeight>source.clientHeight&&source.scrollTop+source.clientHeight>=source.scrollHeight-2)target=scroll.scrollHeight;
  scroll.scrollTop=Math.max(0,Math.min(scroll.scrollHeight-scroll.clientHeight,target));
 }
 function queue(){if(!frame)frame=requestAnimationFrame(sync);}
 function follow(type='caret'){following=true;intent={type,offset:source.selectionDirection==='backward'?source.selectionStart:source.selectionEnd,anchor:intent?.anchor};queue();}
 for(const event of ['click','keyup','select','input','pointerup'])source.addEventListener(event,()=>follow());
 source.addEventListener('scroll',()=>follow('scroll'),{passive:true});
 document.addEventListener('selectionchange',()=>{if(document.activeElement===source)follow();});
 for(const event of ['wheel','pointerdown','touchstart'])scroll.addEventListener(event,()=>{following=false;},{passive:true});
 document.getElementById('title').addEventListener('focus',()=>{following=false;clearMark();scroll.scrollTop=0;});
 toggle.addEventListener('change',()=>{try{localStorage.setItem('ly-preview-follow-v1',toggle.checked?'on':'off');}catch{}if(toggle.checked)follow();else clearMark();});
 article.addEventListener('preview-reset',()=>{rendered=null;blocks=[];intent=null;following=false;clearMark();scroll.scrollTop=0;});
 article.addEventListener('preview-rendered',event=>{rendered=event.detail.body;lines=rendered.split('\n');let offset=0;starts=lines.map(line=>{const start=offset;offset+=line.length+1;return start;});blocks=[...article.querySelectorAll('[data-source-start]')].map(element=>({element,start:Number(element.dataset.sourceStart),end:Number(element.dataset.sourceEnd)}));queue();});
 article.addEventListener('load',queue,true);
 new MutationObserver(queue).observe(workspace,{attributes:true,attributeFilter:['data-layout']});
 if(window.ResizeObserver){new ResizeObserver(queue).observe(article);new ResizeObserver(queue).observe(source);}
 window.addEventListener('pageshow',queue);
 window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);frame=0;mirror.remove();});
})();
