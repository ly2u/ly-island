// Coarse input and very limited advertised hardware are hints, not a device benchmark.
// A visitor's explicit choice always wins, including on a data-saving connection.
export function initialVisit({savedView,saveData=false,coarse=false,memory,cores}={}){
 if(savedView==='reading')return {reading:true,reason:'回到轻量导览，也可以随时打开 3D 小岛。'};
 if(savedView==='3d')return {reading:false};
 if(saveData)return {reading:true,reason:'已按省流量设置打开轻量导览；需要时再加载 3D 小岛。'};
 const limited=n=>Number.isFinite(n)&&n>0&&n<=2;
 if(coarse&&(limited(memory)||limited(cores)))return {reading:true,reason:'先用轻量导览浏览，点击按钮也可以试试 3D 小岛。'};
 return {reading:false};
}
export const interactionHint=(coarse,arranging=false)=>arranging?(coarse?'拖动建筑布置 · 双指缩放':'拖动建筑布置 · 空白处拖动旋转'):(coarse?'单指旋转 · 双指缩放 · 轻点建筑探索':'拖动旋转 · 滚轮缩放 · 点击建筑探索');
