import fs from 'node:fs';import path from 'node:path';import {randomBytes,createHash} from 'node:crypto';import sharp from 'sharp';
sharp.concurrency(1);sharp.cache({memory:16,files:0,items:32});
export const MAX_IMAGE_BYTES=8*1024*1024;
export const MEDIA_NAME=/^[a-f0-9]{32}\.webp$/;
const MAX_STORED_BYTES=2*1024*1024*1024;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const supported=bytes=>bytes.subarray(0,3).equals(Buffer.from([255,216,255]))||bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP');
// The original withdrawn photograph is never restored to public assets.
export function createMediaStore(dataDir,{withdrawnHashes=[]}={}){
 const directory=path.join(dataDir,'media'),withdrawn=new Set(withdrawnHashes);let active=0;
 const names=()=>fs.existsSync(directory)?fs.readdirSync(directory).filter(name=>MEDIA_NAME.test(name)):[];
 const metadata=name=>{if(!MEDIA_NAME.test(name))return null;const file=path.join(directory,name),sidecar=file+'.json';if(!fs.existsSync(file)||!fs.existsSync(sidecar))return null;const value=JSON.parse(fs.readFileSync(sidecar,'utf8'));if(value.filename!==name||!Number.isInteger(value.width)||!Number.isInteger(value.height)||value.width<1||value.height<1||typeof value.createdAt!=='string')fail('图片存档暂时无法读取。',503);return value;};
 return {
  metadata,
  assertIdle(){if(active)fail('正在处理图片，请等待上传完成后再确认导入。',409);},
  summary(){const all=names();return {count:all.length,bytes:all.reduce((sum,name)=>sum+fs.statSync(path.join(directory,name)).size,0),maxBytes:MAX_STORED_BYTES,maxCount:2000};},
  remove(name){if(active)fail('正在处理图片，请稍后再整理。',409);if(!metadata(name))fail('图片不存在。',404);fs.unlinkSync(path.join(directory,name));fs.unlinkSync(path.join(directory,name+'.json'));},
  file(name){return MEDIA_NAME.test(name)?path.join(directory,name):null;},
  list(){return names().map(metadata).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
  async upload(req){
   if(active>=1)fail('正在处理一张图片，请稍后再上传。',429);
   const type=String(req.headers['content-type']||'').split(';')[0];if(!['image/jpeg','image/png','image/webp'].includes(type))fail('请上传 JPG、PNG 或 WebP 图片。',415);
   if(Number(req.headers['content-length'])>MAX_IMAGE_BYTES)fail('单张图片请控制在 8 MB 以内。',413);
   active++;try{
    const pieces=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_IMAGE_BYTES)fail('单张图片请控制在 8 MB 以内。',413);pieces.push(chunk);}const input=Buffer.concat(pieces);
    if(!supported(input))fail('文件内容不是支持的图片。');
    if(withdrawn.has(createHash('sha256').update(input).digest('hex')))fail('这张图片已设置为不公开，请选择其他素材。');
    const current=names();if(current.length>=2000)fail('图片数量已达到当前存储限额，请先整理素材。',409);
    const total=current.reduce((sum,name)=>sum+fs.statSync(path.join(directory,name)).size,0);if(total>=MAX_STORED_BYTES)fail('图片存储已达到 2 GB，请先整理素材。',409);
    let result;try{
     const image=sharp(input,{limitInputPixels:20000000,failOn:'warning'}),info=await image.metadata();if(!['jpeg','png','webp'].includes(info.format)||(info.pages||1)>1)fail('目前支持静态 JPG、PNG 和 WebP 图片。');
     result=await image.autoOrient().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer({resolveWithObject:true});
    }catch(error){if(error.status)throw error;fail('图片无法读取，或超过 2000 万像素，请缩小后再上传。');}
    if(total+result.data.length>MAX_STORED_BYTES)fail('图片存储空间不足，请先整理素材。',409);
    fs.mkdirSync(directory,{recursive:true,mode:0o700});const filename=randomBytes(16).toString('hex')+'.webp',target=path.join(directory,filename),temp=target+'.tmp';
    const info={filename,url:'/media/'+filename,width:result.info.width,height:result.info.height,bytes:result.data.length,createdAt:new Date().toISOString()};
    try{fs.writeFileSync(temp,result.data,{mode:0o600,flag:'wx'});fs.writeFileSync(target+'.json',JSON.stringify(info)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,target);}catch(error){if(fs.existsSync(target+'.json'))fs.unlinkSync(target+'.json');throw error;}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    return info;
   }finally{active--;}
  },
 };
}
export function referencesMedia(body,name){return typeof body==='string'&&body.includes('/media/'+name);}
