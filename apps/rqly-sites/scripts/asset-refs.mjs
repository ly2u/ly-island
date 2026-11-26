import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
export const publicDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/rqly');
export function assetReference(name,template='article.html'){
 const refs=[...fs.readFileSync(path.join(publicDir,template),'utf8').matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]).filter(ref=>new URL(ref,'https://example.invalid').pathname==='/'+name);
 assert.equal(refs.length,1,template+' must reference '+name+' once');
 assert(new URL(refs[0],'https://example.invalid').searchParams.get('v'),name+' must have a cache version');
 assert(fs.statSync(path.join(publicDir,name)).isFile(),name+' must exist');return refs[0];
}
