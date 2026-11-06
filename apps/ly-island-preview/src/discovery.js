import {recommendedRecords,resumableRecord,readingHref} from '../../rqly-sites/public/rqly/island-content.mjs';
import './discovery.css';

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
export class IslandDiscovery {
 constructor(callbacks){
  this.callbacks=callbacks;this.buttons=new Map();this.hintId=null;
  this.hint=el('aside','building-hint');this.hint.id='building-content-hint';this.hint.setAttribute('role','tooltip');this.hint.hidden=true;document.getElementById('app').append(this.hint);
  this.resumeSlots=[document.querySelector('.growth-card'),document.querySelector('.reading-portals')].map((parent,index)=>{
   const slot=el('div','continue-reading');slot.hidden=true;slot.dataset.continueReading=String(index);
   if(index)parent.before(slot);else parent.append(slot);return slot;
  });
  window.addEventListener('resize',()=>{this.hintSize=null;this.placeHint();});
 }
 bindButton(id,button){
  this.buttons.set(id,button);
  button.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse')this.showHint(id);});
  button.addEventListener('pointerleave',()=>{if(document.activeElement!==button)this.hideHint();});
  button.addEventListener('focus',()=>this.showHint(id));button.addEventListener('blur',()=>this.hideHint());
 }
 showHint(id){
  if(!['library','projects','workshop'].includes(id)||document.body.classList.contains('room-open')||document.body.classList.contains('reading-mode')){this.hideHint();return;}
  if(id===this.hintId&&!this.hint.hidden)return;
  this.hideHint();this.hintId=id;this.drawHint();this.hint.hidden=false;this.buttons.get(id)?.setAttribute('aria-describedby',this.hint.id);this.placeHint();
 }
 hideHint(){if(this.hintId)this.buttons.get(this.hintId)?.removeAttribute('aria-describedby');this.hintId=null;this.hint.hidden=true;}
 drawHint(){
  const id=this.hintId;if(!id)return;this.hintSize=null;
  const {records,recommendations,curated}=recommendedRecords(this.callbacks.posts(),this.callbacks.island(),id);
  const names={library:'书屋',projects:'工程展馆',workshop:'工坊'},title=this.callbacks.island()?.buildings?.[id]?.name||names[id];
  this.hint.replaceChildren(el('p','hint-kicker','ON THE ISLAND / '+title));this.hint.append(el('h2','',title));
  let count=id==='library'?records.length+' 篇公开记录':id==='projects'?records.filter(p=>p.kind==='project').length+' 个项目 · '+records.filter(p=>p.kind!=='project').length+' 篇工程手记':'CivilFlow · 七嘴 · '+records.length+' 篇手记';
  if(!this.callbacks.loaded())count=this.callbacks.failed()?'记录暂未读取，可以进入后重试。':'正在整理公开记录…';
  this.hint.append(el('p','hint-count',count));
  if(this.callbacks.loaded()&&recommendations.length){this.hint.append(el('p','hint-section',curated?'岛主精选':'最近留下'));const list=el('ul','hint-records');for(const post of recommendations)list.append(el('li','',post.title));this.hint.append(list);}
  else if(this.callbacks.loaded())this.hint.append(el('p','hint-empty',id==='workshop'?'工具已经放在工作台，手记会慢慢积累。':'这里还留着位置，等待新的记录。'));
  if(id==='projects'){const active=records.filter(p=>p.kind==='project'&&p.project?.status==='active').length;if(active)this.hint.append(el('p','hint-active',active+' 个项目正在进行'));}
  this.hint.append(el('span','hint-enter','点击走进'+title+' →'));
 }
 placeHint(positions){
  const button=this.buttons.get(this.hintId);if(!button||this.hint.hidden)return;
  // Reuse the scene's projected label position while floating; measure DOM only
  // when opening, resizing or changing the card's content.
  const p=positions?.[this.hintId];let b;
  if(p&&this.buttonSize)b={left:p.x-this.buttonSize.width/2,width:this.buttonSize.width,top:p.y-this.buttonSize.height,bottom:p.y};
  else{b=button.getBoundingClientRect();this.buttonSize={width:b.width,height:b.height};}
  this.hintSize??={width:this.hint.offsetWidth,height:this.hint.offsetHeight};const {width,height}=this.hintSize;
  this.hint.style.left=Math.max(12,Math.min(innerWidth-width-12,b.left+b.width/2-width/2))+'px';
  const above=b.top-height-12;this.hint.style.top=Math.max(12,Math.min(innerHeight-height-12,above>88?above:b.bottom+12))+'px';
 }
 refresh(){
  if(this.hintId){this.drawHint();this.placeHint();}
  for(const link of document.querySelectorAll('.reading-portal[data-room-link]')){
   const id=link.dataset.roomLink;if(!['library','projects','workshop'].includes(id)||!this.callbacks.loaded())continue;
   const {records,recommendations}=recommendedRecords(this.callbacks.posts(),this.callbacks.island(),id);
   const count=id==='projects'?records.filter(p=>p.kind==='project').length+' 个项目':records.length+' 篇记录';
   const suffix=recommendations[0]?.title||(id==='workshop'?'CivilFlow 与七嘴已在工作台':'等待下一条记录');
   link.querySelector('small').textContent=count+' · '+suffix;
  }
  this.refreshResume();
 }
 refreshResume(){
  const resume=this.callbacks.loaded()?resumableRecord(this.callbacks.posts(),this.callbacks.positions()):null;
  for(const slot of this.resumeSlots){
   slot.replaceChildren();slot.hidden=!resume;if(!resume)continue;
   const a=el('a','continue-link');a.href=readingHref(resume.post,resume.room);a.append(el('small','','继续上次阅读'),el('strong','',resume.post.title),el('span','','读到 '+Math.round(resume.progress.ratio*100)+'% · 翻到书签 →'));
   const clear=el('button','continue-clear','清除本机记录');clear.type='button';clear.addEventListener('click',()=>this.callbacks.clearReading());slot.append(a,clear);
  }
 }
}
