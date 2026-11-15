// Public, owner-authored display content. Technical URLs, credentials and permissions
// deliberately stay outside this document. Missing fields keep old island files readable.
export const PRESENTATION_SECTIONS=[
 {key:'home',title:'首页与站点名片',fields:[['brand','站点名称',40],['symbol','标志文字',8],['eyebrow','英文副标题',60],['headline','首页主标题',100,'textarea'],['identity','首页身份介绍',100],['seoTitle','浏览器 / 分享标题',100],['seoDescription','搜索 / 分享简介',250,'textarea'],['footer','页脚短句',180]]},
 {key:'owner',title:'岛主介绍',fields:[['name','公开署名',40],['tagline','身份与个人签名',120],['caption','侧栏短句',180,'textarea'],['heading','介绍页标题',100],['body','完整介绍 · Markdown',20000,'markdown']]},
 {key:'spaces',title:'空间内页标题',fields:[['library','书屋标题',100,'textarea'],['projects','工程展馆标题',100,'textarea'],['workshop','工坊标题',100,'textarea'],['blog','博客标题',100],['blogIntro','博客介绍',250,'textarea'],['mailboxName','信箱名称',16],['mailboxIntro','信箱介绍',250,'textarea'],['growthTitle','成长卡片标题',60]]},
 {key:'visibility',title:'首页展示开关',fields:[['growth','显示成长卡片',0,'checkbox'],['latest','显示最近更新',0,'checkbox'],['quickNav','显示底部快捷导航',0,'checkbox'],['identity','显示首页身份介绍',0,'checkbox']]},
 {key:'reading',title:'书屋默认视图',fields:[['libraryView','分类书架样式',0,'select']]}
];
export function defaultPresentation(){return {
 home:{brand:'记录与求索',symbol:'LY',eyebrow:'MY LITTLE WORLD',headline:'把日常的积累，\n建成自己的世界。',identity:'LY · 桥梁工程与数字工具实践',seoTitle:'LY 的浮空岛 · 桥梁工程与数字工具',seoDescription:'LY 的个人小岛：桥梁工程、日常记录与数字工具实践。在书屋查阅分类笔记，到岛主空间读博客，在工程展馆看项目。',footer:'把小的记录留下来，让认识慢慢生长。'},
 owner:{name:'LY',tagline:'记录与求索 / Record & Quest',caption:'在工程与日常之间，\n留下自己的线索。',heading:'做工程，也保持好奇。',body:'我是 LY，一名桥梁工程从业者。工作之外，我也关注桥梁遗产、历史资料，以及 AI 和数字工具能怎样帮助我们理解与记录工程。\n\n这个网站用来留下实践中的思考、读书时的线索和探索中的尝试。有些已经形成认识，有些仍是一串问题。\n\n## Record & Quest\n\nRQ 是记录与求索，LY 是我的姓名缩写。把小的记录留下来，让认识随着时间慢慢生长。\n\n### 桥梁\n\n结构、建造与长期服役，也包括桥梁连接的地方与人。\n\n### 历史\n\n从照片和档案里寻找线索，尽量让每一项判断回到证据。\n\n### 探索\n\nAI、本地模型、点云和工具实践，记录有用的尝试与问题。'},
 spaces:{library:'把知识，\n整理成自己的书架。',blog:'岛主的博客',blogIntro:'近况、随笔和一时想到的事，慢慢写在这里。',projects:'让一项工程，\n留下可以追溯的过程。',workshop:'把想法，\n做成用得上的东西。',mailboxName:'信箱',mailboxIntro:'看看路过的人留下的纸条，给岛主写一封信。',growthTitle:'让积累，看得见'},
 visibility:{growth:true,latest:true,quickNav:true,identity:true},reading:{libraryView:'all'},
 tools:[{name:'CivilFlow',detail:'把桥梁参数连成节点工作流，校验、编译，再导出 Civil JSON。',url:'https://midas.rqly.com',tag:'工作流 · 校验 · 导出',enabled:true},{name:'七嘴',detail:'给一份稿件换三个视角，找到值得修改的表达。',url:'https://7zui.com',tag:'专业人员 · 听众 · 编辑',enabled:true}]
};}
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const object=(value,label)=>{if(!value||typeof value!=='object'||Array.isArray(value))fail(label+'格式无效。');return value;};
export function safeToolURL(value){
 if(typeof value!=='string'||value.length>500||/[\u0000-\u0020\u007f\\]/.test(value))return null;
 try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||['/bridge.jpg','/rqly/bridge.jpg'].includes(decodeURIComponent(u.pathname)))return null;return u.href;}catch{return null;}
}
export function validatePresentation(input){
 const result=defaultPresentation();if(input===undefined)return result;object(input,'展示设置');
 const clean=(v,max,label,required=false)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)||(required&&!v.trim()))fail(label+'格式无效。');return v.trim();};
 for(const section of PRESENTATION_SECTIONS){if(input[section.key]===undefined)continue;const source=object(input[section.key],section.title);for(const [key,label,max,type]of section.fields){if(source[key]===undefined)continue;const v=source[key];if(type==='checkbox'){if(typeof v!=='boolean')fail(label+'需要是开关。');result[section.key][key]=v;}else if(type==='select'){if(!['all','notes','blogs'].includes(v))fail('书屋默认视图无效。');result.reading.libraryView=v;}else result[section.key][key]=clean(v,max,label,['name','brand','symbol','headline','heading','seoTitle','body','mailboxName','library','projects','workshop'].includes(key));}}
 if(input.tools!==undefined){if(!Array.isArray(input.tools)||input.tools.length>8)fail('工具入口最多 8 个。');result.tools=input.tools.map((raw,i)=>{const t=object(raw,'工具入口');const url=safeToolURL(t.url);if(!url)fail('工具地址只接受不含账号密码的 HTTP / HTTPS 链接。');if(typeof t.enabled!=='boolean')fail('工具显示状态无效。');return {name:clean(t.name,40,'工具名称',true),detail:clean(t.detail,250,'工具介绍'),url,tag:clean(t.tag,100,'工具标签'),enabled:t.enabled};});}
 return result;
}

