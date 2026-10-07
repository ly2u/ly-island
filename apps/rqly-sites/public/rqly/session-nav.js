const header=document.querySelector('.header');
if(header){const link=document.createElement('a');link.href='/login';link.textContent='管理员登录';link.className='session-account-link';(header.querySelector('.sidebar-tools')||header).append(link);fetch('/api/auth/session').then(r=>r.json()).then(data=>{if(data.authenticated){link.href='/admin';link.textContent='管理平台';}}).catch(()=>{});}
