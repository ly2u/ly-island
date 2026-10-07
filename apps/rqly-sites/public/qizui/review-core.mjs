export const ROLE_META={expert:{name:'专业人员',title:'把判断放回证据里。',description:'关注概念、结论和需要补充的依据。',number:'01'},audience:{name:'普通听众',title:'让听众跟得上你的思路。',description:'关注背景、术语和信息节奏。',number:'02'},editor:{name:'编辑',title:'让主线更清楚，句子更轻。',description:'关注结构、重点和表达次序。',number:'03'}};
export const EXAMPLE_TEXT='能滩吊桥的研究，不只是在回答一座老桥用了什么结构。我们更希望沿着四个问题来认识它：为什么要修、怎么修成、经历了什么、今天怎么认识。\n\n当时的道路需求、河谷地形、材料运输和施工条件，共同影响了结构选择。桥塔、主链、吊杆与桥面的构造关系，需要结合原始图纸和历史影像来解释。\n\n研究中，我们尝试将档案检索、现场测绘与数字化记录结合起来，梳理设计思路和建造过程，并讨论它所反映的工程技术与工业水平。对于涉及技术地位和历史沿革的判断，需要逐条找到对应的原始资料。\n\n希望通过这些工作，让一座桥的工程细节、地方记忆与交通历史，重新进入公众的视野。';
export function validateReviewInput(value){
  if(!value||typeof value.text!=='string')throw new Error('请粘贴需要审阅的正文。');
  const text=value.text.trim();if(text.length<40)throw new Error('正文至少需要 40 个字符。');if(text.length>12000)throw new Error('正文请控制在 12,000 个字符以内。');
  const audience=['旅游与交通跨界受众','专业技术人员','管理人员','普通公众'].includes(value.audience)?value.audience:'旅游与交通跨界受众';
  const duration=Number(value.duration);if(![5,10,20,25,30].includes(duration))throw new Error('请选择支持的汇报时长。');
  const engine=value.engine==='ai'?'ai':'rules';return{text,audience,duration,engine};
}
export function reviewRules(input){
  const{text,audience,duration}=validateReviewInput({...input,engine:'rules'});
  const paragraphs=text.split(/\n\s*\n/).filter(p=>p.trim());const sentences=text.split(/[。！？!?\n]+/).map(s=>s.trim()).filter(Boolean);
  const long=sentences.filter(s=>s.length>65);const longest=sentences.reduce((a,b)=>a.length>b.length?a:b,'');
  const terms=['桥塔','主链','吊杆','预应力','悬索','斜拉','抗弯','剪力','刚度','工业化','装配式','HBIM','BrIM','点云','量化','KV','LoRA','RAG','API'].filter(t=>text.includes(t));
  const claims=[...new Set(text.match(/首创|最早|唯一|第一|领先|率先|突破|全国首|国内首/g)||[])];
  const hasQuestion=/为什么|如何|怎么|问题|需要|需求/.test(text);const hasEvidence=/档案|资料|图纸|来源|据|调查|测绘|影像|数据/.test(text);
  const words=text.replace(/\s/g,'').length;const minute=Math.max(.1,Math.round(words/180*10)/10);
  const opening=sentences[0]||text.slice(0,80);const evidence=claims.length?[`为“${claims.join('、')}”对应的判断补充比较范围、原始资料与出处。`]:hasEvidence?['补齐文中所提档案、图纸、影像或数据的出处与时间，明确哪些是原文记载、哪些是研究推断。']:['涉及事实、年代、参数和技术地位的表述，逐项补充出处；基础检查无法验证其真伪。'];
  return{method:'rules',label:'基础检查',summary:`正文 ${words} 字符，${paragraphs.length} 个段落；按每分钟约 180 字粗估，约 ${minute} 分钟。`,roles:{
   expert:{assessment:hasEvidence?'稿件出现了资料或调查线索，适合进一步建立“判断—依据”的对应关系。当前提示基于文字特征，尚未核验技术结论。':'先把主要判断和依据对应起来。当前提示基于文字特征，尚未核验技术结论。',strengths:[hasQuestion?'正文从问题或需求切入，可作为组织论证的起点。':'已有一段完整材料，可以继续提炼核心问题。',hasEvidence?'提到了资料、图纸或调查，保留这些证据线索。':'先保留已确认的事实，再补充对应资料。'],suggestions:[claims.length?`稿件中出现“${claims.join('、')}”，先交代比较对象和范围，再作判断。`:'把结论和解释分开：哪些是文献记载，哪些是根据材料作出的推断。',terms.length?`“${terms.slice(0,4).join('、')}”等概念，需检查是否在全文中保持一致，并说明与主要结论的关系。`:'检查关键概念是否前后一致，避免同一个对象在不同段落中使用不同称呼。','对没有足够资料支撑的判断，改用“现有资料显示”或明确列为待核问题。'],rewrite:'',evidence},
   audience:{assessment:`你选择的受众是“${audience}”。${terms.length?'正文含有专业术语，宜先交代问题，再解释术语。':'可以继续检查背景与重点是否在开头交代清楚。'}`,strengths:[hasQuestion?'以问题组织内容，能帮助听众建立阅读顺序。':'已有可供听众理解的连续叙述。',/人|公众|两岸|交通|记忆|生活/.test(text)?'文字中出现了人或交通生活的线索，可以保留作为理解技术的入口。':'可以从与受众有关的场景引出主题。'],suggestions:[terms.length?`第一次出现“${terms.slice(0,3).join('、')}”时，用一句日常语言解释它在这里起什么作用。`:'开头补上一句背景：这件事发生在什么场景，为什么和听众有关。',long.length?`检测到 ${long.length} 个超过 65 字符的句子，可把条件、行动和结果拆开说。`:'段落之间补充清楚的转折或承接，让听众知道你为什么进入下一部分。',minute>duration?`正文粗估约 ${minute} 分钟，超过设定的 ${duration} 分钟；优先保留主线与一项关键例证。`:`当前文字粗估约 ${minute} 分钟；${duration} 分钟是整场汇报时长，仍需结合其他段落检查节奏。`],rewrite:'',evidence:[]},
   editor:{assessment:`稿件有 ${paragraphs.length} 个段落、约 ${sentences.length} 个句子。${long.length?'有偏长句子，先拆句，再检查每段是否只承担一个任务。':'先检查每段主旨和前后顺序，再处理词句。'}`,strengths:[paragraphs.length>1?'正文已分段，便于按背景、问题、行动和认识检查结构。':'材料长度适合先提炼一句中心意思。',hasQuestion?'问题句可作为章节或段落的引导。':'完整句子可以作为后续编辑的基础。'],suggestions:[long.length?`最长句约 ${longest.length} 字符：“${longest.slice(0,48)}…”；建议拆成两到三句。`:'优先检查首句是否直接交代主题，减少泛泛的铺垫。','每段先说最重要的一件事，再给必要的解释；重复的背景只保留一处。','结尾回到开头的问题，交代已经形成的认识和仍需继续研究的部分。'],rewrite:'',evidence:[]}
  }};
}
export function reviewMarkdown(result,input){let out=`# 七嘴审阅意见\n\n审阅方式：${result.label}\n受众：${input.audience}\n汇报时长：${input.duration} 分钟\n\n${result.summary||''}\n`;for(const key of ['expert','audience','editor']){const r=result.roles[key];out+=`\n## ${ROLE_META[key].name}\n\n${r.assessment}\n\n### 值得保留\n\n${r.strengths.map(s=>'- '+s).join('\n')}\n\n### 优先修改\n\n${r.suggestions.map((s,i)=>(i+1)+'. '+s).join('\n')}\n`;if(r.rewrite)out+=`\n### 表达参考\n\n${r.rewrite}\n`;if(r.evidence?.length)out+=`\n### 需要补充的依据\n\n${r.evidence.map(s=>'- '+s).join('\n')}\n`;}return out;}
