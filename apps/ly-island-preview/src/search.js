import './search.css';
import {highlightParts,terms} from '../../rqly-sites/public/rqly/search-core.mjs';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const mark=(tag,value,query,cls)=>{const e=el(tag,cls);for(const part of highlightParts(value,query))e.append(part.match?el('mark','',part.text):document.createTextNode(part.text));return e;};
const kinds={note:'笔记',blog:'博客',project:'项目'};
export function renderSearch(owner,scope=''){
 owner.searchStates??=new Map();const state=owner.searchStates.get(scope)||{q:'',kind:'',topic:'',order:'relevance',organization:''};owner.searchStates.set(scope,state);
 const panel=el('section','island-search-panel'),form=el('form','island-search-form'),input=el('input','collection-search');input.type='search';input.maxLength=200;input.value=state.q;input.placeholder=scope?'查找这里的标题、正文与资料…':'记得一句话，也能找到它。';input.setAttribute('aria-label','搜索公开正文');
 const clear=el('button','search-clear','清除');clear.type='button';clear.hidden=!state.q;form.append(input,clear);panel.append(form);
 if(!scope){const filters=el('div','search-filters');for(const [key,label,options] of [['kind','内容类型',[['','全部类型'],['note','笔记'],['blog','博客'],['project','项目']]],['topic','分类',[['','全部分类'],['记录','记录'],['工程','工程'],['探索','探索']]],['organization','内容归属',[['','全部归属'],...owner.publicDirectories().map(i=>[i.id,({tag:'标签 · ',topic:'专题 · ',series:'系列 · '}[i.type])+i.name])]],['order','排序',[['relevance','相关度优先'],['updated','最近更新'],['date','文章日期']]]]){const field=el('label','',label),select=el('select');select.setAttribute('aria-label',label);for(const [value,title] of options){const option=el('option','',title);option.value=value;select.append(option);}select.value=state[key];select.addEventListener('change',()=>{state[key]=select.value;run();});field.append(select);filters.append(field);}panel.append(filters);}
 else{const all=el('button','search-all-link','去全岛查找 →');all.type='button';all.addEventListener('click',()=>{owner.searchStates.set('',{q:input.value,kind:'',topic:'',order:'relevance'});owner.open('search');});panel.append(all);}
 const status=el('p','search-status'),list=el('div','search-results'),more=el('button','search-more','显示更多结果');status.setAttribute('role','status');more.type='button';more.hidden=true;panel.append(status,list,more);owner.content.append(panel);
 let timer,controller,epoch=0,next=null,loading=false;const roomToken=owner.token;
 const alive=()=>panel.isConnected&&roomToken===owner.token&&owner.dialog.open;
 const hideCollection=value=>{if(scope)for(const node of owner.content.children)if(node!==panel&&!node.classList.contains('collection-intro'))node.hidden=value;};
 async function run(append=false){
  if(!alive())return;clearTimeout(timer);controller?.abort();controller=new AbortController();owner.pending=controller;const requestController=controller;const current=++epoch;state.q=input.value.trim();clear.hidden=!state.q;more.hidden=true;
  if(scope&&!state.q){list.replaceChildren();status.textContent='输入关键词可检索这里的正文；公开内容才会出现。';hideCollection(false);loading=false;return;}
  loading=true;hideCollection(true);if(!append)list.replaceChildren();status.textContent='正在查找…';const params=new URLSearchParams({...state,scope,offset:String(append?next||0:0)}),timeout=setTimeout(()=>requestController.abort(),10000),signal=controller.signal;
  try{const response=await fetch('/api/search?'+params,{signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'搜索暂时不可用。');if(current!==epoch||!alive())return;for(const hit of data.results){const card=el('button','search-result');card.type='button';card.dataset.article=hit.slug;card.append(el('span','search-result-meta',(kinds[hit.kind]||'博客')+' / '+hit.topic+' / '+hit.date),mark('h2',hit.title,state.q),mark('p',hit.snippet,state.q),el('span','search-result-action',hit.matched.includes('body')?'打开并定位匹配正文 →':'打开这条记录 →'));card.addEventListener('click',()=>owner.open(scope||'search',hit.slug));list.append(card);}next=data.nextOffset;more.hidden=next===null;status.textContent=state.q?'找到 '+data.total+' 条公开内容 · 已显示 '+list.children.length+' 条':'最近留下的 '+data.total+' 条公开内容';if(!data.total)list.append(el('p','room-empty','没有找到。试试缩短关键词、用空格分开词语，或选择全部类型。'));
  }catch(error){if(current!==epoch||!alive())return;status.textContent=error.name==='AbortError'?'搜索等待超时，请重试。':error.message;const retry=el('button','search-retry','重新查找');retry.type='button';retry.addEventListener('click',()=>run());list.append(retry);}
  finally{clearTimeout(timeout);if(current===epoch)loading=false;}
 }
 input.addEventListener('input',()=>{controller?.abort();epoch++;clearTimeout(timer);timer=setTimeout(()=>run(),180);});form.addEventListener('submit',event=>{event.preventDefault();run();});clear.addEventListener('click',()=>{input.value='';run();input.focus();});more.addEventListener('click',()=>{if(!loading)run(true);});
 owner.dialog.addEventListener('close',()=>{clearTimeout(timer);controller?.abort();},{once:true});
 queueMicrotask(()=>{if(alive())run();});if(!scope)requestAnimationFrame(()=>input.focus({preventScroll:true}));
}
export function highlightArticleMatches(body,query){
 if(!terms(query).length)return null;const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode()){if(!walker.currentNode.parentElement?.closest('math'))nodes.push(walker.currentNode);}let first=null,budget=200;
 for(const node of nodes){if(!budget)break;const parts=highlightParts(node.textContent,query,{limit:budget});budget-=parts.filter(p=>p.match).length;if(!parts.some(p=>p.match))continue;const fragment=document.createDocumentFragment();for(const part of parts){const item=part.match?el('mark','reading-match',part.text):document.createTextNode(part.text);if(part.match&&!first)first=item;fragment.append(item);}node.replaceWith(fragment);}return first;
}
