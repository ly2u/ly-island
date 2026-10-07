(()=>{
const box=document.getElementById('ai-quota');if(!box)return;let loading=false;
const node=(tag,value)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=value;return el;};
async function refresh(){if(loading||document.hidden)return;loading=true;const button=box.querySelector('button');if(button)button.disabled=true;
 try{const response=await fetch('/api/ai/usage');const data=await response.json();if(!response.ok)throw new Error(response.status===401?'管理员登录后可查看额度。':data.error||'额度暂时无法读取。');
  box.replaceChildren();const head=node('div');head.className='ai-quota-heading';head.append(node('strong','订阅剩余额度'));const reload=node('button','刷新');reload.type='button';reload.className='text-button';reload.addEventListener('click',refresh);head.append(reload);box.append(head);
  const rows=node('div');rows.className='ai-quota-windows';
  for(const window of data.windows||[]){const row=node('div');row.className='ai-quota-window';const minutes=window.windowMinutes;const label=minutes===300?'5 小时额度':minutes===10080?'周额度':minutes?`${minutes/60} 小时额度`:'额度窗口';const title=node('div');title.append(node('span',label),node('b',`${Math.round(window.remainingPercent)}% 剩余`));const bar=node('progress');bar.max=100;bar.value=window.remainingPercent;bar.setAttribute('aria-label',label+'剩余比例');row.append(title,bar);
   row.append(node('small',typeof window.resetsAt==='number'?'重置：'+new Date(window.resetsAt*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'重置时间尚未返回'));rows.append(row);
  }
  if(!rows.children.length)rows.append(node('p','服务暂未返回额度窗口，不能据此判断已用完。'));box.append(rows,node('small','账号共享额度，包含其他 Codex / Work 使用；不等于本站调用次数。每分钟更新。'));
 }catch(error){box.replaceChildren(node('p',error.message));const retry=node('button','重新读取额度');retry.type='button';retry.className='text-button';retry.addEventListener('click',refresh);box.append(retry);}
 finally{loading=false;}
}
refresh();setInterval(()=>{if(box.offsetParent)refresh();},60000);window.addEventListener('ly-ai-completed',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&box.offsetParent)refresh();});
})();
