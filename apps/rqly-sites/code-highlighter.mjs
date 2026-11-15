import core from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import powershell from 'highlight.js/lib/languages/powershell';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import ini from 'highlight.js/lib/languages/ini';
import markdown from 'highlight.js/lib/languages/markdown';
import latex from 'highlight.js/lib/languages/latex';
import diff from 'highlight.js/lib/languages/diff';
import {codeLanguage} from './public/rqly/code-policy.mjs';
const hljs=core.newInstance();
for(const [name,grammar]of Object.entries({python,javascript,typescript,bash,powershell,json,yaml,xml,css,sql,c,cpp,csharp,ini,markdown,latex,diff}))hljs.registerLanguage(name,grammar);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function highlightCode(code,info,env={}){
 const language=codeLanguage(info);let html=escape(code);
 env.codeBlocks=(env.codeBlocks||0)+1;env.codeChars=(env.codeChars||0)+code.length;
 if(language.id!=='text'&&code.length<=20000&&env.codeChars<=50000&&env.codeBlocks<=200){
  try{html=hljs.highlight(code,{language:language.id,ignoreIllegals:true}).value;}catch{}
 }
 return {html,language:language.id,label:language.label};
}
