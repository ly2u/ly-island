import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
const fail=(message,status)=>Object.assign(new Error(message),{status});
export function createAdminAccount({dataDir,username,bootstrapHash}){
 const filename=path.join(dataDir,'admin-account.json');
 const bootstrapFingerprint=()=>createHash('sha256').update(username()+'\0'+bootstrapHash()).digest('hex');
 const read=()=>{
  if(!fs.existsSync(filename))return null;
  let value;try{value=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{throw fail('管理员账号存档无法读取。',503);}
  if(value.schemaVersion!==1||typeof value.username!=='string'||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(value.passwordHash)||!/^[a-f0-9]{64}$/.test(value.bootstrapFingerprint))throw fail('管理员账号存档格式无效。',503);
  return value;
 };
 const hash=()=>{const value=read();return value&&value.username===username()&&value.bootstrapFingerprint===bootstrapFingerprint()?value.passwordHash:bootstrapHash();};
 return {
  hash,
  replace(nextHash,expectedHash){
   if(hash()!==expectedHash)throw fail('密码已在其他页面修改，请重新登录。',409);
   if(!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(nextHash))throw fail('新密码配置无效。',500);
   const value={schemaVersion:1,username:username(),passwordHash:nextHash,bootstrapFingerprint:bootstrapFingerprint(),updatedAt:new Date().toISOString()};
   const temp=filename+'.'+randomBytes(5).toString('hex')+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,filename);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  },
 };
}
