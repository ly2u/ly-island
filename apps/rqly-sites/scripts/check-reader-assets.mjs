import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {assetReference,publicDir} from './asset-refs.mjs';
const version=ref=>new URL(ref,'https://example.invalid').searchParams.get('v');
for(const name of['reader.css','site.css']){
 const refs=fs.readdirSync(publicDir).filter(f=>f.endsWith('.html')&&fs.readFileSync(path.join(publicDir,f),'utf8').includes('/'+name+'?')).map(file=>assetReference(name,file));
 assert(refs.length>1);assert.equal(new Set(refs.map(version)).size,1,'all templates must use one cache version for '+name);
}
const expected=version(assetReference('reader.css'));
for(const file of['reader-page.mjs','admin.js']){
 const source=fs.readFileSync(path.join(publicDir,file),'utf8'),refs=[...source.matchAll(/["'](?:\.\/|\/)reader-client\.mjs\?([^"']+)["']/g)];
 assert.equal(refs.length,1,file+' must import one reader client');assert.equal(new URLSearchParams(refs[0][1]).get('v'),expected,file+' reader/CSS cache versions must agree');
}
assetReference('reader-page.mjs');assetReference('admin.js','admin.html');
console.log('Reader asset contract passed: existing versioned resources, shared template consistency, and matching article/admin reader imports; cache versions need no hard-coded test updates.');
