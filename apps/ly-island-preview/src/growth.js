import {growthStats,growthBreakdown,growthRecords} from '../../rqly-sites/public/rqly/growth-core.mjs';
import {readingHref} from '../../rqly-sites/public/rqly/island-content.mjs';
import './growth.css';
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
export class GrowthPanel {
 constructor(callbacks){
  this.callbacks=callbacks;this.dialog=document.getElementById('growth-dialog');this.content=el('section','growth-content');this.content.id='growth-content';document.getElementById('growth-detail').after(this.content);
  this.banner=el('aside','growth-preview-banner');this.banner.hidden=true;this.banner.setAttribute('aria-label','扩岛外观预览');this.banner.append(el('span','','正在预览扩岛外观 · 不会改变已保存的岛屿'));
  this.exit=el('button','','回到实际小岛');this.exit.type='button';this.exit.addEventListener('click',()=>callbacks.stopPreview());this.banner.append(this.exit);document.getElementById('app').append(this.banner);
  const entry=el('button','growth-reading-entry','看看小岛如何成长 →');entry.type='button';entry.addEventListener('click',()=>this.open());document.querySelector('.reading-portals').after(entry);
  document.getElementById('close-growth').addEventListener('click',()=>this.dialog.close());
  this.dialog.addEventListener('close',()=>this.request?.abort());
 }
 open(){this.update();this.dialog.showModal();}
 setPreview(value){document.body.classList.toggle('growth-preview',value);this.banner.hidden=!value;}
 update(){
  const posts=this.callbacks.posts(),island=this.callbacks.island(),ready=this.callbacks.loaded(),stats=growthStats(posts,island||{}),grown=island?.phase==='grown';this.content.replaceChildren();
  document.getElementById('growth-detail').textContent=ready?(grown?'这里已经长成扩展小岛。':stats.unlocked?'扩岛已经解锁，主人当前选择萌芽外观。':stats.eligible?'积累已经达标，等待主人确认扩岛。':'从一条记录开始，离扩岛还有 '+stats.remaining+' 点。'):(this.callbacks.failed()?'公开记录暂未读取，积分明细稍后再看。':'正在整理公开记录…');
  const stages=el('div','growth-stages');for(const [id,label,detail] of [['initial','01 / 萌芽小岛','留下一点记录，三个空间慢慢充实。'],['grown','02 / 扩展小岛','书屋加层，展馆移至副岛，桥梁连接两岸。']]){const stage=el('article','growth-stage');if((grown?'grown':'initial')===id)stage.setAttribute('aria-current','step');stage.append(el('h3','',label),el('p','',detail),el('small','',island?.phase===id?'当前保存的外观':id==='grown'?(stats.unlocked?'已解锁':ready?'目标 '+stats.threshold+' 点':'等待积分读取'):'最初的模样'));stages.append(stage);}this.content.append(stages);
  if(ready){
   const total=el('div','growth-total');total.append(el('strong','',stats.score+' / '+stats.threshold+' 点'),el('span','',stats.unlocked?'扩岛解锁保留':stats.eligible?'已达标':'已积累 '+Math.min(100,Math.floor(stats.score/stats.threshold*100))+'%'));const progress=el('progress');progress.max=stats.threshold;progress.value=stats.score;progress.setAttribute('aria-label','实际公开内容积分');total.append(progress);this.content.append(total);
   const ledger=el('div','growth-ledger');for(const rule of growthBreakdown(stats)){const row=el('div','growth-ledger-row');row.append(el('span','',rule.label),el('span','',rule.count+' × '+rule.weight),el('strong','',rule.score+' 点'));ledger.append(row);}this.content.append(ledger,el('p','growth-note','完成项目共计 15 点：项目基础 5 点，加完成奖励 10 点。编辑同一条记录不会重复加分。'));
  }
  const changes=el('section','growth-changes');changes.append(el('h3','','扩岛后，建筑会怎样变化？'));const grid=el('div','growth-changes-grid');
  for(const [id,label,from,to] of [['library','书屋','一层书屋','三层书屋，增加藏书空间'],['projects','工程展馆','主岛上的一层展馆','副岛上的双层展馆，新增连接桥'],['workshop','工坊','一层工作间','双层工作间，保留工具入口']]){const card=el('article');card.append(el('h4','',island?.buildings?.[id]?.name||label),el('p','',from+' → '+to));grid.append(card);}changes.append(grid);this.content.append(changes);
  const actions=el('div','growth-preview-actions'),preview=el('button','growth-preview-button',this.busy?'正在准备场景…':grown?'当前已是扩展小岛':'在 3D 岛上预览扩岛');this.previewButton=preview;preview.type='button';preview.disabled=this.busy||!island||grown;
  preview.addEventListener('click',async()=>{
   if(this.busy)return;this.busy=true;preview.disabled=true;preview.textContent='正在准备场景…';this.request?.abort();const request=new AbortController();this.request=request;
   try{if(await this.callbacks.preview({signal:request.signal})){this.dialog.close();this.exit.focus({preventScroll:true});}else if(!request.signal.aborted)this.status.textContent='场景暂时无法预览，记录和成长明细仍可阅读。';}
   catch{if(!request.signal.aborted)this.status.textContent='场景暂时无法预览，请稍后再试。';}
   finally{this.busy=false;const button=this.previewButton,grown=this.callbacks.island()?.phase==='grown';button.disabled=!this.callbacks.island()||grown;button.textContent=grown?'当前已是扩展小岛':'在 3D 岛上预览扩岛';}
  });actions.append(preview,el('small','','预览会加载 3D 场景；退出后回到原来的视角和阅读模式。'));this.status=el('p','growth-note');this.status.setAttribute('role','status');this.content.append(actions,this.status);
  const trail=growthRecords(posts);if(ready&&trail.length){const section=el('section','growth-records');section.append(el('h3','','最近留下的公开记录'));const list=el('ol');for(const record of trail){const item=el('li'),link=el('a','',record.title);link.href=readingHref(record);link.addEventListener('click',()=>this.dialog.close());item.append(el('time','',record.date),link,el('small','',record.points+' 点'));list.append(item);}section.append(list,el('p','growth-note','按当前公开内容整理；草稿与回收站内容不会显示在这里。'));this.content.append(section);}
 }
}
