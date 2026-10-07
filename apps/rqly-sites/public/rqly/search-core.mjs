// Shared, deterministic full-text matching. No network, model or HTML execution.
export const fold=value=>String(value??'').normalize('NFKC').toLowerCase();
export const terms=query=>[...new Set(fold(query).trim().split(/\s+/).filter(Boolean))];
export function plainText(value){
 return String(value??'').replace(/!\[([^\]\n]*)\]\([^\s)]+\)/g,'$1').replace(/\[([^\]\n]+)\]\([^\s)]+\)/g,'$1').replace(/^```[^\n]*$/gm,'').replace(/^\s*(?:#{1,3}\s+|>\s?|[-*]\s+|\d+\.\s+)/gm,'').replace(/[`*]/g,'').replace(/\s+/g,' ').trim().normalize('NFKC');
}
export function highlightParts(value,query,{limit=Infinity}={}){
 const text=String(value??''),words=terms(query),lower=fold(text),ranges=[];
 for(const word of words){if(ranges.length>=limit)break;let at=0;while(ranges.length<limit&&(at=lower.indexOf(word,at))>=0){ranges.push([at,at+word.length]);at+=word.length;}}
 ranges.sort((a,b)=>a[0]-b[0]);const merged=[];for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push(range);}
 const parts=[];let at=0;for(const [start,end] of merged){if(start>at)parts.push({text:text.slice(at,start),match:false});parts.push({text:text.slice(start,end),match:true});at=end;}if(at<text.length)parts.push({text:text.slice(at),match:false});return parts;
}
export function searchContent(entries,{q='',kind='',status='',topic='',scope='',order='relevance',organization=''}={}){
 const words=terms(q),results=[];
 for(const entry of entries){
  const p=entry.record,type=entry.type||'post',recordKind=p.kind||'blog',state=type==='editorDraft'?'editing':p.trashedAt?'trash':p.published?'published':'draft';
  if(kind&&recordKind!==kind||topic&&p.topic!==topic)continue;
  if(organization&&!((p.organization?.tags||[]).includes(organization)||(p.organization?.topics||[]).includes(organization)||p.organization?.series===organization))continue;
  if(status==='trash'?state!=='trash':state==='trash'||status==='published'&&state!=='published'||status==='draft'&&!['draft','editing'].includes(state))continue;
  if(scope==='library'&&recordKind==='project'||scope==='projects'&&recordKind!=='project'&&p.topic!=='工程'||scope==='workshop'&&(recordKind==='project'||p.topic!=='探索'))continue;
  const title=plainText(p.title),summary=plainText(p.summary),body=plainText(words.length?p.body:String(p.body||'').slice(0,240)),fields={title,summary,body,topic:p.topic,organization:[...(p.organizationDetails?.tags||[]),...(p.organizationDetails?.topics||[]),p.organizationDetails?.series].filter(Boolean).map(i=>i.name).join(' '),project:[p.project?.role,p.project?.period,p.organizationDetails?.project?.title].filter(Boolean).join(' ')},folded=Object.fromEntries(Object.entries(fields).map(([name,value])=>[name,fold(value)])),joined=Object.values(folded).join('\n');
  if(!words.every(word=>joined.includes(word)))continue;
  const matched=Object.entries(folded).filter(([,value])=>words.some(word=>value.includes(word))).map(([name])=>name);
  const score=words.reduce((n,word)=>n+(folded.title.includes(word)?100:0)+(folded.summary.includes(word)?25:0)+(folded.body.includes(word)?8:0),0);
  const source=matched.includes('body')?body:summary||body||title,lower=fold(source),indices=words.map(word=>lower.indexOf(word)).filter(n=>n>=0),at=indices.length?Math.min(...indices):0,start=Math.max(0,at-45),end=Math.min(source.length,start+150);
  const bodyLine=matched.includes('body')?String(p.body||'').split('\n').findIndex(line=>words.some(word=>fold(plainText(line)).includes(word))):-1;
  results.push({id:entry.id||p.slug,type,slug:p.slug||null,title:p.title||'未命名内容',kind:recordKind,topic:p.topic,date:p.date||'',updatedAt:p.updatedAt||p.date||'',status:state,matched,snippet:(start?'…':'')+source.slice(start,end)+(end<source.length?'…':''),bodyLine,score});
 }
 return results.sort((a,b)=>{if(order==='relevance'&&words.length&&a.score!==b.score)return b.score-a.score;const field=order==='date'?'date':'updatedAt';return b[field].localeCompare(a[field])||a.id.localeCompare(b.id);});
}
