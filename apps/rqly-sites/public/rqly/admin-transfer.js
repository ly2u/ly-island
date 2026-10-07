(()=>{
 const el=id=>document.getElementById(id);let plan=null,working=false;
 function message(value,error=false){el('transfer-status').textContent=value;el('transfer-status').classList.toggle('error',error);}
 function controls(value){working=value;for(const id of ['transfer-preview','transfer-confirm','transfer-cancel','transfer-file','transfer-duplicates'])el(id).disabled=value;el('transfer-confirm').disabled=value||!plan||!(plan.posts+plan.editorDrafts+plan.media+plan.catalog);}
 function clear(){plan=null;el('transfer-result').hidden=true;el('transfer-rows').replaceChildren();controls(false);}
 async function cancel(){if(!plan)return;const token=plan.token;clear();try{await request('/api/admin/import/cancel',{method:'POST',body:JSON.stringify({token})});}catch{}}
 for(const id of ['transfer-file','transfer-duplicates'])el(id).addEventListener('change',()=>{cancel();message('选择内容包后，先预览再导入。');});
 el('transfer-preview').addEventListener('click',async()=>{
  if(working)return;const file=el('transfer-file').files[0];if(!file){message('请先选择本站导出的 ZIP 内容包。',true);return;}if(!file.name.toLowerCase().endsWith('.zip')){message('请选择 ZIP 内容包。',true);return;}
  controls(true);message('正在上传并检查内容包，尚未写入内容库…');
  try{
   plan=await request('/api/admin/import/preview?duplicates='+el('transfer-duplicates').value,{method:'POST',headers:{'Content-Type':'application/zip'},body:file});
   el('transfer-summary').textContent='新增 '+plan.posts+' 条草稿、'+plan.editorDrafts+' 份编辑草稿、'+plan.media+' 张图片和 '+plan.catalog+' 项目录；跳过 '+plan.skipped+' 条重复内容。';
   el('transfer-details').textContent=(plan.history?'包内 '+plan.history+' 个历史版本保留在 ZIP 中，本次不载入历史。':'')+(plan.clearedProjects?'有 '+plan.clearedProjects+' 个关联项目未找到，已取消关联。':'')+'岛屿布局保留在 ZIP 中，导入不会修改当前岛屿。预览 30 分钟有效。';
   el('transfer-rows').replaceChildren();for(const row of plan.rows.slice(0,100)){const item=document.createElement('li');const title=document.createElement('strong');title.textContent=row.title;const detail=document.createElement('span');detail.textContent=({skip:'跳过重复',copy:'另存副本',add:'新增草稿',editorDraft:'恢复编辑草稿'})[row.action]+(row.to?' · '+row.to:'');item.append(title,detail);el('transfer-rows').append(item);}if(plan.rows.length>100){const note=document.createElement('li');note.textContent='其余 '+(plan.rows.length-100)+' 条按相同规则处理。';el('transfer-rows').append(note);}
   el('transfer-result').hidden=false;message('检查通过。确认后导入为草稿，已有内容保持原样。');
  }catch(error){clear();message(error.message,true);}finally{controls(false);}
 });
 el('transfer-cancel').addEventListener('click',()=>{cancel();message('已取消导入。');});
 el('transfer-confirm').addEventListener('click',async()=>{
  if(working||!plan)return;if(!confirm('将新增内容保存为草稿，并导入预览中列出的图片和目录。确认继续？'))return;
  controls(true);message('正在保存草稿…');
  try{const result=await request('/api/admin/import/confirm',{method:'POST',body:JSON.stringify({token:plan.token,confirm:true})});clear();el('transfer-file').value='';await load();message('导入完成：'+result.posts+' 条草稿、'+result.editorDrafts+' 份编辑草稿。可到草稿箱核对后发布。');}
  catch(error){clear();message(error.message+' 请重新预览后再试。',true);}finally{controls(false);}
 });
 el('export-bundle').addEventListener('click',()=>message('正在准备下载，文件较多时请稍候。内容包包含私密草稿和图片，请妥善保存。'));
 clear();
})();
