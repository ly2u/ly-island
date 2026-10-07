const $=id=>document.getElementById(id);
const candidate=new URLSearchParams(location.search).get('next')||'/admin';
if(new URLSearchParams(location.search).get('changed')==='1')$('login-status').textContent='密码已修改，请使用新密码登录。';
const tool=location.hostname==='7zui.com';
const next=tool?'/':candidate==='/admin'||candidate.startsWith('/admin?')?candidate:'/admin';
$('password-toggle').addEventListener('click',()=>{const show=$('login-password').type==='password';$('login-password').type=show?'text':'password';$('password-toggle').textContent=show?'隐藏':'显示';$('password-toggle').setAttribute('aria-label',show?'隐藏密码':'显示密码');});
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();$('login-submit').disabled=true;$('login-status').textContent='正在登录…';$('login-status').classList.remove('error');
 try{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'rqly-editor'},body:JSON.stringify({username:$('login-username').value.trim(),password:$('login-password').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'登录未完成，请重试。');$('login-password').value='';location.replace(next);}
 catch(error){$('login-status').textContent=error.message;$('login-status').classList.add('error');}finally{$('login-submit').disabled=false;}
});
fetch('/api/auth/session').then(r=>r.json()).then(data=>{if(data.authenticated)location.replace(next);}).catch(()=>{});
