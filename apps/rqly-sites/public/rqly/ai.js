(()=>{
const $=id=>document.getElementById(id), workspace=$('ai-workspace');if(!workspace)return;
const effortNames={none:'不思考',low:'轻度',medium:'中等',high:'深入',xhigh:'更深入',max:'最高'};
let catalog,csrf,username,controller,messages=[],historyKey,elapsedTimer;
const status=(message,error=false)=>{$('ai-status').textContent=message;$('ai-status').classList.toggle('error',error);};
function store(){try{sessionStorage.setItem(historyKey,JSON.stringify(messages));}catch{status('当前浏览器无法暂存对话，可以下载后保存。');}}
function preference(){try{return JSON.parse(localStorage.getItem('ly-ai-preferences-v1')||'{}');}catch{return {};}}
function savePreference(){try{localStorage.setItem('ly-ai-preferences-v1',JSON.stringify({model:$('ai-model').value,effort:$('ai-effort').value}));}catch{}}
function efforts(value){const model=catalog.models.find(m=>m.id===$('ai-model').value);$('ai-effort').replaceChildren(...model.efforts.map(e=>{const o=document.createElement('option');o.value=e;o.textContent=effortNames[e]||e;return o;}));$('ai-effort').value=model.efforts.includes(value)?value:model.defaultEffort;}
function render(){
 $('ai-messages').replaceChildren();$('ai-empty').hidden=messages.length>0;
 for(const message of messages){const article=document.createElement('article');article.className='ai-message '+message.role;
  const header=document.createElement('header'),name=document.createElement('strong');name.textContent=message.role==='user'?'我':message.model?catalog?.models.find(m=>m.id===message.model)?.name||message.model:'AI 助手';header.append(name);
  if(message.effort){const meta=document.createElement('span');meta.textContent=effortNames[message.effort]||message.effort;header.append(meta);}
  const content=document.createElement('div');content.className='ai-message-text';content.textContent=message.content;article.append(header,content);
  if(message.role==='assistant'){const copy=document.createElement('button');copy.className='text-button';copy.type='button';copy.textContent='复制回答';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(message.content);status('回答已复制。');}catch{status('浏览器未允许复制，可以选择文字或下载对话。',true);}});article.append(copy);}
  $('ai-messages').append(article);
 }
}
function busy(value){for(const id of ['ai-send','ai-model','ai-effort','ai-new','ai-export','ai-site-tools'])$(id).disabled=value;$('ai-cancel').hidden=!value;$('ai-messages').setAttribute('aria-busy',String(value));}
async function init(){try{
 const session=await(await fetch('/api/auth/session')).json();if(!session.authenticated)throw new Error('请重新登录后使用 AI 助手。');csrf=session.csrfToken;username=session.username;historyKey='ly-ai-chat-v1:'+username;
 const response=await fetch('/api/ai/models'),data=await response.json();if(!response.ok)throw new Error(data.error||'模型目录暂时无法读取。');catalog=data;
 $('ai-model').replaceChildren(...catalog.models.map(m=>{const option=document.createElement('option');option.value=m.id;option.textContent=m.name;return option;}));const pref=preference();$('ai-model').value=catalog.models.some(m=>m.id===pref.model)?pref.model:catalog.defaultModel;efforts(pref.effort||catalog.defaultEffort);
 try{const saved=JSON.parse(sessionStorage.getItem(historyKey)||'[]');if(Array.isArray(saved))messages=saved.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.length<=80000).slice(-20);}catch{}
 render();busy(false);status('已连接 Codex 订阅 · 默认 Luna / 中等');
 }catch(error){status(error.message,true);$('ai-send').disabled=true;}}
