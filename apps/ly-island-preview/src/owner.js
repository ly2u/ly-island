import './owner.css';
export class IslandOwner {
 constructor(callbacks){
  this.callbacks=callbacks;this.saved=JSON.stringify(callbacks.state());this.dirty=false;this.busy=false;
  this.panel=document.createElement('section');this.panel.className='owner-panel';this.panel.id='owner-panel';this.panel.setAttribute('aria-label','主人布置');
  this.panel.innerHTML='<div class="owner-heading"><span>我的岛 · 主人布置</span><select id="owner-phase" aria-label="选择岛屿外观"><option value="initial">初始小岛</option><option value="grown">扩展小岛</option></select></div><p class="owner-tip">点住建筑拖动位置，保存后访客看到同样的岛。</p><p id="owner-status" role="status"></p><div class="owner-actions"><button id="owner-save">保存并展示</button><button id="owner-reload">重新载入</button><a href="/admin">管理内容 ↗</a></div><button id="owner-import" hidden>载入这个浏览器以前的试摆布局</button>';
  document.getElementById('app').append(this.panel);document.body.classList.add('owner-mode');document.querySelector('.growth-card').hidden=true;
  this.phase=this.panel.querySelector('#owner-phase');this.phase.value=callbacks.state().phase;this.phase.addEventListener('change',()=>callbacks.phase(this.phase.value));
  this.panel.querySelector('#owner-save').addEventListener('click',()=>this.save());this.panel.querySelector('#owner-reload').addEventListener('click',()=>this.reload());
  const old={};for(const phase of ['initial','grown'])try{const layout=JSON.parse(localStorage.getItem('ly-island-layout-'+phase));if(layout&&typeof layout==='object')old[phase]=layout;}catch{}
  if(Object.keys(old).length&&callbacks.state().revision===0){const b=this.panel.querySelector('#owner-import');b.hidden=false;b.addEventListener('click',()=>{const state=structuredClone(callbacks.state());for(const [phase,layout] of Object.entries(old))for(const id of ['library','projects','workshop']){const p=layout[id];if(Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))state.layouts[phase][id]=p;}callbacks.apply(state);this.changed();this.status('旧试摆布局已载入。确认位置后点击保存并展示。');});}
  window.addEventListener('beforeunload',event=>{if(this.dirty){event.preventDefault();event.returnValue='';}});this.changed();
 }
 status(message,error=false){const p=this.panel.querySelector('#owner-status');p.textContent=message;p.classList.toggle('error',error);}
 changed(){this.phase.value=this.callbacks.state().phase;this.dirty=JSON.stringify(this.callbacks.state())!==this.saved;this.panel.querySelector('#owner-save').disabled=this.busy||!this.dirty;this.status(this.dirty?'有未展示的修改':'当前布局已展示 · 版本 '+this.callbacks.state().revision);}
 setBusy(value){this.busy=value;for(const e of this.panel.querySelectorAll('button,select'))e.disabled=value;this.callbacks.busy(value);if(!value)this.panel.querySelector('#owner-save').disabled=!this.dirty;}
 async save(){
  if(this.busy||!this.dirty)return;const state=structuredClone(this.callbacks.state());this.setBusy(true);this.status('正在保存…');
  try{const response=await fetch('/api/admin/island',{method:'PUT',headers:{'Content-Type':'application/json','X-Requested-With':'rqly-editor'},body:JSON.stringify({baseRevision:state.revision,island:state})});const data=await response.json();if(!response.ok)throw new Error(data.error||'保存未完成，请重试。');this.callbacks.apply(data.island);this.saved=JSON.stringify(data.island);this.dirty=false;this.status('已保存，刷新后的访客会看到你的新布局。');this.panel.querySelector('#owner-import').hidden=true;}
  catch(error){this.status(error.message,true);}finally{this.setBusy(false);}
 }
 async reload(){
  if(this.busy||(this.dirty&&!confirm('重新载入会放弃当前未保存的布置。继续吗？')))return;this.setBusy(true);
  try{const response=await fetch('/api/admin/island');const data=await response.json();if(!response.ok)throw new Error(data.error||'请先从管理入口登录。');this.callbacks.apply(data.island);this.saved=JSON.stringify(data.island);this.dirty=false;this.status('已载入服务器上的布局。');}catch(error){this.status(error.message,true);}finally{this.setBusy(false);}
 }
}
