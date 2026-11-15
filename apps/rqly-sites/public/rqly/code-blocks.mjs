import {codeLanguage} from './code-policy.mjs?v=code-tools-v1';
const instances=new WeakMap();
export function setupCodeBlocks(root){
 instances.get(root)?.dispose();
 const controller=new AbortController(),timers=new Set(),buttons=[],statuses=[];let disposed=false;
 for(const code of root.querySelectorAll('pre > code')){
  const pre=code.parentElement;let block=pre.parentElement;
  if(!block.classList.contains('code-block')){block=document.createElement('div');block.className='code-block';pre.before(block);block.append(pre);}
  let heading=block.querySelector(':scope > .code-block-heading');
  if(!heading){heading=document.createElement('div');heading.className='code-block-heading';const label=document.createElement('span');label.className='code-language';label.textContent=codeLanguage(block.dataset.codeLanguage).label;heading.append(label);block.prepend(heading);}
  pre.tabIndex=0;
  const button=document.createElement('button');button.type='button';button.className='code-copy';button.textContent='复制代码';button.setAttribute('aria-label','复制代码');
  let resetTimer;const status=document.createElement('span');status.className='code-copy-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');heading.append(button);block.append(status);buttons.push(button);statuses.push(status);
  button.addEventListener('click',async()=>{
   if(button.disabled||disposed)return;button.disabled=true;if(resetTimer){clearTimeout(resetTimer);timers.delete(resetTimer);}status.textContent='';status.classList.remove('is-visible');
   try{
    if(!navigator.clipboard?.writeText)throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(code.textContent);if(disposed)return;
    button.textContent='已复制';status.textContent='代码已复制';
   }catch{
    if(disposed)return;
    // A denied clipboard never produces a false success message or changes the editor.
    const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(code);selection?.removeAllRanges();selection?.addRange(range);pre.focus({preventScroll:true});
    button.textContent='重新复制';status.classList.add('is-visible');status.textContent='代码已选中，请使用系统复制或 Ctrl/⌘ C。';
   }finally{
    if(!disposed){button.disabled=false;resetTimer=setTimeout(()=>{button.textContent='复制代码';status.textContent='';status.classList.remove('is-visible');timers.delete(resetTimer);},2500);timers.add(resetTimer);}
   }
  },{signal:controller.signal});
 }
 const tools={dispose(){if(disposed)return;disposed=true;controller.abort();for(const timer of timers)clearTimeout(timer);for(const element of [...buttons,...statuses])element.remove();if(instances.get(root)===tools)instances.delete(root);}};
 instances.set(root,tools);return tools;
}
