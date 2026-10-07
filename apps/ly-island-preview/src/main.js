import './style.css';
import './owner.css';
import {IslandRooms} from './rooms.js';


const $=id=>document.getElementById(id);
const definitions={library:{name:'书屋'},projects:{name:'工程展馆'},workshop:{name:'工坊'},about:{name:'岛主'},postoffice:{name:'信箱'}};
let scene=null,grown=false,dusk=false,arranging=false,posts=[],postsLoaded=false,messageTimer,roomOpen=false,ambientPaused=false,island=null,rules=null,owner=null;
let readingMode=false,sceneAttempt=0,modePaused=false,postsFailed=false;
let savedView=null;try{savedView=localStorage.getItem('ly-island-view');}catch{}
const preferReading=savedView==='reading'||(!savedView&&navigator.connection?.saveData);
const editRequested=new URLSearchParams(location.search).get('edit')==='1';
const buttons={};
$('labels').hidden=true;
function message(text){$('status-message').textContent=text;clearTimeout(messageTimer);messageTimer=setTimeout(()=>{$('status-message').textContent='';},2800);}
function highlight(id){for(const [key,b] of Object.entries(buttons))b.setAttribute('aria-pressed',String(key===id));}
const rooms=new IslandRooms({
 posts:()=>posts,loaded:()=>postsLoaded,failed:()=>postsFailed,retry:()=>loadPublicPosts(),island:()=>island,message,
 selection:id=>{
  highlight(id);scene?.select(id==='search'?null:id,false);
  if(id&&!roomOpen){ambientPaused=scene?.paused??false;scene?.setPaused(true);}
  if(!id&&roomOpen)scene?.setPaused(ambientPaused);
  roomOpen=Boolean(id);
 }
});
for(const [id,d] of Object.entries(definitions)){
 const b=document.createElement('button');b.className='building-label';b.dataset.building=id;b.setAttribute('aria-label','探索'+d.name);b.setAttribute('aria-pressed','false');
 const dot=document.createElement('span');dot.setAttribute('aria-hidden','true');const text=document.createElement('span');text.textContent=d.name;const arrow=document.createElement('span');arrow.className='label-arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');b.append(dot,text,arrow);
 b.addEventListener('click',()=>{if(arranging){scene?.select(id==='search'?null:id,false);highlight(id);}else rooms.open(id);});$('labels').append(b);buttons[id]=b;
}
function updateGrowth(){
 const notes=posts.filter(p=>p.kind==='note').length,blogs=posts.filter(p=>!p.kind||p.kind==='blog').length,projects=posts.filter(p=>p.kind==='project').length,completed=posts.filter(p=>p.kind==='project'&&p.project?.status==='done').length,score=notes+blogs*3+projects*5+completed*10,threshold=island?.growth?.threshold??30;
 $('island-label').textContent=island?.title||'一座开始生长的小岛';$('island-level').textContent=grown?'LV. 02':'LV. 01';$('island-state').textContent=grown?'繁盛小岛':'萌芽小岛';
 $('growth-description').textContent=postsLoaded?'已有 '+(notes+blogs)+' 篇记录 · '+projects+' 个项目':'公开记录暂时未读取';$('growth-number').textContent=postsLoaded?score+' / '+threshold:'—';$('progress-fill').style.width=Math.min(100,score/threshold*100)+'%';
 $('growth-hint').textContent=grown?'书屋加层 · 展馆扩岛 · 桥梁连接':island?.growth?.unlocked?'扩岛已解锁 · 当前选择萌芽外观':score>=threshold?'积累已达标 · 等待主人确认扩岛':'再积累 '+Math.max(0,threshold-score)+' 点，小岛就能扩展';$('growth-toggle').textContent='成长足迹 ↗';$('demo-note').hidden=true;
 $('growth-detail').textContent='公开笔记 '+notes+' × 1，博客 '+blogs+' × 3，项目 '+projects+' × 5，已完成项目 '+completed+' × 10。共 '+score+' 点，扩岛目标 '+threshold+' 点。'+(grown?'主人已经确认扩岛，之后撤回内容也不会拆掉已解锁的建筑。':'达到目标后，由主人确认并保存新的岛屿外观。');
 const recent=posts[0];$('latest-update').hidden=!recent;if(recent){$('latest-update').textContent='最近留下 · '+recent.title;$('latest-update').href='#room='+(recent.kind==='project'?'projects':'library')+'&article='+recent.slug;}
}
function setReadingMode(value,reason='暂时放下漂浮，留一点时间给文字。',remember=false){
 readingMode=value;document.body.classList.toggle('reading-mode',value);$('fallback').hidden=!value;$('loading').hidden=true;$('labels').hidden=value;
 $('fallback-reason').textContent=reason;$('view-toggle').textContent=value?'3D 小岛':'阅读模式';$('view-toggle').setAttribute('aria-pressed',String(value));
 if(scene){scene.setVisible(!value);if(value){modePaused=scene.paused;scene.setPaused(true);}else{scene.setPaused(roomOpen||modePaused);scene.resize();}}
 if(remember)try{localStorage.setItem('ly-island-view',value?'reading':'3d');}catch{}
}
function unavailable(){
 sceneAttempt++;setReadingMode(true,'小岛暂时没有浮起来，书屋、工程档案和工坊仍可以正常打开。');
}
function applyIsland(value){
 island=structuredClone(value);grown=value.phase==='grown';dusk=value.lighting==='dusk';
 for(const [id,b] of Object.entries(buttons))b.children[1].textContent=value.buildings[id]?.name||definitions[id].name;
 for(const label of document.querySelectorAll('[data-building-name]'))label.textContent=value.buildings[label.dataset.buildingName]?.name||definitions[label.dataset.buildingName].name;
 $('island-description').textContent=value.description;$('island-description').title=value.description;document.body.classList.toggle('dusk',dusk);
 $('light-toggle').setAttribute('aria-pressed',String(dusk));$('light-toggle').querySelector('span').textContent=dusk?'暮色':'午后';
 scene?.updateIsland(value);if(scene){scene.canvas.dataset.revision=String(value.revision);scene.setArrange(arranging);}
 updateGrowth();rooms.refresh();
}
async function boot(){
 if(editRequested){location.replace('/admin?view=island');return;}
 try{const r=await fetch('/api/island',{signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error();const data=await r.json();island=data.island;rules=data.rules;}catch{message('岛屿设置暂时未读取，正在显示默认小岛。');}
 if(island)applyIsland(island);
 if(preferReading)setReadingMode(true,navigator.connection?.saveData?'先用阅读模式，减少场景加载。随时可以回到 3D 小岛。':undefined);
 else if(!readingMode)startScene();
}
async function startScene(){
 if(scene?.contextLost){location.reload();return;}
 if(scene){setReadingMode(false);return;}
 const attempt=++sceneAttempt;readingMode=false;document.body.classList.remove('reading-mode');$('fallback').hidden=true;$('loading').hidden=false;$('view-toggle').textContent='阅读模式';$('view-toggle').setAttribute('aria-pressed','false');
 const timeout=setTimeout(()=>{if(attempt===sceneAttempt&&!scene)unavailable();},12000);
 try{
  const {IslandScene}=await import('./scene.js');if(attempt!==sceneAttempt||readingMode)return;
  scene=new IslandScene($('world'),{
   select:id=>{if(arranging)highlight(id);else if(id)rooms.open(id);},message,unavailable,
   scenery:(phase,value)=>{if(owner){island.scenery??={};island.scenery[phase]=value;owner.changed();}},layout:(phase,layout)=>{if(owner){island.layouts[phase]=layout;owner.changed();}},
   labels:positions=>{for(const [id,p] of Object.entries(positions)){const b=buttons[id];b.style.left=p.x+'px';b.style.top=p.y+'px';b.hidden=!p.visible;}$('loading').hidden=true;}
  },island,rules);
  if(scene.paused){$('motion-toggle').setAttribute('aria-pressed','true');$('motion-toggle').setAttribute('aria-label','继续漂浮');}
  if(roomOpen){ambientPaused=scene.paused;scene.setPaused(true);}
  $('labels').hidden=false;if(island){scene.setLight(dusk);scene.canvas.dataset.revision=String(island.revision);}
 }catch{if(attempt===sceneAttempt)unavailable();}
 finally{clearTimeout(timeout);}
}
boot();
fetch('/api/auth/session').then(r=>r.json()).then(data=>{if(data.authenticated){$('account-entry').href='/admin';$('account-entry').textContent='管理平台';}}).catch(()=>{});
$('growth-toggle').addEventListener('click',()=>$('growth-dialog').showModal());$('close-growth').addEventListener('click',()=>$('growth-dialog').close());$('latest-update').addEventListener('click',event=>{event.preventDefault();const p=posts[0];if(p)rooms.open(p.kind==='project'?'projects':'library',p.slug);});
$('reset-view').addEventListener('click',()=>{scene?.resetView();message('已回到岛屿全景');});
$('arrange-toggle').addEventListener('click',()=>{
 if(!scene)return;arranging=!arranging;scene.setArrange(arranging);$('arrange-toggle').setAttribute('aria-pressed',String(arranging));$('arrange-hint').hidden=!arranging;
 $('interaction-hint').textContent=arranging?'拖动建筑布置 · 空白处拖动旋转':'拖动旋转 · 滚轮缩放 · 点击建筑探索';scene.select(null,false);highlight(null);message(arranging?'点住建筑，试试换个位置':'已退出布置模式');
});
$('reset-layout').addEventListener('click',()=>{scene?.resetLayout();message('已恢复这一阶段的默认布局');});
$('light-toggle').addEventListener('click',()=>{
 if(!scene)return;dusk=!dusk;document.body.classList.toggle('dusk',dusk);scene.setLight(dusk);if(owner){island.lighting=dusk?'dusk':'afternoon';owner.changed();}$('light-toggle').setAttribute('aria-pressed',String(dusk));$('light-toggle').querySelector('span').textContent=dusk?'暮色':'午后';
});
$('motion-toggle').addEventListener('click',()=>{
 if(!scene)return;scene.setPaused(!scene.paused);$('motion-toggle').setAttribute('aria-pressed',String(scene.paused));$('motion-toggle').setAttribute('aria-label',scene.paused?'继续漂浮':'暂停漂浮');$('motion-toggle').querySelector('svg').innerHTML=scene.paused?'<path d="m8 5 10 7-10 7Z"/>':'<path d="M9 5v14M15 5v14"/>';
});
$('view-toggle').addEventListener('click',()=>{
 if(readingMode){try{localStorage.setItem('ly-island-view','3d');}catch{}startScene();}
 else{sceneAttempt++;setReadingMode(true,undefined,true);}
});
$('retry-scene').addEventListener('click',()=>{try{localStorage.setItem('ly-island-view','3d');}catch{}startScene();});
for(const a of document.querySelectorAll('[data-room-link]')){
 const room=a.dataset.roomLink;a.href='#room='+room;a.addEventListener('click',event=>{event.preventDefault();rooms.open(room);});
}
async function loadPublicPosts(){
 postsFailed=false;rooms.refresh();
 try{const response=await fetch('/api/posts',{signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('public posts unavailable');const data=await response.json();if(!Array.isArray(data.posts))throw new Error('invalid posts');posts=data.posts.filter(p=>p&&typeof p.slug==='string'&&typeof p.title==='string'&&typeof p.date==='string'&&p.published===true);postsLoaded=true;}catch{posts=[];postsLoaded=false;postsFailed=true;}
 updateGrowth();rooms.refresh();
}
loadPublicPosts();
