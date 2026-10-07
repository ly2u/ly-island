import {ROLE_META,EXAMPLE_TEXT,reviewRules,validateReviewInput,reviewMarkdown} from './review-core.mjs';
const aiEffortNames={none:'不思考',low:'轻度',medium:'中等',high:'深入',xhigh:'更深入',max:'最高'};
const $=id=>document.getElementById(id);let config={aiEnabled:false,tokenRequired:false},selectedRole='expert',controller=null,aiCatalog=null,aiCsrf=null;
let lastInput={text:EXAMPLE_TEXT,audience:'旅游与交通跨界受众',duration:25,engine:'rules'};let result=reviewRules(lastInput);let exampleResult=true;
function list(id,items){$(id).replaceChildren(...items.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));}
function showResult(){$('result-summary').textContent=result.summary||'';$('result-summary-box').hidden=!result.summary;const meta=ROLE_META[selectedRole],role=result.roles[selectedRole];$('role-symbol').textContent=meta.number;$('role-symbol').className='role-symbol '+selectedRole;$('role-title').textContent=meta.title;$('role-description').textContent=meta.description;$('assessment').textContent=role.assessment;list('strengths',role.strengths);list('suggestions',role.suggestions);$('rewrite-box').hidden=!role.rewrite;$('rewrite').textContent=role.rewrite||'';$('evidence-box').hidden=!role.evidence?.length;list('evidence',role.evidence||[]);$('result-label').textContent=(exampleResult?'示例稿 · ':'')+result.label;$('result-method').textContent=result.method==='ai'?'AI 提出的审阅意见'+(result.model?' · '+result.model+' / '+(aiEffortNames[result.effort]||result.effort):''):'基于规则的检查提示';$('role-panel').setAttribute('aria-labelledby','tab-'+selectedRole);document.querySelectorAll('.role-tab').forEach(tab=>{const active=tab.dataset.role===selectedRole;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});}
function changeRole(key){if(!ROLE_META[key])throw new Error('未知的审阅视角。');selectedRole=key;showResult();$('copy-status').textContent='';}
document.querySelectorAll('.role-tab').forEach(tab=>{tab.addEventListener('click',()=>changeRole(tab.dataset.role));tab.addEventListener('keydown',e=>{const keys=Object.keys(ROLE_META);let index=keys.indexOf(selectedRole);if(e.key==='ArrowRight')index=(index+1)%3;else if(e.key==='ArrowLeft')index=(index+2)%3;else if(e.key==='Home')index=0;else if(e.key==='End')index=2;else return;e.preventDefault();changeRole(keys[index]);$('tab-'+keys[index]).focus();});});
function updateCount(){$('word-count').textContent=`${$('review-text').value.length.toLocaleString()} / 12,000 字符`;}
function revealResult(){
 const heading=$('result-heading');heading.focus({preventScroll:true});
 heading.closest('.result-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
$('view-result').addEventListener('click',revealResult);
function updateMode(){const ai=$('engine').value==='ai';$('mode-badge').textContent=ai?'AI 审阅':'基础检查';$('ai-quota').hidden=!(ai&&config.personalAI&&config.authenticated);$('ai-settings').hidden=!(ai&&config.personalAI&&config.authenticated);$('token-label').hidden=!(ai&&config.tokenRequired);$('submit-label').textContent=ai?'开始 AI 审阅':'开始基础检查';$('engine-hint').textContent=ai?'按你的受众和时长，给出三个视角的修改建议。':'基础检查根据句长、术语和表述特征给出提示，不调用 AI 模型。';}
$('engine').addEventListener('change',updateMode);$('review-text').addEventListener('input',updateCount);$('load-example').addEventListener('click',()=>{$('review-text').value=EXAMPLE_TEXT;updateCount();$('form-error').hidden=true;$('review-text').focus();$('review-text').setSelectionRange(0,0);$('review-text').scrollTop=0;});
function setBusy(value){
 for(const id of ['engine','ai-model','ai-effort'])$(id).disabled=value;
 $('submit-review').disabled=value;$('loading-spinner').hidden=!value;$('review-progress').hidden=!value;$('cancel-review').hidden=!value;
 $('export-review').disabled=value;$('copy-role').disabled=value;$('view-result').disabled=value;
 $('role-panel').setAttribute('aria-busy',String(value));document.querySelectorAll('.role-tab').forEach(tab=>tab.disabled=value);
 $('role-panel').hidden=value;$('result-summary-box').hidden=value||!result.summary;
 if(value){$('review-completion').hidden=true;$('view-result').hidden=true;$('result-state').textContent='正在审阅本次稿件，完成后会显示三个视角的意见。';}
}
async function runReview(raw){
 if(controller)throw new Error('上一份稿件还在审阅中，请等待或先取消。');
 let input;
 try{
  input=validateReviewInput(raw);
  if(input.engine==='ai'&&config.personalAI&&!config.authenticated)throw new Error('请先用管理员账号登录，再使用个人 AI 审阅。');
  if(input.engine==='ai'&&!config.aiEnabled)throw new Error('AI 审阅尚未开放，可以先使用基础检查。');
 }catch(error){$('form-error').textContent=error.message;$('form-error').hidden=false;throw error;}
 $('form-error').hidden=true;$('copy-status').textContent='';controller=new AbortController();setBusy(true);
 const started=Date.now(),updateProgress=()=>{$('review-progress').textContent=(input.engine==='ai'?'正在阅读稿件，整理三个视角的意见':'正在检查句长、术语与表述')+' · 已等待 '+Math.floor((Date.now()-started)/1000)+' 秒';};
 const tick=()=>{updateProgress();$('review-completion').textContent=$('review-progress').textContent;$('review-completion').hidden=false;};tick();const ticker=setInterval(tick,1000),timeout=setTimeout(()=>controller?.abort('timeout'),190000);
 let completed=false;
 try{
  let next;
  if(input.engine==='rules')next=reviewRules(input);
  else{
   const response=await fetch('./api/review',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'qizui',...(aiCsrf?{'X-CSRF-Token':aiCsrf}:{}),...($('access-token').value?{'Authorization':'Bearer '+$('access-token').value}:{})},body:JSON.stringify({...input,...(config.personalAI?{model:$('ai-model').value,effort:$('ai-effort').value}:{})}),signal:controller.signal});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'审阅未能完成，请稍后重试。');next=data.result;
  }
  window.dispatchEvent(new Event('ly-ai-completed'));result=next;lastInput=input;exampleResult=false;showResult();completed=true;
  const message='审阅完成 · '+(input.engine==='ai'?'AI 审阅':'基础检查')+' · '+Math.max(1,Math.round((Date.now()-started)/1000))+' 秒 · 3 个视角';
  $('review-completion').textContent=message;$('review-completion').hidden=false;$('view-result').hidden=false;$('result-state').textContent=message+'，点击下方标签切换意见。';
  return {method:result.method,summary:result.summary,roles:result.roles};
 }catch(error){
  const message=controller?.signal.aborted?(controller.signal.reason==='timeout'?'审阅用时较长，已停止等待。请稍后重试。':'本次审阅已取消，稿件仍在。'):error.message;
  $('form-error').textContent=message;$('form-error').hidden=false;$('review-completion').hidden=true;
  $('result-state').textContent='本次审阅未完成。下方保留的是'+(exampleResult?'示例意见':'上一次完成的意见')+'。';throw new Error(message);
 }finally{
  clearTimeout(timeout);clearInterval(ticker);controller=null;setBusy(false);if(completed)revealResult();
 }
}
$('review-form').addEventListener('submit',event=>{event.preventDefault();runReview({text:$('review-text').value,audience:$('audience').value,duration:Number($('duration').value),engine:$('engine').value}).catch(()=>{});});$('cancel-review').addEventListener('click',()=>controller?.abort('cancelled'));
$('export-review').addEventListener('click',()=>{const blob=new Blob([reviewMarkdown(result,lastInput)],{type:'text/markdown;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='qizui-review.md';a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);});
$('copy-role').addEventListener('click',async()=>{const role=result.roles[selectedRole];const text=`${ROLE_META[selectedRole].name}（${result.label}）\n\n${role.assessment}\n\n值得保留\n${role.strengths.map(s=>'• '+s).join('\n')}\n\n优先修改\n${role.suggestions.map((s,i)=>(i+1)+'. '+s).join('\n')}${role.rewrite?'\n\n表达参考\n'+role.rewrite:''}${role.evidence?.length?'\n\n需要补充的依据\n'+role.evidence.join('\n'):''}`;try{await navigator.clipboard.writeText(text);$('copy-status').textContent='这个视角的意见已复制。';}catch{$('copy-status').textContent='当前浏览器未允许复制，可以下载完整意见。';}});
showResult();updateCount();updateMode();

function aiPreference(){try{return JSON.parse(localStorage.getItem('ly-ai-preferences-v1')||'{}');}catch{return {};}}
function saveAIPreference(){try{localStorage.setItem('ly-ai-preferences-v1',JSON.stringify({model:$('ai-model').value,effort:$('ai-effort').value}));}catch{}}
function fillAIEfforts(value){const model=aiCatalog.models.find(m=>m.id===$('ai-model').value);$('ai-effort').replaceChildren(...model.efforts.map(e=>{const o=document.createElement('option');o.value=e;o.textContent=aiEffortNames[e]||e;return o;}));$('ai-effort').value=model.efforts.includes(value)?value:model.defaultEffort;}
$('ai-model').addEventListener('change',()=>{fillAIEfforts('medium');saveAIPreference();});$('ai-effort').addEventListener('change',saveAIPreference);
$('ai-logout').addEventListener('click',async()=>{try{const response=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'qizui','X-CSRF-Token':aiCsrf},body:'{}'});if(response.ok)location.reload();}catch{$('ai-connection').textContent='退出未完成，请稍后重试。';}});
if(location.protocol!=='file:'){
 (async()=>{try{const response=await fetch('./api/config');if(!response.ok)throw new Error();config=await response.json();
  if(config.personalAI){
   $('ai-option').textContent=config.authenticated?'个人 AI 审阅':'个人 AI 审阅 · 需站主登录';
   $('ai-login-link').hidden=Boolean(config.authenticated);$('ai-logout').hidden=!config.authenticated;
   if(config.authenticated){const session=await(await fetch('/api/auth/session')).json();aiCsrf=session.csrfToken;
    const response=await fetch('/api/ai/models');aiCatalog=await response.json();if(!response.ok)throw new Error(aiCatalog.error||'模型目录暂时无法读取。');
    $('ai-model').replaceChildren(...aiCatalog.models.map(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.name;return o;}));const pref=aiPreference();$('ai-model').value=aiCatalog.models.some(m=>m.id===pref.model)?pref.model:aiCatalog.defaultModel;fillAIEfforts(pref.effort||aiCatalog.defaultEffort);
    $('ai-option').disabled=false;$('engine').value='ai';$('ai-connection').textContent='已登录站主账号 · 使用 Codex 订阅额度';
   }else $('ai-connection').textContent='基础检查直接可用；个人 AI 审阅需使用主站管理员账号登录。';
  }else if(config.aiEnabled){$('ai-option').disabled=false;$('ai-option').textContent='AI 审阅';$('engine').value='ai';}
  updateMode();
 }catch(error){$('ai-connection').textContent=error.message||'连接暂时不可用，基础检查仍可使用。';}})();
}
if(document.modelContext?.registerTool){const lifecycle=new AbortController();const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};register({name:'read_review',description:'读取当前可见的七嘴审阅结果，并明确它是示例、基础检查还是 AI 意见。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({example:exampleResult,...result})});register({name:'stage_review',description:'把稿件、受众与时长填入七嘴工作台，不提交稿件，也不调用模型。',inputSchema:{type:'object',properties:{text:{type:'string',minLength:40,maxLength:12000},audience:{type:'string',enum:['旅游与交通跨界受众','专业技术人员','管理人员','普通公众']},duration:{type:'integer',enum:[5,10,20,25,30]}},required:['text','audience','duration'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:raw=>{const input=validateReviewInput({...raw,engine:'rules'});$('review-text').value=input.text;$('audience').value=input.audience;$('duration').value=String(input.duration);updateCount();return{staged:true,characters:input.text.length};}});register({name:'run_basic_review',description:'对当前工作台里的稿件执行基础规则检查，并更新可见审阅结果；不调用 AI，不向模型发送正文。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:()=>runReview({text:$('review-text').value,audience:$('audience').value,duration:Number($('duration').value),engine:'rules'})});window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}
