import fs from 'node:fs';import path from 'node:path';
const date=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&value.trim()===value&&value.length<=40&&Number.isFinite(Date.parse(value))?value:null;
const matches=(pattern,value)=>typeof value==='string'&&value===value.trim()&&pattern.test(value);
export function readSiteStatus(dataDir){
 const result={available:false};
 try{
  const file=path.join(dataDir,'site-status.json'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)return result;
  const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.schemaVersion!==1||!date(data.generatedAt))return result;
  result.available=true;result.generatedAt=date(data.generatedAt);result.release={};result.backup={};
  if(matches(/^v[0-9][0-9A-Za-z._-]{0,40}-[0-9a-f]{12}$/,data.release?.id))result.release.id=data.release.id;
  if(matches(/^[0-9a-f]{40}$/,data.release?.commit))result.release.commit=data.release.commit;
  if(date(data.release?.deployedAt))result.release.deployedAt=data.release.deployedAt;
  for(const key of ['lastSucceededAt','lastRestoreVerifiedAt','lastFailureAt'])if(date(data.backup?.[key]))result.backup[key]=data.backup[key];
  if(matches(/^ly-stack-\d{8}T\d{6}Z\.tar\.gz$/,data.backup?.archive))result.backup.archive=data.backup.archive;
  result.backup.warning=!result.backup.lastSucceededAt||Date.now()-Date.parse(result.backup.lastSucceededAt)>48*3600000||Date.parse(result.backup.lastFailureAt)>Date.parse(result.backup.lastSucceededAt);
 }catch{}
 return result;
}
export function diskStatus(dataDir){try{const s=fs.statfsSync(dataDir);return {freeBytes:s.bavail*s.bsize,totalBytes:s.blocks*s.bsize};}catch{return null;}}
