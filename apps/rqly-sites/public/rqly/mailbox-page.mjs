const el=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e;};
const nonce=()=>{const s=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);};
const root=document.getElementById('mailbox-root');
if(root){
 let draft={kind:'guestbook',name:'',title:'',contact:'',body:'',nonce:nonce()};
 const board=el('section','mailbox-board'),desk=el('section','mailbox-desk');
 board.append(el('h2','mailbox-section-title','公开留言簿'));
 const list=el('div','mailbox-messages'),boardStatus=el('p','mailbox-status');boardStatus.setAttribute('role','status');
 const more=el('button','button secondary mailbox-more','再看一些留言 ↓');more.type='button';more.hidden=true;
 let offset=0,loading=false;
 const load=async(reset=false)=>{
  if(loading)return;loading=true;more.disabled=true;boardStatus.textContent='正在打开留言簿…';
  try{
   const response=await fetch('/api/mailbox?offset='+(reset?0:offset));
   const data=await response.json();if(!response.ok)throw new Error(data.error||'留言暂时没有读取到。');
   if(reset)list.replaceChildren();
   for(const item of data.messages){
    const note=el('article','mailbox-note'),head=el('header');
    head.append(el('strong','',item.name),el('time','',new Date(item.createdAt).toLocaleDateString('zh-CN')));
    note.append(head,el('p','mailbox-note-body',item.body));
    if(item.reply){const reply=el('div','mailbox-reply');reply.append(el('strong','','岛主回信'),el('p','',item.reply));note.append(reply);}
    list.append(note);
   }
   offset=data.nextOffset;more.hidden=offset===null;
   boardStatus.textContent=list.children.length?'公开留言均经岛主审核后展示。':'留言簿还空着，留下一句问候吧。';
  }catch{
   boardStatus.textContent='留言簿暂时没有打开，右侧仍可投递来信。';more.textContent='重新打开留言簿';more.hidden=false;offset=0;
  }finally{loading=false;more.disabled=false;}
 };
 more.addEventListener('click',()=>load(offset===0));
 board.append(list,boardStatus,more);

 desk.append(el('h2','mailbox-section-title','投进岛主的信箱'));
 const form=el('form','mailbox-form');form.setAttribute('aria-label','给小岛留言或给岛主写信');
 const field=(label,node)=>{const wrapper=el('label','',label);wrapper.append(node);form.append(wrapper);return node;};
 const kind=el('select');kind.id='mail-kind';
 for(const [value,label]of [['guestbook','公开留言 · 审核后展示'],['letter','给岛主的私信 · 仅岛主可见']]){const o=el('option','',label);o.value=value;kind.append(o);}
 kind.value=draft.kind;field('投递方式',kind);
 const name=field('你的称呼',el('input'));name.id='mail-name';name.maxLength=32;name.placeholder='可以用昵称，也可以不署名';
 const title=field('信件标题（选填）',el('input'));title.id='mail-title';title.maxLength=80;
 const contact=field('回信邮箱（选填，仅岛主可见）',el('input'));contact.id='mail-contact';contact.type='email';contact.maxLength=150;contact.autocomplete='email';
 const body=field('想留下的话',el('textarea'));body.id='mail-body';body.required=true;body.maxLength=3000;body.rows=7;body.placeholder='写一点想法、问候，或者想和岛主聊的事情。';
 const count=el('span','mailbox-count'),hint=el('p','mailbox-hint'),trap=el('input','mailbox-trap');
 trap.name='website';trap.tabIndex=-1;trap.autocomplete='off';trap.setAttribute('aria-hidden','true');
 form.append(trap,count,hint);
 const submit=el('button','button primary','投递'),status=el('p','mailbox-submit-status');
 submit.id='mail-submit';submit.type='submit';status.id='mail-status';status.setAttribute('role','status');
 form.append(submit,status);
 const update=()=>{
  draft={...draft,kind:kind.value,name:name.value,title:title.value,contact:contact.value,body:body.value};
  count.textContent=body.value.length+' / 3,000';
  title.closest('label').hidden=kind.value!=='letter';
  hint.textContent=kind.value==='letter'?'这封信只进入岛主的管理信箱，不会公开展示。':'留言需经岛主审核后公开；邮箱始终只对岛主可见。';
 };
 form.addEventListener('input',update);kind.addEventListener('change',update);update();
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(submit.disabled)return;update();
  const payload={...draft,website:trap.value};submit.disabled=true;status.textContent='正在投递…';
  try{
   const response=await fetch('/api/mailbox',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'rqly-editor'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'信件未能投递。');
   status.textContent=data.kind==='letter'?'信已投进岛主信箱，只有岛主能看到。':'留言已投递，审核后会出现在留言簿。';
   body.value='';title.value='';draft={...draft,body:'',title:'',nonce:nonce()};update();
  }catch(error){
   status.textContent=error.name==='TimeoutError'?'投递等待超时，文字仍在。请稍后重试。':error.message==='Failed to fetch'?'投递未完成，文字仍在。请检查网络后重试。':error.message;
  }finally{submit.disabled=false;}
 });
 const privacy=el('details','mailbox-privacy');
 privacy.append(el('summary','','来信与隐私说明'),el('p','','公开留言经审核后展示；私信、标题和选填邮箱仅岛主可见，不会自动发邮件。如需删除，请通过私信联系。'));
 const privacyLink=el('a','plain-link','查看完整隐私说明 →');privacyLink.href='/privacy';privacy.append(privacyLink);
 desk.append(form,privacy);
 root.replaceChildren(board,desk);
 load();
}
