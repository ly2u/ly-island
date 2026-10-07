import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt),lifetime=7*24*60*60*1000;
const digest=value=>createHash('sha256').update(value).digest('hex');
const failure=(message,status)=>Object.assign(new Error(message),{status});
export function createAdminAuth({dataDir,username,passwordHash,replacePasswordHash,address,secure=true}){
 const file=path.join(dataDir,'admin-sessions.json'),failures=new Map();
 const fingerprint=()=>digest(username()+'\0'+passwordHash());
 const read=()=>{if(!fs.existsSync(file))return [];const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.schemaVersion!==1||!Array.isArray(data.sessions))throw failure('登录状态暂时无法读取，请联系管理员。',503);return data.sessions;};
 const write=sessions=>{const tmp=file+'.'+randomBytes(5).toString('hex')+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify({schemaVersion:1,sessions}),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}};
 const active=()=>read().filter(s=>typeof s.tokenHash==='string'&&s.expiresAt>Date.now()&&s.fingerprint===fingerprint());
 const token=req=>{for(const cookie of String(req.headers.cookie||'').split(';')){const [name,...rest]=cookie.trim().split('=');if(name==='ly_admin_session'){const value=rest.join('=');return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;}}return null;};
 const session=req=>{const value=token(req);return value?active().find(s=>s.tokenHash===digest(value))||null:null;};
 const cookie=(res,value,maxAge)=>res.setHeader('Set-Cookie','ly_admin_session='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(secure?'; Secure':''));
 return {
  initialize(){if(!fs.existsSync(file))write([]);else write(active());},
  session,
  async login(req,res,credentials){
   if(!passwordHash())throw failure('管理员账号尚未配置。',503);
   const key=address(req),now=Date.now();for(const [ip,entry] of failures)if(entry.until<=now)failures.delete(ip);if(failures.size>=10000&&!failures.has(key))throw failure('登录请求较多，请稍后重试。',429);const old=failures.get(key);if(old&&old.until>now&&old.count>=10)throw failure('登录尝试过多，请十五分钟后再试。',429);
   const validInput=typeof credentials?.username==='string'&&credentials.username.length<=100&&typeof credentials.password==='string'&&credentials.password.length<=200;
   const loginHash=passwordHash(),pieces=loginHash.split(':');let valid=false;
   if(validInput&&pieces.length===3&&pieces[0]==='scrypt'){
    const expected=Buffer.from(pieces[2],'hex');const result=await derive(credentials.password,pieces[1],64);
    valid=expected.length===64&&timingSafeEqual(expected,result)&&credentials.username===username()&&loginHash===passwordHash();
   }
   if(!valid){const previous=failures.get(key);failures.set(key,{count:previous&&previous.until>now?previous.count+1:1,until:previous&&previous.until>now?previous.until:now+15*60*1000});throw failure('账号或密码不正确。',401);}
   failures.delete(key);const previous=token(req),value=randomBytes(32).toString('base64url'),csrfToken=randomBytes(32).toString('base64url');
   const next={tokenHash:digest(value),csrfToken,expiresAt:Date.now()+lifetime,fingerprint:fingerprint()};
   const sessions=active().filter(s=>!previous||s.tokenHash!==digest(previous));write([...sessions.slice(-49),next]);cookie(res,value,lifetime/1000);return next;
  },
  require(req){const value=session(req);if(!value)throw failure('登录已失效，请重新登录。',401);return value;},
  async changePassword(req,res,data){
   if(typeof replacePasswordHash!=='function')throw failure('当前部署尚不支持修改密码。',503);
   const current=this.require(req);this.csrf(req,current);
   if(typeof data?.currentPassword!=='string'||!data.currentPassword.length||data.currentPassword.length>200)throw failure('请输入当前密码。',400);
   if(typeof data.newPassword!=='string'||data.newPassword.length<12||data.newPassword.length>200||!data.newPassword.trim())throw failure('新密码需要 12 至 200 个字符。',400);
   if(data.newPassword!==data.confirmPassword)throw failure('两次输入的新密码不一致。',400);
   if(data.newPassword===data.currentPassword)throw failure('请使用与当前密码不同的新密码。',400);
   const key='password-change:'+current.tokenHash,now=Date.now(),old=failures.get(key);
   if(old&&old.until>now&&old.count>=10)throw failure('当前密码尝试过多，请十五分钟后再试。',429);
   const expectedHash=passwordHash(),pieces=expectedHash.split(':'),expected=Buffer.from(pieces[2]||'','hex');
   const actual=pieces.length===3&&pieces[0]==='scrypt'?await derive(data.currentPassword,pieces[1],64):Buffer.alloc(0);
   if(expected.length!==64||actual.length!==64||!timingSafeEqual(expected,actual)){
    const previous=failures.get(key);failures.set(key,{count:previous&&previous.until>now?previous.count+1:1,until:previous&&previous.until>now?previous.until:now+15*60*1000});throw failure('当前密码不正确。',400);
   }
   const salt=randomBytes(16).toString('hex'),nextHash='scrypt:'+salt+':'+(await derive(data.newPassword,salt,64)).toString('hex');
   // Compare the current hash immediately before the atomic write, so two tabs cannot overwrite each other.
   replacePasswordHash(nextHash,expectedHash);failures.delete(key);write([]);cookie(res,'',0);
   return {changed:true,reauthenticate:true};
  },
  csrf(req,current){const actual=String(req.headers['x-csrf-token']||''),expected=current.csrfToken;if(!/^[A-Za-z0-9_-]{43}$/.test(actual)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))throw failure('登录验证未通过，请刷新页面后重试。',403);},
  logout(req,res){const value=token(req);if(value)write(active().filter(s=>s.tokenHash!==digest(value)));cookie(res,'',0);},
 };
}
