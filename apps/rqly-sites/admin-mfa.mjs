import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {generateSecret,generateURI,verifySync} from 'otplib';
import QRCode from 'qrcode';
const error=(message,status=400,code)=>Object.assign(new Error(message),{status,...(code?{code}:{})});
const hash=value=>createHash('sha256').update('ly-mfa-recovery\0'+value).digest('hex');
const hex=(value,length)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value);
export function createAdminMFA({dataDir,username,now=Date.now}){
 const file=path.join(dataDir,'admin-mfa.json'),keyFile=path.join(dataDir,'admin-mfa-key.json');
 const empty=()=>({schemaVersion:1,enabled:false,authVersion:'',secret:null,recoveryHashes:[],lastUsedCounter:-1,pending:null,failures:{count:0,until:0}});
 const privateRead=target=>{if(fs.statSync(target).mode&0o077)throw Error();return JSON.parse(fs.readFileSync(target,'utf8'));};
 const key=()=>{const value=privateRead(keyFile);if(value.schemaVersion!==1||!hex(value.key,64))throw Error();return Buffer.from(value.key,'hex');};
 const decrypt=value=>{if(!value||!hex(value.iv,24)||!hex(value.tag,32)||!hex(value.ciphertext,64))throw Error();const cipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(value.iv,'hex'));cipher.setAuthTag(Buffer.from(value.tag,'hex'));const secret=Buffer.concat([cipher.update(Buffer.from(value.ciphertext,'hex')),cipher.final()]).toString('utf8');if(!/^[A-Z2-7]{32}$/.test(secret))throw Error();return secret;};
 const encrypt=secret=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return {iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')};};
 const read=()=>{try{if(!fs.existsSync(file))return empty();const state=privateRead(file);if(state.schemaVersion!==1||typeof state.enabled!=='boolean'||!(state.authVersion===''||hex(state.authVersion,32))||!Array.isArray(state.recoveryHashes)||state.recoveryHashes.length>10||!state.recoveryHashes.every(v=>hex(v,64))||new Set(state.recoveryHashes).size!==state.recoveryHashes.length||!Number.isInteger(state.lastUsedCounter)||state.lastUsedCounter< -1||!state.failures||!Number.isInteger(state.failures.count)||state.failures.count<0||!Number.isFinite(state.failures.until))throw Error();if(state.enabled){if(!state.authVersion)throw Error();decrypt(state.secret);}else if(state.secret!==null||state.recoveryHashes.length)throw Error();if(state.pending!==null){const p=state.pending;if(!p||!hex(p.id,32)||!hex(p.owner,64)||!Number.isFinite(p.expiresAt)||!Array.isArray(p.recoveryHashes)||p.recoveryHashes.length!==10||!p.recoveryHashes.every(v=>hex(v,64)))throw Error();decrypt(p.secret);}return state;}catch{throw error('两步验证配置无法读取，请通过服务器恢复备份。',503);}};
 const writeValue=(target,value)=>{const temporary=target+'.'+randomBytes(5).toString('hex')+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temporary,target);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}};
 const write=state=>writeValue(file,state);
 const recovery=()=>{const codes=Array.from({length:10},()=>randomBytes(16).toString('hex').match(/.{8}/g).join('-'));return {codes,hashes:codes.map(v=>hash(v.replaceAll('-','')))};};
 const budget=state=>{if(state.failures.until<=now())state.failures={count:0,until:now()+900000};if(state.failures.count>=10)throw error('验证码尝试过多，请十五分钟后再试。',429);};
 const consume=(state,code,{secret=state.secret,activation=false}={})=>{
  if(typeof code!=='string'||!code.trim())throw error('请输入验证器验证码或恢复码。',401,'MFA_REQUIRED');budget(state);
  const token=code.trim().replaceAll(' ','');let valid=false;
  if(/^\d{6}$/.test(token)){const result=verifySync({secret:decrypt(secret),token,epoch:Math.floor(now()/1000),epochTolerance:30,...(!activation?{afterTimeStep:state.lastUsedCounter}:{})});if(result.valid){state.lastUsedCounter=result.timeStep;valid=true;}}
  else if(!activation&&/^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{8}){3})$/.test(token)){const ident=hash(token.replaceAll('-','').toLowerCase()),index=state.recoveryHashes.indexOf(ident);if(index!==-1){state.recoveryHashes.splice(index,1);valid=true;}}
  if(!valid){state.failures.count++;write(state);throw error('验证码或恢复码不正确，或已使用。请等待下一组验证码再试。',401);}
  state.failures={count:0,until:0};
 };
 return {
  initialize(){read();},
  version(){return read().authVersion;},
  status(){const state=read();return {enabled:state.enabled,recoveryCodesRemaining:state.recoveryHashes.length};},
  verify(code){const state=read();if(!state.enabled)return;consume(state,code);write(state);},
  async begin(owner){let state=read();if(!fs.existsSync(keyFile))writeValue(keyFile,{schemaVersion:1,key:randomBytes(32).toString('hex')});else key();const secret=generateSecret(),codes=recovery();const pending={id:randomBytes(16).toString('hex'),owner,expiresAt:now()+600000,secret:encrypt(secret),recoveryHashes:codes.hashes};state.pending=pending;write(state);const uri=generateURI({issuer:'LY Island',label:username(),secret});const qrCode=await QRCode.toDataURL(uri,{errorCorrectionLevel:'M',width:240,margin:2});return {pendingId:pending.id,expiresAt:pending.expiresAt,secret,qrCode,recoveryCodes:codes.codes};},
  confirm(owner,input){const state=read(),pending=state.pending;if(!pending||pending.owner!==owner||pending.id!==input?.pendingId||pending.expiresAt<=now())throw error('绑定已过期或不属于当前登录，请重新开始。',409);if(input.recoverySaved!==true)throw error('请先保存恢复码，再确认启用。');consume(state,input.code,{secret:pending.secret,activation:true});state.enabled=true;state.secret=pending.secret;state.recoveryHashes=pending.recoveryHashes;state.pending=null;state.authVersion=randomBytes(16).toString('hex');write(state);return this.status();},
  cancel(owner){const state=read();if(state.pending?.owner===owner){state.pending=null;write(state);}return this.status();},
  disable(){const state=read();state.enabled=false;state.secret=null;state.recoveryHashes=[];state.pending=null;state.lastUsedCounter=-1;state.authVersion=randomBytes(16).toString('hex');write(state);return this.status();},
  regenerate(){const state=read();if(!state.enabled)throw error('请先开启两步验证。');const codes=recovery();state.recoveryHashes=codes.hashes;state.pending=null;state.authVersion=randomBytes(16).toString('hex');write(state);return {...this.status(),recoveryCodes:codes.codes};},
 };
}
