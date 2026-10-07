import fs from 'node:fs';
import path from 'node:path';
import {exportContentZip,recoverContentImport} from './content-portability.mjs';
const dir=path.resolve(process.env.DATA_DIR||'/app/data'),target=path.join(dir,'content-export.zip'),temp=target+'.next';
try{recoverContentImport(dir);fs.rmSync(temp,{force:true});await exportContentZip(dir,temp);fs.renameSync(temp,target);fs.chmodSync(target,0o600);console.log('可移植内容包已生成。');}catch{fs.rmSync(temp,{force:true});console.error('内容包导出失败，请检查内容、空间和文件权限。');process.exitCode=1;}
