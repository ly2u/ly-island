import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,scryptSync} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.join(root,'.env');
if(fs.existsSync(target)){console.error('.env 已经存在，未覆盖。修改现有配置即可。');process.exit(1);}
const password=randomBytes(18).toString('base64url'),salt=randomBytes(16).toString('hex'),hash='scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex'),token=randomBytes(18).toString('base64url');
let text=fs.readFileSync(path.join(root,'.env.example'),'utf8').replace(/^ADMIN_PASSWORD_HASH=.*$/m,'ADMIN_PASSWORD_HASH='+hash).replace(/^REVIEW_ACCESS_TOKEN=.*$/m,'REVIEW_ACCESS_TOKEN='+token);
fs.writeFileSync(target,text,{mode:0o600,flag:'wx'});
console.log('配置已生成。请保管以下信息：\n\n写作地址：https://rqly.com/admin\n写作账号：ly\n写作密码：'+password+'\n七嘴 AI 访问码：'+token+'\n\n上线前填写 .env 中的 ACME_EMAIL。启用 AI 时，再填写 AI_API_KEY 和 AI_MODEL。');
