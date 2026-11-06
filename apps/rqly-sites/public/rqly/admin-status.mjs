const when=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚未记录';
const gb=value=>Number.isFinite(value)?(value/1073741824).toFixed(1)+' GB':'暂未读取';
export function maintenancePanel({request}){
 const root=document.getElementById('maintenance-cards'),status=document.getElementById('maintenance-status'),button=document.getElementById('refresh-maintenance');let busy=false;
 const card=(title,primary,detail,warning=false)=>{const node=document.createElement('article');node.className='maintenance-card'+(warning?' maintenance-warning':'');for(const [tag,text] of [['h3',title],['strong',primary],['p',detail]]){const child=document.createElement(tag);child.textContent=text;node.append(child);}return node;};
 async function refresh(){
  if(busy)return;busy=true;button.disabled=true;status.textContent='正在读取维护状态…';
  try{const data=await request('/api/admin/site-status'),ops=data.operator;root.replaceChildren();root.append(card('当前发布',ops.release?.id||'尚未收到版本摘要',ops.release?.commit?'提交 '+ops.release.commit.slice(0,12)+' · '+when(ops.release.deployedAt):'发布后由服务器刷新。'));
   const backup=ops.backup||{};root.append(card('本地备份与恢复校验',backup.lastRestoreVerifiedAt?when(backup.lastRestoreVerifiedAt):'尚未收到校验结果',backup.lastFailureAt&&Date.parse(backup.lastFailureAt)>Date.parse(backup.lastSucceededAt||0)?'最近一次备份未成功，请查看服务器记录。':backup.lastSucceededAt?'最近成功 '+when(backup.lastSucceededAt):'状态摘要尚未就绪，不代表已经备份成功。',!ops.available||backup.warning));
   root.append(card('图片与磁盘',data.images.count+' 张 · '+gb(data.images.bytes),'可用磁盘 '+gb(data.disk?.freeBytes),data.disk&&data.disk.freeBytes/data.disk.totalBytes<.1));status.textContent=ops.available?'摘要更新于 '+when(ops.generatedAt)+'；图片与磁盘为本次读取。':'维护摘要暂不可用，文章编辑和导出仍可正常使用。';
  }catch{status.textContent='维护状态暂未读取，请稍后重试。';}finally{busy=false;button.disabled=false;}
 }
 button.addEventListener('click',refresh);return {refresh};
}
