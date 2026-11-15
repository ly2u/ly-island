// Shared by the server, owner controls and public island; inputs are metadata.
export const CONTENT_ROOMS=['library','projects','workshop','blog'];
export const validRecordSlug=value=>typeof value==='string'&&value.length<=80&&value.trim()===value&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
export const isPublicRecord=post=>Boolean(post&&post.published===true&&!post.trashedAt&&validRecordSlug(post.slug));
export function belongsToRoom(post,room){
 if(!isPublicRecord(post))return false;
 if(room==='library')return post.kind==='note';
 if(room==='blog')return !post.kind||post.kind==='blog';
 if(room==='projects')return post.kind==='project'||post.kind==='note'&&post.topic==='工程';
 if(room==='workshop')return post.kind==='note'&&post.topic==='探索';
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
 return post.kind==='project'?'projects':post.kind==='note'?'library':'blog';
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

// A category is a book; the notes inside it keep their own stable article URLs.
export const validBookId=id=>typeof id==='string'&&/^(?:org-[a-f0-9]{16}|general|engineering|exploration)$/.test(id)&&id.trim()===id;
export function knowledgeBooks(posts){
 const books=new Map(),seen=new Set();
 for(const p of posts){if(!isPublicRecord(p)||p.kind!=='note'||seen.has(p.slug))continue;seen.add(p.slug);
  const categories=(p.organizationDetails?.topics||[]).filter(i=>validBookId(i.id)&&i.id.startsWith('org-')&&typeof i.name==='string'&&i.name.trim());
  const groups=categories.length?categories:[p.topic==='工程'?{id:'engineering',name:'工程笔记',description:'工程知识与方法。'}:p.topic==='探索'?{id:'exploration',name:'探索笔记',description:'工具、方法与学习资料。'}:{id:'general',name:'待分类',description:'暂未指定分类的笔记，先完整保留在这里。'}];
  for(const category of groups){if(!books.has(category.id))books.set(category.id,{id:category.id,title:category.name,description:category.description||'',notes:[]});const book=books.get(category.id);if(!book.notes.some(n=>n.slug===p.slug))book.notes.push(p);}
 }
 return [...books.values()].sort((a,b)=>a.id==='general'?1:b.id==='general'?-1:a.title.localeCompare(b.title,'zh-CN'));
}
