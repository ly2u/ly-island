import {recommendedRecords,resumableRecord,readingHref} from '../../rqly-sites/public/rqly/island-content.mjs';
import './discovery.css';

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
export class IslandDiscovery {
 constructor(callbacks){
  this.callbacks=callbacks;
  this.resumeSlots=[document.querySelector('.growth-card'),document.querySelector('.reading-portals')].map((parent,index)=>{
   const slot=el('div','continue-reading');slot.hidden=true;slot.dataset.continueReading=String(index);
   if(index)parent.before(slot);else parent.append(slot);return slot;
  });
 }
 refresh(){
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