const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Only fixed slots in our trusted, built shell are substituted. Owner text is
// never a template, attribute name, script, stylesheet or arbitrary HTML.
export function renderIslandHome(shell,island,origin){
 const p=island.presentation||defaultPresentation(),esc=escapeHTML;
 let html=shell.replace(/<title>[\s\S]*?<\/title>/,()=>'<title>'+esc(p.home.seoTitle)+'</title>');
 for(const [property,value]of [['name="description"',p.home.seoDescription],['property="og:title"',p.home.seoTitle],['property="og:description"',p.home.seoDescription],['property="og:url"',origin+'/']]){const pattern=new RegExp('<meta '+property+' content="[^"]*">');html=html.replace(pattern,()=>'<meta '+property+' content="'+esc(value)+'">');}
 html=html.replace(/<link rel="canonical" href="[^"]*">/,()=>'<link rel="canonical" href="'+esc(origin+'/')+'">');
 const slots={title:island.title,description:island.description,headline:p.home.headline,brand:p.home.brand,symbol:p.home.symbol,eyebrow:p.home.eyebrow,identity:p.home.identity+' ↗',footer:p.home.footer,owner:p.owner.name,growth:p.spaces.growthTitle,mailbox:p.spaces.mailboxName,mailboxIntro:p.spaces.mailboxIntro};
 for(const [key,value]of Object.entries(slots)){const pattern=new RegExp('(<([a-z][a-z0-9]*) data-display="'+key+'"[^>]*>)[\\s\\S]*?(</\\2>)','g');html=html.replace(pattern,(_,open,tag,close)=>open+esc(value)+close);}
 for(const [key,selector]of [['growth','class="growth-card"'],['identity','class="intro-identity"'],['quickNav','class="quick-nav"']])if(!p.visibility[key])html=html.replace(selector,selector+' hidden');
 // The no-JS links use the same building names and enabled tool list as the island.
 for(const [id,b]of Object.entries(island.buildings))html=html.replace(new RegExp('(data-building-name="'+id+'">)[^<]*','g'),(_,start)=>start+esc(b.name));
 const tools=p.tools.filter(t=>t.enabled).map(t=>'<a href="'+esc(t.url)+'" rel="noopener noreferrer">'+esc(t.name)+' ↗</a>').join('');
 html=html.replace(/<span data-public-tools>[\s\S]*?<\/span>/,()=>'<span data-public-tools>'+tools+'</span>');
 const tool=p.tools.find(t=>t.enabled);html=html.replace(/(<a )([^>]*href=")[^"]*("[^>]*data-room-link="workshop"[^>]*>)/g,(_,a,b,c)=>a+b+esc(tool?.url||'/notes?topic=探索')+c);
 return html;
}