async function loadActions(extra=[]){
 try{const response=await fetch('/api/ai/actions');if(!response.ok)return;const data=await response.json();const items=[...extra.filter(a=>a.type==='draft'),...data.actions];$('ai-operations').replaceChildren();
  for(const action of items){const card=document.createElement('article');card.className='ai-action-card';const title=document.createElement('strong');title.textContent=(action.type==='draft'?'草稿已保存 · ':action.type==='publish'?'待确认发布 · ':'待确认更新 · ')+action.title;card.append(title);
   if(action.type==='draft'){const p=document.createElement('p');p.textContent='仅管理员可见，可以到草稿箱继续编辑。';const link=document.createElement('a');link.href='/admin?view=drafts';link.textContent='打开草稿箱 →';card.append(p,link);}
   else {const detail=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');summary.textContent='展开正文预览';body.className='ai-action-preview';body.textContent=action.body;detail.append(summary,body);card.append(detail);const note=document.createElement('p');note.textContent=action.type==='publish'?'确认后，这篇内容将公开展示在岛上。':action.published?'确认后，将修改已经公开的内容。':'确认后，将修改这条私人草稿。';card.append(note);const apply=document.createElement('button');apply.type='button';apply.className='primary';apply.textContent=action.type==='publish'?'确认发布':'确认更新';apply.addEventListener('click',async()=>{apply.disabled=true;try{const session=await(await fetch('/api/auth/session')).json();const response=await fetch('/api/ai/actions/confirm',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'rqly-editor','X-CSRF-Token':session.csrfToken},body:JSON.stringify({id:action.id})});const value=await response.json();if(!response.ok)throw new Error(value.error||'操作没有完成。');status(action.type==='publish'?'文章已发布，可以在岛上阅读。':'内容已更新。');await loadActions();}catch(error){status(error.message,true);apply.disabled=false;}});card.append(apply);}
   $('ai-operations').append(card);
  }
 }catch{status('待确认操作暂时无法读取，请稍后刷新。',true);}
}
const ready=init().then(()=>{if(catalog)loadActions();});
$('ai-model').addEventListener('change',()=>{efforts('medium');savePreference();});$('ai-effort').addEventListener('change',savePreference);
$('ai-question').addEventListener('input',()=>{$('ai-count').textContent=$('ai-question').value.length.toLocaleString()+' / 8,000';});
$('ai-form').addEventListener('submit',async event=>{
 event.preventDefault();await ready;if(!catalog||controller)return;const content=$('ai-question').value.trim();if(!content)return;
 const context=messages.slice(-18).map(({role,content})=>({role,content:content.slice(0,8000)}));while(context.reduce((sum,m)=>sum+m.content.length,0)+content.length>30000)context.splice(0,2);
 const question={role:'user',content};controller=new AbortController();busy(true);const started=Date.now();status('正在思考…');elapsedTimer=setInterval(()=>status('正在思考 · '+Math.floor((Date.now()-started)/1000)+' 秒'),1000);
 const timeout=setTimeout(()=>controller?.abort('timeout'),190000);messages.push(question);render();$('ai-messages').lastElementChild?.scrollIntoView({behavior:'smooth',block:'nearest'});
 try{
  const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'rqly-editor','X-CSRF-Token':csrf},body:JSON.stringify({messages:[...context,question],model:$('ai-model').value,effort:$('ai-effort').value,siteTools:$('ai-site-tools').checked}),signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'这次对话未能完成。');
  window.dispatchEvent(new Event('ly-ai-completed'));await loadActions(data.operations||[]);messages.push({role:'assistant',content:data.answer,model:data.model,effort:data.effort});messages=messages.slice(-20);store();render();if($('ai-question').value.trim()===content){$('ai-question').value='';$('ai-count').textContent='0 / 8,000';}clearInterval(elapsedTimer);status('回答完成 · '+Math.round((Date.now()-started)/1000)+' 秒');$('ai-messages').lastElementChild?.scrollIntoView({behavior:'smooth',block:'nearest'});
 }catch(error){messages=messages.filter(m=>m!==question);render();clearInterval(elapsedTimer);status(controller.signal.aborted?(controller.signal.reason==='timeout'?'等待超时，请缩短问题或降低思考深度。':'本次请求已取消，输入内容仍在；已完成的草稿操作仍会保留。'):error.message,true);}
 finally{clearTimeout(timeout);clearInterval(elapsedTimer);controller=null;busy(false);$('ai-question').focus();}
});
$('ai-cancel').addEventListener('click',()=>controller?.abort('cancelled'));
$('ai-new').addEventListener('click',()=>{if(messages.length&&!confirm('清空当前对话？需要保留时请先下载。'))return;messages=[];store();render();status('已开启新对话。');$('ai-question').focus();});
$('ai-export').addEventListener('click',()=>{if(!messages.length){status('还没有可以下载的对话。');return;}const content=messages.map(m=>'## '+(m.role==='user'?'我':m.model||'AI 助手')+'\n\n'+m.content).join('\n\n');const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='ly-ai-chat.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('pagehide',()=>controller?.abort());
$('logout-button')?.addEventListener('click',()=>{if(historyKey)try{sessionStorage.removeItem(historyKey);}catch{};});
})();
