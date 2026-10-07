import {validateOrganization} from './public/rqly/organization-core.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';

export const DECORATION_SLOTS={west:{label:'西岸',point:[-3.5,0]},northwest:{label:'西北角',point:[-2.8,-2.7]},northeast:{label:'东北角',point:[2.3,-2.7]},east:{label:'东岸',point:[3.8,1.4]},southwest:{label:'西南角',point:[-2.7,2.8]},south:{label:'湖边',point:[1.6,2.9]}};
export function growthStats(posts,island){const published=posts.filter(p=>p.published===true&&!p.trashedAt),notes=published.filter(p=>p.kind==='note').length,blogs=published.filter(p=>!p.kind||p.kind==='blog').length,projects=published.filter(p=>p.kind==='project').length,completed=published.filter(p=>p.kind==='project'&&p.project?.status==='done').length;const score=notes+blogs*3+projects*5+completed*10,threshold=island.growth?.threshold??30;return {notes,blogs,projects,completed,score,threshold,remaining:Math.max(0,threshold-score),eligible:score>=threshold,unlocked:island.growth?.unlocked||island.phase==='grown',stage:island.phase==='grown'?2:1};}
export const BUILDINGS=['library','projects','workshop'];
export const DEFAULT_LAYOUTS={initial:{library:[-2.05,1.25],projects:[2.55,1.2],workshop:[-.1,-2.15]},grown:{library:[-2.5,1.55],projects:[9,.35],workshop:[.2,-2.3]}};
export const SCENERY_RULES={initial:{radius:5.8,ellipse:.83},grown:{radius:6.8,ellipse:.83,satellite:{center:[9,.5],radius:[2.2,2.1]}}};
export const SCENERY_TREE_IDS={initial:Array.from({length:10},(_,i)=>'tree-'+i),grown:Array.from({length:14},(_,i)=>'tree-'+i)};
export function sceneryInside(phase,point){const [x,z]=point,r=SCENERY_RULES[phase];return (x/r.radius)**2+(z/(r.radius*r.ellipse))**2<=1||(r.satellite&&((x-r.satellite.center[0])/r.satellite.radius[0])**2+((z-r.satellite.center[1])/r.satellite.radius[1])**2<=1);}
export const LAYOUT_RULES={scenery:SCENERY_RULES,initial:{radius:4.65,ellipse:.79},grown:{radius:5.55,ellipse:.79,projects:{center:[9,.5],radius:[1,1.1]}},minDistance:2.15,defaults:DEFAULT_LAYOUTS};
export function defaultIsland(){return {schemaVersion:1,revision:0,title:'LY 的浮空岛',description:'把日常的积累，建成自己的世界。',phase:'initial',lighting:'afternoon',buildings:{library:{name:'书屋',description:'挑一本记录，翻开看看。读完之后，小岛还在窗外。'},projects:{name:'工程展馆',description:'项目过程、工程手记与完成的成果，都留在这里。'},workshop:{name:'工坊',description:'桌上放着正在使用的工具，也留着每次尝试的手记。'}},layouts:structuredClone(DEFAULT_LAYOUTS),growth:{threshold:30,unlocked:false},scenery:{initial:{postoffice:null,trees:{}},grown:{postoffice:null,trees:{}}},decorations:[],updatedAt:null};}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function text(value,max,label,{optional=false}={}){if(typeof value!=='string'||value.length>max||(!optional&&!value.trim()))fail(label+'格式无效。');return value.trim();}
export function validateIsland(value){
 if(!value||typeof value!=='object')fail('岛屿配置格式无效。');
 const title=text(value.title,60,'岛名'),description=text(value.description,180,'岛屿介绍');
 if(!['initial','grown'].includes(value.phase)||!['afternoon','dusk'].includes(value.lighting))fail('岛屿阶段或光照无效。');
 const buildings={},layouts={};
 for(const id of BUILDINGS){const b=value.buildings?.[id];if(!b)fail('缺少建筑配置。');buildings[id]={name:text(b.name,16,'建筑名称'),description:text(b.description,180,'建筑介绍')};}
 for(const phase of ['initial','grown']){
  layouts[phase]={};
  for(const id of BUILDINGS){
   const point=value.layouts?.[phase]?.[id];if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))fail('建筑坐标无效。');const [x,z]=point;
   const rules=LAYOUT_RULES[phase],area=rules[id];
   const inside=area?((x-area.center[0])/area.radius[0])**2+((z-area.center[1])/area.radius[1])**2<=1:(x/rules.radius)**2+(z/(rules.radius*rules.ellipse))**2<=1;
   if(!inside)fail('建筑需要放在岛内。');layouts[phase][id]=[x,z];
  }
  for(let i=0;i<BUILDINGS.length;i++)for(let j=i+1;j<BUILDINGS.length;j++){
   const a=layouts[phase][BUILDINGS[i]],b=layouts[phase][BUILDINGS[j]];if(Math.hypot(a[0]-b[0],a[1]-b[1])<LAYOUT_RULES.minDistance)fail('建筑距离太近，请留一些空间。');
  }
 }
 const threshold=value.growth?.threshold??30;if(!Number.isInteger(threshold)||threshold<5||threshold>10000)fail('成长目标需要是 5 到 10000 的整数。');
 const decorations=value.decorations??[];if(!Array.isArray(decorations)||decorations.length>6)fail('装饰数量无效。');const seen=new Set();const checked=decorations.map(item=>{if(!item||!Object.hasOwn(DECORATION_SLOTS,item.slot)||seen.has(item.slot)||!['tree','bench','lamp'].includes(item.type))fail('装饰地点或类型无效。');seen.add(item.slot);return {slot:item.slot,type:item.type};});
 if(value.scenery!=null&&(typeof value.scenery!=='object'||Array.isArray(value.scenery)))fail('布置配置无效。');
 const scenery={};
 for(const phase of ['initial','grown']){
  const source=value.scenery?.[phase]??{};if(!source||typeof source!=='object'||Array.isArray(source))fail('布置配置无效。');
  const point=(p)=>{if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||!sceneryInside(phase,p))fail('信箱和树木需要放在岛内。');if(BUILDINGS.some(id=>Math.hypot(p[0]-layouts[phase][id][0],p[1]-layouts[phase][id][1])<1.05))fail('信箱和树木需要避开建筑。');return [...p];};
  const postoffice=source.postoffice==null?null:point(source.postoffice),trees={};
  if(source.trees!=null&&(typeof source.trees!=='object'||Array.isArray(source.trees)))fail('树木布置无效。');
  for(const [id,p] of Object.entries(source.trees??{})){if(!SCENERY_TREE_IDS[phase].includes(id)&&!/^decoration-(west|northwest|northeast|east|southwest|south)$/.test(id))fail('树木编号无效。');trees[id]=point(p);}
  const positions=[...(postoffice?[postoffice]:[]),...Object.values(trees)];for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++)if(Math.hypot(positions[i][0]-positions[j][0],positions[i][1]-positions[j][1])<.5)fail('信箱和树木之间需要留出空间。');
  scenery[phase]={postoffice,trees};
 }
 return {schemaVersion:1,title,description,phase:value.phase,lighting:value.lighting,buildings,layouts,scenery,growth:{threshold,unlocked:value.growth?.unlocked===true||value.phase==='grown'},decorations:checked};
}
export function createIslandStore(dataDir){
 const filename=path.join(dataDir,'island.json');
 const atomic=value=>{const tmp=filename+'.'+randomBytes(5).toString('hex')+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,filename);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}};
 const read=()=>{if(!fs.existsSync(filename))return defaultIsland();const value=JSON.parse(fs.readFileSync(filename,'utf8'));const validated=validateIsland(value);if(!Number.isSafeInteger(value.revision)||value.revision<0)fail('岛屿版本数据无效。',500);return {...validated,revision:value.revision,updatedAt:value.updatedAt??null};};
 const initialize=()=>{if(!fs.existsSync(filename))atomic(defaultIsland());read();};
 const save=(input,baseRevision,{enforceGrowth=false,posts=[]}={})=>{
  const current=read();if(baseRevision!==current.revision)fail('岛屿已在其他页面更新。请重新载入后再保存。',409);
  const validated=validateIsland(input);if(enforceGrowth&&input.phase==='grown'&&!current.growth.unlocked&&!growthStats(posts,validated).eligible)fail('真实积累尚未达到扩岛目标，请先发布内容或调整成长目标。',409);validated.growth.unlocked=current.growth.unlocked||validated.phase==='grown';
  const next={...validated,revision:current.revision+1,updatedAt:new Date().toISOString()};
  const backups=path.join(dataDir,'backups');fs.mkdirSync(backups,{recursive:true});fs.copyFileSync(filename,path.join(backups,'island-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex')+'.json'));atomic(next);
  const previous=fs.readdirSync(backups).filter(name=>/^island-[\dTZ.-]+-[a-f0-9]+\.json$/.test(name)).sort();for(const name of previous.slice(0,Math.max(0,previous.length-10)))fs.unlinkSync(path.join(backups,name));
  return next;
 };
 return {initialize,read,save};
}
export const recordRevision=post=>createHash('sha256').update(JSON.stringify(post)).digest('hex');
export const adminRecord=post=>({...post,kind:post.kind||'blog',revision:recordRevision(post)});
export const publicRecord=post=>{const {slug,title,summary,topic,date,body,published,kind,project,cover,organization}=post;return {slug,title,summary,topic,date,body,published,cover:cover||'',kind:kind||'blog',...(organization?{organization}:{}),...(kind==='project'?{project}: {})};};
export function checkRecordRevision(req,post){const revision=String(req.headers['if-match']||'').replace(/^"|"$/g,'');if(!revision)fail('请刷新管理页面后再保存。',428);if(revision!==recordRevision(post))fail('这条内容已在其他页面更新。请重新载入后再编辑。',409);}
export function validateRecord(p){
 if(!p||typeof p!=='object')fail('记录格式无效。');const kind=p.kind??'blog';if(!['note','blog','project'].includes(kind))fail('内容类型无效。');
 const slug=p.slug||kind+'-'+Date.now().toString(36)+'-'+randomBytes(3).toString('hex');if(typeof slug!=='string'||!(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))||slug.length>80)fail('地址标识只能使用小写字母、数字和短横线。');
 const title=text(p.title,100,'标题'),body=text(p.body,100000,'正文');if(p.summary!=null&&typeof p.summary!=='string')fail('摘要格式无效。');const summary=p.summary?.trim()?text(p.summary,250,'摘要'):body.replace(/!\[[^\]\n]*\]\([^\s)]+\)/g,'').replace(/\[([^\]\n]+)\]\([^\s)]+\)/g,'$1').replace(/[`#*>\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,160);
 const topic=p.topic??(kind==='project'?'工程':'记录');if(!['记录','工程','探索'].includes(topic))fail('记录分类无效。');const date=p.date||new Date().toISOString().slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('记录日期无效。');
 const cover=p.cover??'';if(typeof cover!=='string'||(cover&&!/^\/media\/[a-f0-9]{32}\.webp$/.test(cover)))fail('请选择本站图片作为封面。');
 const value={slug,title,summary,body,topic,kind,date,cover,published:p.published===true,updatedAt:new Date().toISOString()};
 if(Object.hasOwn(p,'organization'))value.organization=validateOrganization(p.organization);
 if(kind==='project'){
  const project=p.project||{};const status=project.status||'active';if(!['planning','active','done'].includes(status))fail('项目状态无效。');value.project={status,role:text(project.role??'',120,'项目职责',{optional:true}),period:text(project.period??'',80,'项目时间',{optional:true})};
 }
 return value;
}
