// Shared by the server, owner controls and public island; inputs are metadata.
export const CONTENT_ROOMS=['library','projects','workshop'];
export const validRecordSlug=value=>typeof value==='string'&&value.length<=80&&value.trim()===value&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
export const isPublicRecord=post=>Boolean(post&&post.published===true&&!post.trashedAt&&validRecordSlug(post.slug));
export function belongsToRoom(post,room){
 if(!isPublicRecord(post))return false;
 if(room==='library')return post.kind!=='project';
 if(room==='projects')return post.kind==='project'||post.topic==='工程';
 if(room==='workshop')return post.kind!=='project'&&post.topic==='探索';
 return room==='search';
}
export const roomRecords=(posts,room)=>posts.filter(post=>belongsToRoom(post,room));
export function recommendedRecords(posts,island,room){
 const records=roomRecords(posts,room),bySlug=new Map(records.map(post=>[post.slug,post]));
 const selected=(island?.buildings?.[room]?.featuredSlugs||[]).map(slug=>bySlug.get(slug)).filter(Boolean).slice(0,2);
 return {records,recommendations:selected.length?selected:records.slice(0,2),curated:selected.length>0};
}
export function recordRoom(post,preferred){
 if(belongsToRoom(post,preferred))return preferred;
 return post.kind==='project'?'projects':post.topic==='探索'?'workshop':'library';
}
export function readingHref(post,preferred){return '#'+new URLSearchParams({room:recordRoom(post,preferred),article:post.slug});}

export function readingPositions(value,now=Date.now()){
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 return Object.fromEntries(Object.entries(value).filter(([slug,item])=>validRecordSlug(slug)&&item&&typeof item==='object'&&Number.isFinite(item.ratio)&&item.ratio>=0&&item.ratio<=1&&Number.isFinite(item.updated)&&item.updated>0&&item.updated<=now+300000).sort((a,b)=>b[1].updated-a[1].updated).slice(0,40).map(([slug,item])=>[slug,{ratio:item.ratio,updated:item.updated,...([...CONTENT_ROOMS,'search'].includes(item.room)?{room:item.room}:{})}]));
}
export function resumableRecord(posts,positions){
 const publicPosts=new Map(posts.filter(isPublicRecord).map(post=>[post.slug,post]));
 for(const [slug,progress] of Object.entries(readingPositions(positions))){
  const post=publicPosts.get(slug);if(post&&progress.ratio>0&&progress.ratio<.97)return {post,progress,room:recordRoom(post,progress.room)};
 }
 return null;
}
export function relatedRecords(post,posts,limit=3){
 const a=post.organization||{},shared=(left=[],right=[])=>left.filter(id=>right.includes(id)).length;
 return posts.filter(p=>isPublicRecord(p)&&p.slug!==post.slug).map((p,index)=>{
  const b=p.organization||{};let score=0;
  if(a.series&&a.series===b.series)score+=10;
  const project=post.kind==='project'?post.slug:a.projectSlug,other=p.kind==='project'?p.slug:b.projectSlug;
  if(project&&project===other)score+=8;
  score+=shared(a.topics,b.topics)*4+shared(a.tags,b.tags)*2+(post.topic===p.topic?1:0);
  return {post:p,score,index};
 }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(item=>item.post);
}
