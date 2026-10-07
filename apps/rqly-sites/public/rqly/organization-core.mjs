export const organizationTypes={tag:'标签',topic:'专题',series:'系列'};
export function validateOrganization(value={}){
 const fail=()=>{throw new Error('内容归属格式无效。');};
 if(!value||typeof value!=='object'||Array.isArray(value))fail();
 const ids=key=>{const a=value[key]??[];if(!Array.isArray(a)||a.length>20||a.some(id=>typeof id!=='string'||!/^org-[a-f0-9]{16}$/.test(id))||new Set(a).size!==a.length)fail();return [...a];};
 const series=value.series??'',projectSlug=value.projectSlug??'',order=value.order??1;
 if(typeof series!=='string'||series&&!/^org-[a-f0-9]{16}$/.test(series)||typeof projectSlug!=='string'||projectSlug&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectSlug)||projectSlug.length>80||!Number.isSafeInteger(order)||order<1||order>10000)fail();
 return {tags:ids('tags'),topics:ids('topics'),series,order,projectSlug};
}
export function usesOrganization(post,id){const o=post.organization;return Boolean(o&&(o.tags?.includes(id)||o.topics?.includes(id)||o.series===id));}
export function organizationDetails(post,catalog,posts){
 const o=post.organization||{},items=catalog.items||[],find=(id,type)=>items.find(item=>item.id===id&&item.type===type),project=posts.find(p=>p.slug===o.projectSlug&&p.kind==='project');
 return {tags:(o.tags||[]).map(id=>find(id,'tag')).filter(Boolean),topics:(o.topics||[]).map(id=>find(id,'topic')).filter(Boolean),series:find(o.series,'series')||null,project:project?{slug:project.slug,title:project.title}:null};
}
export function decorateOrganization(post,catalog,posts){return {...post,organizationDetails:organizationDetails(post,catalog,posts)};}
export function seriesRecords(posts,id){return posts.filter(p=>p.organization?.series===id).sort((a,b)=>(a.organization.order||1)-(b.organization.order||1)||a.date.localeCompare(b.date)||a.slug.localeCompare(b.slug));}
