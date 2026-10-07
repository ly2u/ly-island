// Shared server/browser policy. MathML has no links, embedded HTML, SVG or event handlers.
export const HTML_TAGS=['p','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','strong','em','s','a','br','hr','table','thead','tbody','tr','th','td','div','span','img'];
export const MATH_TAGS=['math','semantics','annotation','mrow','mi','mo','mn','ms','mtext','mspace','mfrac','msqrt','mroot','msub','msup','msubsup','munder','mover','munderover','mtable','mtr','mtd','menclose','mpadded','mphantom','mstyle','mmultiscripts','mprescripts','none'];
export const ARTICLE_CLASSES=['content-image','content-table','math-block','math-error','katex','katex-mathml','align-left','align-center','align-right'];
export const MATH_ATTRIBUTES=['xmlns','display','encoding','mathvariant','stretchy','fence','separator','lspace','rspace','accent','accentunder','columnalign','rowalign','columnspacing','rowspacing','columnlines','rowlines','linethickness','scriptlevel','displaystyle','width','height','depth','voffset','lquote','rquote','notation','mathcolor','mathbackground','minsize','maxsize','equalrows','equalcolumns'];
export function validMathAttribute(name,value){
 if(name==='xmlns')return value==='http://www.w3.org/1998/Math/MathML';
 if(name==='display')return ['block','inline'].includes(value);
 if(name==='encoding')return value==='application/x-tex';
 if(name==='mathcolor'||name==='mathbackground')return /^(?:#[a-fA-F0-9]{3,8}|[a-zA-Z]{1,24})$/.test(value);
 return MATH_ATTRIBUTES.includes(name)&&typeof value==='string'&&value.length<=160&&/^[a-zA-Z0-9.+% ,:_-]*$/.test(value);
}
export function validArticleLink(value){
 if(typeof value!=='string'||/[\u0000-\u0020\u007f\\]/.test(value))return false;
 if(/^\/(?!\/)/.test(value))return true;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}
