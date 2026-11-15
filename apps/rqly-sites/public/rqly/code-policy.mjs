// Shared metadata and finite markup policy; no highlighter is shipped to the browser.
export const CODE_LANGUAGES=Object.freeze([
 ['text','纯文本'],['python','Python'],['javascript','JavaScript'],['typescript','TypeScript'],
 ['bash','Shell'],['powershell','PowerShell'],['json','JSON'],['yaml','YAML'],
 ['xml','HTML / XML'],['css','CSS'],['sql','SQL'],['c','C'],['cpp','C++'],
 ['csharp','C#'],['ini','INI / TOML'],['markdown','Markdown'],['latex','LaTeX'],['diff','Diff']
].map(([id,label])=>Object.freeze({id,label})));
const aliases={txt:'text',plaintext:'text',none:'text',nohighlight:'text',py:'python',python3:'python',js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',sh:'bash',shell:'bash',shellscript:'bash',ps1:'powershell',yml:'yaml',html:'xml',svg:'xml',vue:'xml',h:'c','c++':'cpp',cc:'cpp',cxx:'cpp',hpp:'cpp',cs:'csharp','c#':'csharp',toml:'ini',md:'markdown',tex:'latex'};
export function codeLanguage(info=''){
 const token=String(info).trim().split(/\s+/,1)[0].toLowerCase();
 const key=Object.hasOwn(aliases,token)?aliases[token]:token;
 return CODE_LANGUAGES.find(item=>item.id===key)||CODE_LANGUAGES[0];
}
export const validCodeLanguage=value=>CODE_LANGUAGES.some(item=>item.id===value);
export const CODE_CLASSES=Object.freeze(['code-block','code-block-heading','code-language','hljs',
 'hljs-keyword','hljs-built_in','hljs-type','hljs-literal','hljs-number','hljs-operator','hljs-punctuation','hljs-property','hljs-regexp','hljs-string','hljs-char','hljs-escape','hljs-subst','hljs-symbol','hljs-variable','hljs-title','hljs-params','hljs-comment','hljs-doctag','hljs-meta','hljs-section','hljs-tag','hljs-name','hljs-attr','hljs-attribute','hljs-bullet','hljs-code','hljs-emphasis','hljs-strong','hljs-formula','hljs-link','hljs-quote','hljs-selector-tag','hljs-selector-id','hljs-selector-class','hljs-selector-attr','hljs-selector-pseudo','hljs-template-tag','hljs-template-variable','hljs-addition','hljs-deletion','class_','function_']);
