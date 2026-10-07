import MarkdownIt from 'markdown-it';
import {tex} from '@mdit/plugin-tex';
import katex from 'katex';
import sanitizeHtml from 'sanitize-html';
import {HTML_TAGS,MATH_TAGS,ARTICLE_CLASSES,MATH_ATTRIBUTES,validMathAttribute,validArticleLink} from './public/rqly/article-policy.mjs';
export function createMarkdownRenderer({imageMetadata=()=>null}={}){
 const md=new MarkdownIt({html:false,linkify:false,typographer:false,breaks:false,maxNesting:30});
 md.validateLink=validArticleLink;
 md.use(tex,{delimiters:'dollars',allowInlineWithSpace:false,mathFence:false,render:(content,displayMode,env)=>{
  env.mathCount=(env.mathCount||0)+1;env.mathChars=(env.mathChars||0)+content.length;
  try{if(content.length>4000||env.mathCount>100||env.mathChars>30000)throw Error();return katex.renderToString(content,{displayMode,output:'mathml',trust:false,throwOnError:true,strict:'ignore',maxExpand:1000,maxSize:20,macros:{}});}
  catch{return '<span class="math-error" role="note" aria-label="公式未能渲染，显示原文">'+md.utils.escapeHtml(content)+'</span>';}
 }});
 const attrs=(token,env)=>env.sourceMap&&token.map?' data-source-start="'+token.map[0]+'" data-source-end="'+Math.max(token.map[0],token.map[1]-1)+'"':'';
 md.core.ruler.push('ly_document_policy',(state)=>{
  for(const token of state.tokens){
   if(token.type==='heading_open'||token.type==='heading_close'){if(token.tag==='h1')token.tag='h2';}
   if(state.env.sourceMap&&token.map&&(token.nesting===1||token.type==='hr')){token.attrSet('data-source-start',String(token.map[0]));token.attrSet('data-source-end',String(Math.max(token.map[0],token.map[1]-1)));}
   if(['th_open','td_open'].includes(token.type)){const alignment=token.attrGet('style')?.match(/^text-align:(left|center|right)$/)?.[1];if(alignment){token.attrs=token.attrs.filter(([name])=>name!=='style');token.attrSet('class','align-'+alignment);}}
   for(const inline of token.children||[]){if(inline.type==='link_open'&&/^https?:/.test(inline.attrGet('href')||'')){inline.attrSet('target','_blank');inline.attrSet('rel','noopener noreferrer');}}
  }
 });
 md.renderer.rules.image=(tokens,index)=>{const token=tokens[index],url=token.attrGet('src')||'',alt=token.content||'';if(!/^\/media\/[a-f0-9]{32}\.webp$/.test(url))return md.utils.escapeHtml(alt);const metadata=imageMetadata(url.slice(7));if(!metadata)return md.utils.escapeHtml(alt);return '<img class="content-image" src="'+url+'" alt="'+md.utils.escapeHtml(alt)+'" width="'+metadata.width+'" height="'+metadata.height+'" loading="lazy" decoding="async">';};
 md.renderer.rules.fence=md.renderer.rules.code_block=(tokens,index,options,env)=>'<pre'+attrs(tokens[index],env)+'><code>'+md.utils.escapeHtml(tokens[index].content.replace(/\n$/,''))+'</code></pre>\n';
 const math=md.renderer.rules.math_block;md.renderer.rules.math_block=(tokens,index,options,env,renderer)=>'<div class="math-block"'+attrs(tokens[index],env)+'>'+math(tokens,index,options,env,renderer)+'</div>\n';
 md.renderer.rules.table_open=(tokens,index,options,env,renderer)=>'<div class="content-table" role="region" tabindex="0" aria-label="数据表格，可横向滚动">'+renderer.renderToken(tokens,index,options);
 md.renderer.rules.table_close=()=>'</table></div>\n';
 return (value,{sourceMap=false}={})=>sanitizeHtml(md.render(String(value).replace(/\r\n?/g,'\n'),{sourceMap}),{
  allowedTags:[...HTML_TAGS,...MATH_TAGS],allowedAttributes:{'*':['data-source-start','data-source-end'],a:['href','target','rel'],img:['src','alt','width','height','loading','decoding','class'],div:['class','role','tabindex','aria-label'],span:['class','role','aria-label'],th:['class'],td:['class'],ol:['start'],...Object.fromEntries(MATH_TAGS.map(tag=>[tag,MATH_ATTRIBUTES]))},
  allowedClasses:{'*':ARTICLE_CLASSES},allowedSchemes:['http','https'],allowProtocolRelative:false,
  transformTags:{'*':(tagName,attributes)=>{for(const [name,value] of Object.entries(attributes)){if(name.startsWith('data-source-')&&!/^\d{1,6}$/.test(value))delete attributes[name];if(MATH_TAGS.includes(tagName)&&!validMathAttribute(name,value))delete attributes[name];}return {tagName,attribs:attributes};}},
 });
}
