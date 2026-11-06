import {isPublicRecord} from './island-content.mjs';

export const GROWTH_RULES=Object.freeze([
 Object.freeze({id:'notes',label:'公开笔记',weight:1}),
 Object.freeze({id:'blogs',label:'公开博客',weight:3}),
 Object.freeze({id:'projects',label:'公开项目',weight:5}),
 Object.freeze({id:'completed',label:'完成项目奖励',weight:10})
]);
// Keep the existing two-stage rule identical on the server and in the browser.
export function growthStats(posts,island={}){
 const published=posts.filter(p=>p.published===true&&!p.trashedAt),notes=published.filter(p=>p.kind==='note').length,blogs=published.filter(p=>!p.kind||p.kind==='blog').length,projects=published.filter(p=>p.kind==='project').length,completed=published.filter(p=>p.kind==='project'&&p.project?.status==='done').length;
 const score=notes+blogs*3+projects*5+completed*10,threshold=island.growth?.threshold??30;
 return {notes,blogs,projects,completed,score,threshold,remaining:Math.max(0,threshold-score),eligible:score>=threshold,unlocked:island.growth?.unlocked||island.phase==='grown',stage:island.phase==='grown'?2:1};
}
export const growthBreakdown=stats=>GROWTH_RULES.map(rule=>({...rule,count:stats[rule.id]||0,score:(stats[rule.id]||0)*rule.weight}));
export function growthRecords(posts,limit=6){
 return posts.filter(isPublicRecord).slice(0,limit).map(post=>({slug:post.slug,title:post.title,date:post.date,kind:post.kind||'blog',topic:post.topic,points:post.kind==='note'?1:post.kind==='project'?(post.project?.status==='done'?15:5):3}));
}
