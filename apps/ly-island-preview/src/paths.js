// Short ground paths around footprints, on a shared grid. Coordinates are world x/z.
export function routePath(start,end,{inside,blocked,step=.3,limit=5000}){
 const key=(x,z)=>x+','+z,cell=p=>p.map(v=>Math.round(v/step)),point=([x,z])=>[x*step,z*step];
 const legal=c=>{const p=point(c);return inside(p)&&!blocked(p);};
 const nearest=p=>{const c=cell(p);if(legal(c))return c;for(let r=1;r<=4;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++)if(Math.max(Math.abs(dx),Math.abs(dz))===r&&legal([c[0]+dx,c[1]+dz]))return[c[0]+dx,c[1]+dz];return null;};
 const a=nearest(start),b=nearest(end);if(!a||!b)return [];
 const target=key(...b),heuristic=c=>Math.hypot(c[0]-b[0],c[1]-b[1]),open=new Map([[key(...a),{cell:a,g:0,f:heuristic(a)}]]),closed=new Set(),parents=new Map();
 while(open.size&&closed.size<limit){let best;for(const [id,n] of open)if(!best||n.f<best[1].f)best=[id,n];const [id,n]=best;open.delete(id);if(id===target){const result=[n.cell];let prev=id;while(parents.has(prev)){const p=parents.get(prev);result.push(p);prev=key(...p);}return result.reverse().map(point);}closed.add(id);
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){const next=[n.cell[0]+dx,n.cell[1]+dz],k=key(...next);if(closed.has(k)||!legal(next))continue;if(dx&&dz&&(!legal([n.cell[0]+dx,n.cell[1]])||!legal([n.cell[0],n.cell[1]+dz])))continue;const g=n.g+Math.hypot(dx,dz);if(!open.has(k)||g<open.get(k).g){parents.set(k,n.cell);open.set(k,{cell:next,g,f:g+heuristic(next)});}}
 }
 return [];
}
