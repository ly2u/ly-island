import {highlightParts} from './search-core.mjs';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const mark=(tag,value,query,cls)=>{const e=el(tag,cls);for(const part of highlightParts(value,query))e.append(part.match?el('mark','',part.text):document.createTextNode(part.text));return e;};
const kinds={note:'文章',blog:'文章',project:'项目'};
const root=document.getElementById('search-root');
if(root){
 const initial=new URLSearchParams(location.search);
 const state={q:initial.get('q')||'',kind:initial.get('kind')||'',organization:initial.get('collection')||initial.get('organization')||'',order:initial.get('order')||'relevance'};
 const form=el('form','search-page-form'),input=el('input','collection-search');
 input.type='search';input.maxLength=200;input.value=state.q;input.placeholder='输入关键词，例如 OpenVPN、桥梁、工具…';input.setAttribute('aria-label','搜索全站公开内容');
 const clear=el('button','button secondary search-page-clear','清除');clear.type='button';clear.hidden=!state.q;
 form.append(input,clear);
 const filters=el('div','search-page-filters');
 const makeSelect=(key,label,options)=>{
  const field=el('label','',label),select=el('select');select.setAttribute('aria-label',label);
  for(const [val,title]of options){const o=el('option','',title);o.value=val;select.append(o);}
  select.value=state[key];
  select.addEventListener('change',()=>{state[key]=select.value;syncURL();run();});
  field.append(select);filters.append(field);return select;
 };
 makeSelect('kind','类型',[['','全部类型'],['article','文章'],['project','项目']]);
 const orgSelect=makeSelect('organization','分类与归属',[['','全部分类与归属']]);
 makeSelect('order','排序',[['relevance','相关度优先'],['updated','最近更新'],['date','文章日期']]);
 const status=el('p','search-page-status');status.setAttribute('role','status');
 const list=el('div','notebook-list search-page-list'),more=el('button','button secondary','显示更多结果');more.type='button';more.hidden=true;
 root.replaceChildren(form,filters,status,list,more);

 const syncURL=()=>{
  const p=new URLSearchParams();
  if(state.q)p.set('q',state.q);if(state.kind)p.set('kind',state.kind);if(state.organization)p.set('collection',state.organization);if(state.order&&state.order!=='relevance')p.set('order',state.order);
  const qs=p.toString();history.replaceState(history.state,'',location.pathname+(qs?'?'+qs:''));
 };
 let timer,controller,epoch=0,next=null,loading=false;
 async function run(append=false){
  clearTimeout(timer);controller?.abort();controller=new AbortController();const req=controller,current=++epoch;
  state.q=input.value.trim();clear.hidden=!state.q;more.hidden=true;loading=true;
  if(!append)list.replaceChildren();status.textContent='正在检索…';
  const params=new URLSearchParams({q:state.q,kind:state.kind,organization:state.organization,order:state.order,offset:String(append?next||0:0)});
  try{
   const response=await fetch('/api/search?'+params,{signal:AbortSignal.any([req.signal,AbortSignal.timeout(10000)])});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'搜索暂时不可用。');
   if(current!==epoch)return;
   for(const [idx,hit]of data.results.entries()){
    const row=el('a','notebook-row');row.href='/notes/'+encodeURIComponent(hit.slug);
    row.append(el('span','notebook-number',String(list.children.length+1).padStart(2,'0')));
    const box=el('div');
    const meta=el('div','note-meta');meta.append(el('span','topic-tag',hit.category||'未分类'),el('time','',hit.date),el('span','',kinds[hit.kind]||'文章'));
    box.append(meta,mark('h2',hit.title,state.q),mark('p',hit.snippet,state.q));
    row.append(box);list.append(row);
   }
   next=data.nextOffset;more.hidden=next===null;
   status.textContent=state.q?'找到 '+data.total+' 条公开内容 · 已显示 '+list.children.length+' 条':'共 '+data.total+' 条公开内容';
   if(!data.total)list.append(el('p','empty-state','没有找到匹配的内容，试试换个关键词或放宽筛选条件。'));
  }catch(error){
   if(current!==epoch||error.name==='AbortError')return;
   status.textContent=error.message||'检索暂时失败，请稍后重试。';
  }finally{if(current===epoch)loading=false;}
 }
 fetch('/api/organization').then(r=>r.ok?r.json():null).then(data=>{
  const items=data?.catalog?.items||[];
  for(const item of items){
   const o=el('option','',({tag:'# ',topic:'分类 · ',series:'系列 · '}[item.type]||'')+item.name);o.value=item.id;orgSelect.append(o);
  }
  if(state.organization)orgSelect.value=state.organization;
 }).catch(()=>{});

 input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{syncURL();run();},180);});
 form.addEventListener('submit',e=>{e.preventDefault();syncURL();run();});
 clear.addEventListener('click',()=>{input.value='';syncURL();run();input.focus();});
 more.addEventListener('click',()=>{if(!loading)run(true);});
 run();requestAnimationFrame(()=>input.focus({preventScroll:true}));
}
