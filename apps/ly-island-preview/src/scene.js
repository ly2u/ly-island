import * as THREE from 'three';
import {routePath} from './paths.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const color = {
  grass:0xa9bba0,grass2:0xb5c7a8,earth:0xb5ac95,rock:0xaaa692,
  cream:0xf4eddb,stone:0xdedbcb,timber:0x80634c,roof:0xb47754,
  glass:0x9bb8b5,frame:0x657f72,metal:0x6e8785,leaves:0x789775,
  path:0xd8ccb0,water:0xa3c5be,gold:0xdab578
};
// Layout JSON stays in logical coordinates; spread the land without scaling buildings.
const LAND_SPREAD=1.25;
const spread=([x,z])=>[x*LAND_SPREAD,z*LAND_SPREAD];
const mats=new Map();
function material(c,extras={}) {
 const key=c+JSON.stringify(extras);
 if(!mats.has(key))mats.set(key,new THREE.MeshStandardMaterial({color:c,roughness:.9,flatShading:true,...extras}));
 return mats.get(key);
}
const windows=new Set();
function mesh(parent,geo,c,x=0,y=0,z=0,extras={}) {
 const obj=new THREE.Mesh(geo,material(c,extras));obj.position.set(x,y,z);
 obj.castShadow=true;obj.receiveShadow=true;parent.add(obj);return obj;
}
function box(p,w,h,d,c,x=0,y=0,z=0,extras={}) {return mesh(p,new THREE.BoxGeometry(w,h,d),c,x,y,z,extras);}
function cylinder(p,rt,rb,h,c,x=0,y=0,z=0,n=8){return mesh(p,new THREE.CylinderGeometry(rt,rb,h,n),c,x,y,z);}
function bar(p,a,b,r,c) {
 const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),v=B.clone().sub(A);
 const o=cylinder(p,r,r,v.length(),c,...A.clone().add(B).multiplyScalar(.5).toArray(),6);
 o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return o;
}
function roof(p,width,depth,y,c,height=.72) {
 const s=new THREE.Shape();s.moveTo(-width/2,0);s.lineTo(0,height);s.lineTo(width/2,0);s.closePath();
 return mesh(p,new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false}),c,0,y,-depth/2);
}
function windowPane(p,x,y,z,w=.46,h=.55) {
 box(p,w+.09,h+.09,.07,color.timber,x,y,z);
 const glass=box(p,w,h,.08,color.glass,x,y,z+.045,{emissive:0xb9a56c,emissiveIntensity:.08,roughness:.45});
 windows.add(glass.material);box(p,.035,h,.11,color.cream,x,y,z+.065);
 box(p,w,.035,.11,color.cream,x,y,z+.065);
}
function door(p,x,z) {
 const s=new THREE.Shape();s.moveTo(-.25,0);s.lineTo(-.25,.56);s.absarc(0,.56,.25,Math.PI,0,true);s.lineTo(.25,0);s.closePath();
 mesh(p,new THREE.ExtrudeGeometry(s,{depth:.055,bevelEnabled:false}),color.timber,x,.19,z);
 box(p,.055,.03,.035,color.gold,x+.13,.58,z+.065);
}
function stairs(p,x,z,w=1.05) {
 for(let i=0;i<3;i++)box(p,w,.07*(3-i),.23,color.stone,x,.12+.035*(3-i),z+i*.22);
}
function book(p,x,z,c) {const b=box(p,.14,.27,.21,c,x,.31,z);b.rotation.z=.06;box(p,.1,.025,.18,color.cream,x,.452,z);}
function bench(p,x,z) {
 box(p,1,.09,.31,color.timber,x,.38,z);box(p,1,.12,.07,color.timber,x,.63,z-.15);
 for(const dx of [-.36,.36])box(p,.09,.26,.28,color.frame,x+dx,.2,z);
}
function postBox(parent){
 cylinder(parent,.54,.61,.13,color.stone,0,.08,0,10);
 box(parent,.18,.67,.2,color.timber,0,.47,0);
 box(parent,.82,.7,.55,0xb77659,0,1.12,0);
 roof(parent,.96,.69,1.46,color.roof,.18);
 box(parent,.54,.055,.025,0x594d42,0,1.28,.29);
 box(parent,.42,.25,.025,color.cream,0,1.02,.3);
 bar(parent,[-.2,1.13,.325],[0,.98,.325],.009,color.frame);
 bar(parent,[0,.98,.325],[.2,1.13,.325],.009,color.frame);
 bar(parent,[.47,1.06,0],[.47,1.67,0],.018,color.frame);
 box(parent,.24,.15,.035,color.gold,.59,1.6,0);
 return 1.65;
}
function lamp(p,x,z) {
 cylinder(p,.028,.035,.83,color.frame,x,.5,z,6);
 box(p,.15,.2,.15,color.gold,x,.98,z,{emissive:0xe3bf7f,emissiveIntensity:.16});
 box(p,.21,.055,.21,color.frame,x,1.1,z);
}
function tree(p,x,z,height=1.5,variant=0) {
 const g=new THREE.Group();g.position.set(x,.1,z);p.add(g);
 cylinder(g,.055,.09,height*.57,color.timber,0,height*.3,0,6);
 if(variant===0) {
  cylinder(g,.01,height*.28,height*.68,color.leaves,0,height*.67,0,6);
  cylinder(g,.01,height*.22,height*.6,0x8ca482,0,height*.94,0,6);
 } else {
  const a=mesh(g,new THREE.IcosahedronGeometry(height*.36,0),0x91a67e,0,height*.83,0);a.scale.set(1,1.22,.92);
  mesh(g,new THREE.IcosahedronGeometry(height*.23,0),0xa0b28c,height*.2,height*.64,0);
 }
 return g;
}
function keeperNotebook(parent) {
 // A small personal notebook, below the buildings' windows and doorways.
 box(parent,.96,.10,.72,0xc9c5b6,0,.10,0);
 box(parent,.88,.23,.64,0xe2ddce,0,.255,0);
 box(parent,.92,.055,.68,0xf0eadb,0,.398,0);
 const notebook=openBook(parent,0,.49,0,.74);notebook.rotation.y=-.12;
 // Pencil laid across the open pages, with a brass nib and a quiet bookmark.
 bar(parent,[.10,.64,.17],[.40,.89,-.19],.035,0x6f8777);
 bar(parent,[.075,.62,.20],[.10,.64,.17],.030,color.gold);
 bar(parent,[.40,.89,-.19],[.44,.92,-.23],.037,0xe0cba5);
 box(parent,.06,.016,.20,0x9a7356,-.09,.57,.21);
 return .95;
}
function rockIsland(parent,radius,x=0,z=0,ellipse=.83) {
 const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);
 const count=13,rings=[{y:.07,r:radius*.97},{y:-.3,r:radius},{y:-1.15,r:radius*.91},{y:-2.9,r:radius*.45},{y:-3.85,r:radius*.13}];
 const points=rings.map((ring,j)=>Array.from({length:count},(_,i)=>{
 const a=i/count*Math.PI*2;const wobble=1+Math.sin(i*4.7)*.045;
 return new THREE.Vector3(Math.cos(a)*ring.r*wobble,ring.y+(j>1?Math.cos(i*3.2)*.16:0),Math.sin(a)*ring.r*ellipse*wobble);
 }));
 const vertices=[],colors=[];
 const add=(a,b,c,col)=>{for(const v of [a,b,c]){vertices.push(v.x,v.y,v.z);colors.push(col.r,col.g,col.b);}};
 for(let j=0;j<rings.length-1;j++)for(let i=0;i<count;i++){
 const n=(i+1)%count;const shade=new THREE.Color(j===0?0xc4b898:j===1?0xb9b095:j===2?0xa4a18e:0x93988b);
 shade.multiplyScalar(.92+.14*(.5+.5*Math.sin(i*2.1+j)));
 add(points[j][i],points[j][n],points[j+1][n],shade);add(points[j][i],points[j+1][n],points[j+1][i],shade);
 }
 const tip=new THREE.Vector3(0,-4.15,0);
 for(let i=0;i<count;i++)add(points.at(-1)[i],points.at(-1)[(i+1)%count],tip,new THREE.Color(0x93988b));
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
 const rock=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true}));rock.castShadow=true;rock.receiveShadow=true;g.add(rock);
 const positions=[],topcolors=[];for(let i=0;i<count;i++){
 const next=(i+1)%count;const shade=new THREE.Color(i%3===0?0xb3c4a6:0xaabe9e);
 for(const v of [new THREE.Vector3(0,.1,0),points[0][next].clone().setY(.1),points[0][i].clone().setY(.1)]){positions.push(v.x,v.y,v.z);topcolors.push(shade.r,shade.g,shade.b);}
 }
 const topGeo=new THREE.BufferGeometry();topGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));topGeo.setAttribute('color',new THREE.Float32BufferAttribute(topcolors,3));topGeo.computeVertexNormals();
 const top=new THREE.Mesh(topGeo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true,side:THREE.DoubleSide}));top.receiveShadow=true;g.add(top);
 return g;
}
function steppingPath(parent,a,b,width=.48) {
 const A=new THREE.Vector3(a[0],.13,a[1]),B=new THREE.Vector3(b[0],.13,b[1]);
 const count=Math.max(1,Math.ceil(A.distanceTo(B)/.5));for(let i=0;i<=count;i++){
 const pt=A.clone().lerp(B,i/count);const o=box(parent,width,.045,.36,color.path,pt.x,pt.y,pt.z);o.rotation.y=Math.atan2(B.x-A.x,B.z-A.z)+(i%2===0?.06:-.04);
 }
}
function bridge(parent,x,z,length) {
 const g=new THREE.Group();g.position.set(x,.2,z);parent.add(g);
 box(g,length,.12,.78,color.timber,0,0,0);
 for(let i=0;i<Math.ceil(length/.2);i++)box(g,.065,.025,.8,color.path,-length/2+i*.2,.08,0);
 for(const side of [-1,1]){
  for(let i=0;i<=4;i++){const px=-length/2+i*length/4;bar(g,[px,.09,side*.36],[px,.62,side*.36],.025,color.frame);}
  bar(g,[-length/2,.62,side*.36],[length/2,.62,side*.36],.025,color.frame);
  bar(g,[-length/2,-.06,side*.35],[0,-.5,side*.35],.045,color.timber);
  bar(g,[0,-.5,side*.35],[length/2,-.06,side*.35],.045,color.timber);
 }
 return g;
}
function tinyBridge(parent,x,z) {
 const g=new THREE.Group();g.position.set(x,.35,z);parent.add(g);
 box(g,1.3,.08,.4,color.cream,0,.35,0);
 for(const s of [-1,1]){
  bar(g,[-.62,.35,s*.17],[-.4,.7,s*.17],.024,color.frame);
  bar(g,[-.4,.7,s*.17],[.4,.7,s*.17],.024,color.frame);
  bar(g,[.4,.7,s*.17],[.62,.35,s*.17],.024,color.frame);
  for(let i=0;i<4;i++)bar(g,[-.4+i*.2,.7,s*.17],[-.2+i*.2,.35,s*.17],.018,color.frame);
 }
 for(const dx of [-.48,.48])box(g,.12,.31,.32,color.stone,dx,.17,0);
}
function openBook(p,x,y,z,size=1) {
 const g=new THREE.Group();g.position.set(x,y,z);p.add(g);
 for(const side of [-1,1]){
  const leaf=new THREE.Group();leaf.position.x=side*.29*size;leaf.rotation.z=side*.19;g.add(leaf);
  box(leaf,.6*size,.055*size,.6*size,0x9a6043,0,-.045*size,0);
  box(leaf,.55*size,.07*size,.54*size,color.cream,0,.016*size,0);
  for(let i=0;i<4;i++)box(leaf,.38*size,.008*size,.009*size,0xc3b596,0,.056*size,-.15*size+i*.095*size);
 }
 cylinder(g,.04*size,.04*size,.62*size,color.gold,0,-.03*size,0,8).rotation.x=Math.PI/2;
 return g;
}
function bookshelf(p,x,y,z,width=.95) {
 box(p,width+.12,.85,.16,color.timber,x,y,z);
 box(p,width,.72,.04,0x554c3d,x,y,z+.095);
 for(const dy of [-.32,.04,.38])box(p,width+.05,.045,.19,color.cream,x,y+dy,z+.1);
 for(let row=0;row<2;row++)for(let i=0;i<8;i++){
  const h=.2+(i%3)*.045,b=box(p,width/9,h,.13,[0x789486,0xb58259,0x8f8392,0xc3ad75][(i+row)%4],x-width*.43+i*width/8,y-.2+row*.36,z+.14);
  if(i%4===0)b.rotation.z=.09;
 }
}
function library(g,grown) {
 const floors=grown?3:1,width=grown?2.45:2.1,depth=1.65,top=.3+floors*1.05;
 box(g,width+.35,.18,depth+.3,color.stone,0,.19,0);
 for(let i=0;i<floors;i++){
  const y=.3+1.05*i;
  box(g,width,1.02,depth,color.cream,0,y+.51,0);box(g,width+.12,.075,depth+.08,color.timber,0,y+1.02,0);
  if(i===0){door(g,.6,depth/2+.025);bookshelf(g,-.47,y+.49,depth/2+.11,.86);}
  else for(const x of [-.75,0,.75])windowPane(g,x,y+.55,depth/2+.04,.4,.58);
  for(const z of [-.4,.4]){const wing=new THREE.Group();wing.rotation.y=Math.PI/2;wing.position.set(width/2+.02,y+.55,z);g.add(wing);windowPane(wing,0,0,0,.44,.5);}
 }
 roof(g,width+.35,depth+.35,top,0xaa6b46,.72);
 // A circular reading turret and an open book on the roof define its silhouette.
 const turretHeight=top+.3;
 cylinder(g,.49,.52,turretHeight,0xdfd7bc,-width/2-.16,turretHeight/2+.15,-.32,12);
 cylinder(g,0,.65,.72,0x9b6445,-width/2-.16,turretHeight+.49,-.32,12);
 windowPane(g,-width/2-.16,turretHeight-.35,.18,.28,.45);
 openBook(g,.15,top+.84,.2,.75);bar(g,[.15,top+.56,.2],[.15,top+.87,.2],.027,color.timber);
 stairs(g,.6,1.02,.85);bench(g,-1.35,1.35);
 for(let i=0;i<4;i++)book(g,-1.68+i*.16,1.35,[0xa49e65,0x8eaa9e,0xb78872,0xd0bc85][i]);
 openBook(g,-1.22,.48,1.4,.3);
 return top+1.05;
}
function gallery(g,grown) {
 const floors=grown?2:1,w=2.6,d=1.75,top=.25+floors*1.05;
 const steel=0x547b91,glass=0xaac5cb;
 box(g,w+.42,.18,d+.42,color.stone,0,.2,0);
 for(let i=0;i<floors;i++){
  const y=.3+i*1.05;
  box(g,w,.94,d,0xe0e6dc,0,y+.47,0);
  box(g,w-.2,.76,.06,glass,0,y+.47,d/2+.025,{roughness:.35});
  for(const x of [-w*.46,0,w*.46])box(g,.055,1,.12,steel,x,y+.49,d/2+.075);
  for(const side of [-1,1])bar(g,[side*w*.46,y+.02,d/2+.11],[0,y+.93,d/2+.11],.027,steel);
  box(g,w+.1,.09,d+.12,steel,0,y+.99,0);
 }
 // Exposed arch and truss roof, rather than a domestic pitched roof.
 for(const z of [-d/2-.03,d/2+.06]){
  mesh(g,new THREE.TorusGeometry(w/2,.055,6,24,Math.PI),steel,0,top-.05,z);
  bar(g,[-w/2,top-.05,z],[w/2,top-.05,z],.035,steel);
  for(let i=0;i<6;i++){const a=(i+.5)/6*Math.PI;bar(g,[Math.cos(a)*w/2,top-.05+Math.sin(a)*w/2,z],[Math.cos(a)*w/2,top-.05,z],.022,steel);}
 }
 for(const a of [Math.PI*.15,Math.PI*.35,Math.PI*.5,Math.PI*.65,Math.PI*.85])bar(g,[Math.cos(a)*w/2,top-.05+Math.sin(a)*w/2,-d/2],[Math.cos(a)*w/2,top-.05+Math.sin(a)*w/2,d/2],.023,steel);
 box(g,w*.8,.05,d*.97,0x98b6bd,0,top+.22,0,{transparent:true,opacity:.65,roughness:.4});
 box(g,1.55,.15,.7,0xd2d9cc,-.05,.2,d/2+.76);tinyBridge(g,-.05,d/2+.76);
 stairs(g,.95,d/2+.14,.62);
 const drawing=box(g,.48,.5,.055,0xf3f1de,-w/2-.18,.7,d/2+.26);drawing.rotation.z=.05;
 for(let i=0;i<3;i++)bar(g,[-w/2-.37,.55+i*.11,d/2+.3],[-w/2+.01,.55+i*.11,d/2+.3],.008,steel);
 return top+1.45;
}
function gear(p,x,y,z,r=.3) {
 const g=new THREE.Group();g.position.set(x,y,z);p.add(g);
 mesh(g,new THREE.TorusGeometry(r,.065,6,16),0x735e44);
 cylinder(g,.065,.065,.1,color.gold,0,0,.015,8).rotation.x=Math.PI/2;
 for(let i=0;i<12;i++){const a=i/12*Math.PI*2,b=box(g,.13,.12,.1,0x735e44,Math.sin(a)*(r+.03),Math.cos(a)*(r+.03),0);b.rotation.z=-a;}
 for(let i=0;i<3;i++){const a=i/3*Math.PI*2;bar(g,[0,0,0],[Math.sin(a)*r,Math.cos(a)*r,0],.028,0x735e44);}
}
function workshop(g,grown) {
 const w=grown?2.45:2.05,d=1.65,floors=grown?2:1,top=.28+floors*.95;
 const copper=0xb58a53;
 box(g,w+.38,.16,d+.38,color.stone,0,.19,0);
 for(let i=0;i<floors;i++){
  const y=.28+i*.95;box(g,w,.93,d,0xd9ba83,0,y+.46,0);
  if(i===0){box(g,.88,.76,.065,0x4d645d,-.28,y+.39,d/2+.04);box(g,.88,.085,.13,copper,-.28,y+.78,d/2+.07);for(let j=0;j<5;j++)box(g,.87,.012,.075,0xaab29a,-.28,y+.7-j*.04,d/2+.1);gear(g,.67,y+.47,d/2+.15,.25);}
  else for(const x of [-.65,0,.65])windowPane(g,x,y+.49,d/2+.03,.38,.46);
 }
 // Copper sawtooth roof, chimney, external crane and a visible gear.
 for(let i=0;i<3;i++){
  const bay=w/3+.035,shape=new THREE.Shape();shape.moveTo(-bay/2,0);shape.lineTo(-bay/2,.43);shape.lineTo(bay/2,0);shape.closePath();
  mesh(g,new THREE.ExtrudeGeometry(shape,{depth:d+.26,bevelEnabled:false}),copper,-w/2+(i+.5)*w/3,top,-d/2-.13);
  box(g,.035,.3,d*.72,0x9dbaa8,-w/2+i*w/3+.035,top+.21,0,{roughness:.4});
 }
 cylinder(g,.12,.15,top+.8,0x7a7261,w/2-.15,(top+.8)/2+.1,-.57,8);
 cylinder(g,.2,.2,.1,copper,w/2-.15,top+.93,-.57,8);
 const craneX=-w/2-.24;
 for(const z of [.1,.35])bar(g,[craneX,.15,z],[craneX,2.05,z],.03,0x6e7970);
 for(let i=0;i<5;i++)bar(g,[craneX,.2+i*.34,.1],[craneX,.5+i*.34,.35],.021,0x6e7970);
 bar(g,[craneX,2.05,.2],[craneX+1.25,2.05,.2],.044,copper);bar(g,[craneX,1.6,.2],[craneX+.7,2.05,.2],.025,color.frame);
 bar(g,[craneX+1.15,2.05,.2],[craneX+1.15,1.35,.2],.012,color.frame);cylinder(g,.12,.12,.22,color.stone,craneX+1.15,1.25,.2,6);
 const table=box(g,.78,.08,.52,color.timber,1.3,.54,1.12);for(const dx of [-.28,.28])bar(g,[1.3+dx,.13,1.12],[1.3+dx,.5,1.12],.035,color.frame);
 box(g,.58,.01,.37,0xb9d3c8,1.3,.585,1.12);for(let i=0;i<3;i++)box(g,.04,.016,.2,0x70867d,1.12+i*.12,.6,1.12);
 cylinder(g,.17,.17,.08,copper,.74,.35,1.45);bar(g,[.74,.14,1.45],[.74,.33,1.45],.04,color.frame);
 stairs(g,-.28,d/2+.14,.86);
 return Math.max(top+1.1,2.15);
}

export class IslandScene {
 constructor(canvas, callbacks, island=null, rules=null) {
  this.canvas=canvas;this.callbacks=callbacks;this.decorations=island?.decorations??[];this.decorationSlots=rules?.decorationSlots??{};this.layouts=island?.layouts??null;this.scenery=structuredClone(island?.scenery??{initial:{postoffice:null,trees:{}},grown:{postoffice:null,trees:{}}});this.layoutRules=rules;this.grown=false;this.arranging=false;this.paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.active=null;this.selectionRing=null;this.landmarks=new Map();this.sceneryObjects=new Map();this.paths=null;this.pathsDirty=false;this.buildings=new Map();this.heightMap=new Map();this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2();
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<760?1.4:1.75));
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
  this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
  this.scene=new THREE.Scene();this.scene.fog=new THREE.Fog(0xe9eee9,45,95);
  this.camera=new THREE.OrthographicCamera(-10,10,10,-10,.1,130);this.camera.position.set(15,12,18);
  this.controls=new OrbitControls(this.camera,canvas);this.controls.target.set(.5,-.3,0);this.controls.enablePan=false;this.controls.enableDamping=true;this.controls.dampingFactor=.08;
  this.controls.minPolarAngle=.48;this.controls.maxPolarAngle=1.28;this.controls.minZoom=.65;this.controls.maxZoom=1.85;this.controls.rotateSpeed=.55;
  this.hemi=new THREE.HemisphereLight(0xfff5de,0x93a899,2.7);this.scene.add(this.hemi);
  this.sun=new THREE.DirectionalLight(0xffe8c0,3.4);this.sun.position.set(-9,16,8);this.sun.castShadow=true;
  const shadowSize=canvas.clientWidth<760?1024:2048;this.sun.shadow.mapSize.set(shadowSize,shadowSize);this.sun.shadow.camera.left=-17;this.sun.shadow.camera.right=17;this.sun.shadow.camera.top=17;this.sun.shadow.camera.bottom=-17;
  this.sun.shadow.camera.near=.1;this.sun.shadow.camera.far=50;this.sun.shadow.normalBias=.025;this.sun.shadow.bias=-.0005;this.sun.shadow.radius=3;this.scene.add(this.sun);
  this.fill=new THREE.DirectionalLight(0xdde9e4,.8);this.fill.position.set(8,4,-9);this.scene.add(this.fill);
  this.world=new THREE.Group();this.scene.add(this.world);this.dirty=true;this.lastRender=0;
  this.build(island?.phase==='grown');this.resize(true);
  this.controls.addEventListener('change',()=>{this.dirty=true;});
  this.bindPointers();
  this.onResize=()=>this.resize();window.addEventListener('resize',this.onResize);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.contextLost=true;callbacks.unavailable();});
  this.start=performance.now();this.animate=this.animate.bind(this);requestAnimationFrame(this.animate);
 }
 build(grown) {
  for(const child of [...this.world.children]){child.traverse(o=>{if(o.isMesh){o.geometry.dispose();if(![...mats.values()].includes(o.material)){o.material.map?.dispose();o.material.dispose();}}});this.world.remove(child);}
  this.grown=grown;this.landmarks.clear();this.sceneryObjects.clear();this.paths=null;this.buildings.clear();this.heightMap.clear();this.selectionRing=null;
  rockIsland(this.world,(grown?7.2:6.1)*LAND_SPREAD);
  if(grown){rockIsland(this.world,2.55*LAND_SPREAD,9*LAND_SPREAD,.5*LAND_SPREAD,.95);bridge(this.world,6.45*LAND_SPREAD,.5*LAND_SPREAD,3.2*LAND_SPREAD);rockIsland(this.world,.8*LAND_SPREAD,-6.9*LAND_SPREAD,-4.2*LAND_SPREAD,.9);}
  const defaultPositions=grown?{library:[-2.5,1.55],projects:[9,.35],workshop:[.2,-2.3]}:{library:[-2.05,1.25],projects:[2.55,1.2],workshop:[-.1,-2.15]};
  const phase=grown?'grown':'initial',stored=this.layouts?.[phase]||{},scenery=this.scenery[phase]??{postoffice:null,trees:{}};
  for(const [id,position] of Object.entries(defaultPositions)){
   const g=new THREE.Group();g.userData.building=id;g.position.set(position[0]*LAND_SPREAD,.1,position[1]*LAND_SPREAD);
   const p=stored[id];if(Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&this.inBounds(id,p[0],p[1]))g.position.set(p[0]*LAND_SPREAD,.1,p[1]*LAND_SPREAD);
   this.world.add(g);this.buildings.set(id,g);
   const height=({library,gallery,workshop}[id==='projects'?'gallery':id])(g,grown);this.heightMap.set(id,height);
  }
  // Front shore first: the former terrace position covered the library entrance.
  const candidates=[[2.2,3.95],[1.7,4.12],[-2.8,3.6],[-4.4,1.15],[4.3,1.5]].map(spread);
  const footprints=[...this.buildings.values()].map(g=>new THREE.Box3().setFromObject(g));
  const clearance=([x,z])=>Math.min(...footprints.map(b=>Math.hypot(Math.max(b.min.x-x,0,x-b.max.x),Math.max(b.min.z-z,0,z-b.max.z))));
  const spot=candidates.find(p=>clearance(p)>.55)||[...candidates].sort((a,b)=>clearance(b)-clearance(a))[0];
  const keeper=new THREE.Group();keeper.position.set(spot[0],.1,spot[1]);keeper.userData.building='about';this.world.add(keeper);this.heightMap.set('about',keeperNotebook(keeper));this.landmarks.set('about',keeper);
  const postalCandidates=[[-2.6,4.3],[3.9,3.3],[-4.45,2.4],[-4.5,-.6]].map(spread);
  const postalClearance=p=>Math.min(clearance(p),Math.hypot(p[0]-spot[0],p[1]-spot[1])-1.1);
  const postalDefault=postalCandidates.find(p=>postalClearance(p)>.8)||[...postalCandidates].sort((a,b)=>postalClearance(b)-postalClearance(a))[0];
  const postalSpot=Array.isArray(scenery.postoffice)&&this.inBounds('postoffice',...scenery.postoffice)?spread(scenery.postoffice):postalDefault;
  const mailbox=new THREE.Group();mailbox.position.set(postalSpot[0],.1,postalSpot[1]);mailbox.scale.setScalar(.65);mailbox.userData.building='postoffice';this.world.add(mailbox);this.heightMap.set('postoffice',postBox(mailbox));this.landmarks.set('postoffice',mailbox);this.sceneryObjects.set('postoffice',mailbox);mailbox.userData.editable='postoffice';
  const nature=new THREE.Group();this.world.add(nature);
  const trees=[[-4,-1.8,1.8],[-4.45,.2,1.2],[-3.55,-3.2,2],[-2.4,-3.5,1.1],[1.55,-3.55,1.5],[3.15,-2.9,1.9],[4.3,-.3,1.45],[3.85,2.65,1.1],[-3.8,2.6,1.2],[-.4,3.1,.9]];
  if(grown)trees.push([5.3,-1.2,1.7],[6,1.9,1.2],[8.25,-1.25,1.3],[10.4,-.6,1.25]);
  trees.forEach(([x,z,h],i)=>{const id='tree-'+i,p=scenery.trees?.[id]??[x,z];const g=tree(nature,p[0]*LAND_SPREAD,p[1]*LAND_SPREAD,h,i%3===0?1:0);g.userData.editable=id;this.sceneryObjects.set(id,g);});
  for(let i=0;i<15;i++){
   const a=i*2.399;const r=3.0+(i%3)*.35,x=Math.cos(a)*r,z=Math.sin(a)*r*.86;
   const pebble=mesh(nature,new THREE.IcosahedronGeometry(.13+(i%3)*.03,0),i%2?0xc6c2ae:0x96aa8c,x*LAND_SPREAD,.13,z*LAND_SPREAD);pebble.scale.y=.6;
  }

  // Quiet pond and a terrace at the island edge.
  const pond=mesh(nature,new THREE.CircleGeometry(.7,12),color.water,-.1*LAND_SPREAD,.115,3.25*LAND_SPREAD,{roughness:.55});pond.rotation.x=-Math.PI/2;pond.scale.set(1.6,.85,1);
  for(let i=0;i<8;i++){const a=i/8*Math.PI*2;const p=mesh(nature,new THREE.IcosahedronGeometry(.12,0),color.stone,-.1*LAND_SPREAD+Math.cos(a)*1.08,.16,3.25*LAND_SPREAD+Math.sin(a)*.6);p.scale.set(1.3,.55,1);}
  for(const [make,x,z] of [[bench,1.32,3.5],[lamp,-.65,1.8],[lamp,2.9,2.8]]){const item=new THREE.Group();item.position.set(x*LAND_SPREAD,0,z*LAND_SPREAD);nature.add(item);make(item,0,0);}
  const terrace=new THREE.Group();terrace.position.set(-1.6*LAND_SPREAD,.15,3.5*LAND_SPREAD);nature.add(terrace);
  box(terrace,1.1,.1,.85,color.timber);for(let i=0;i<7;i++)box(terrace,.055,.02,.82,color.path,-.5+i*.15,.065,0);
  for(const x of [-.47,.47]){bar(terrace,[x,.1,-.35],[x,.6,-.35],.025,color.frame);bar(terrace,[x,.1,.35],[x,.6,.35],.025,color.frame);}bar(terrace,[-.47,.6,.35],[.47,.6,.35],.025,color.frame);
  for(const item of this.decorations){const point=this.decorationSlots[item.slot]?.point;if(!point)continue;const id='decoration-'+item.slot;const [x,z]=spread(item.type==='tree'?(scenery.trees?.[id]??point):point);if([...this.buildings.values()].some(g=>Math.hypot(g.position.x-x,g.position.z-z)<1.4)||Math.hypot(keeper.position.x-x,keeper.position.z-z)<1.05||Math.hypot(mailbox.position.x-x,mailbox.position.z-z)<.95)continue;const group=new THREE.Group();group.userData.decoration=item.slot;group.position.set(x,0,z);nature.add(group);({tree:(p,x,z)=>tree(p,x,z,1.35,1),bench,lamp}[item.type])?.(group,0,0);if(item.type==='tree'){group.userData.editable=id;this.sceneryObjects.set(id,group);}}
  this.pathsDirty=true;this.rebuildPaths();
  this.canvas.dataset.decorations=String(this.decorations.length);this.clouds=[];
  for(const [cx,cy,cz,size] of [[-8,-1.8,1.8,1.2],[4,-3.2,6.6,1.15],[9,-1.6,-4.3,1],[-1,-4,-6,1.3]]){
   const g=new THREE.Group();g.position.set(cx*LAND_SPREAD,cy,cz*LAND_SPREAD);this.world.add(g);this.clouds.push(g);
   for(let i=0;i<5;i++){const o=mesh(g,new THREE.IcosahedronGeometry(size*(.55+(i%3)*.15),1),0xf5f6eb,(i-2)*size*.65,Math.sin(i*1.9)*.13,Math.cos(i)*.15,{transparent:true,opacity:.57,depthWrite:false});o.scale.set(1.6,.65,1);o.castShadow=false;o.receiveShadow=false;}
  }
  this.dirty=true;this.select(this.active,false);
 }
 editable(id){return this.buildings.get(id)||this.sceneryObjects.get(id);}
 canMove(id,x,z){
  if(!this.inBounds(id,x,z))return false;const pos=spread([x,z]),g=this.editable(id),building=this.buildings.has(id);
  for(const [other,obj] of this.buildings){if(other===id)continue;if(building){if(Math.hypot(obj.position.x-pos[0],obj.position.z-pos[1])<(this.layoutRules?.minDistance??2.15)*LAND_SPREAD)return false;}else{if(Math.hypot(obj.position.x-pos[0],obj.position.z-pos[1])<1.05*LAND_SPREAD)return false;const b=new THREE.Box3().setFromObject(obj);if(pos[0]>b.min.x-.32&&pos[0]<b.max.x+.32&&pos[1]>b.min.z-.32&&pos[1]<b.max.z+.32)return false;}}
  const proposed=building?new THREE.Box3().setFromObject(g):null;if(proposed)proposed.translate(new THREE.Vector3(pos[0]-g.position.x,0,pos[1]-g.position.z));
  for(const [other,obj] of [...this.sceneryObjects,...[...this.landmarks].filter(([key])=>key==='about')]){if(other===id)continue;if(building){if(Math.hypot(obj.position.x-pos[0],obj.position.z-pos[1])<1.05*LAND_SPREAD)return false;if(obj.position.x>proposed.min.x-.25&&obj.position.x<proposed.max.x+.25&&obj.position.z>proposed.min.z-.25&&obj.position.z<proposed.max.z+.25)return false;}else if(Math.hypot(obj.position.x-pos[0],obj.position.z-pos[1])<.5*LAND_SPREAD)return false;}
  return true;
 }
 saveScenery(id){const phase=this.grown?'grown':'initial';this.scenery[phase]??={postoffice:null,trees:{}};const g=this.sceneryObjects.get(id),point=[Number((g.position.x/LAND_SPREAD).toFixed(6)),Number((g.position.z/LAND_SPREAD).toFixed(6))];if(id==='postoffice')this.scenery[phase].postoffice=point;else{this.scenery[phase].trees??={};this.scenery[phase].trees[id]=point;}this.callbacks.scenery?.(phase,structuredClone(this.scenery[phase]));}
 rebuildPaths(){
  if(this.paths){this.paths.traverse(o=>{if(o.isMesh)o.geometry.dispose();});this.world.remove(this.paths);}this.paths=new THREE.Group();this.world.add(this.paths);this.pathsDirty=false;
  const boxes=[...this.buildings.values()].map(g=>new THREE.Box3().setFromObject(g)),trees=[...this.sceneryObjects].filter(([id])=>id!=='postoffice').map(([,g])=>[g.position.x,g.position.z]);const blocked=([x,z])=>boxes.some(b=>x>b.min.x-.12&&x<b.max.x+.12&&z>b.min.z-.12&&z<b.max.z+.12)||trees.some(p=>Math.hypot(x-p[0],z-p[1])<.28);
  const inside=([x,z])=>this.inBounds('postoffice',x/LAND_SPREAD,z/LAND_SPREAD)||(this.grown&&(((x/LAND_SPREAD-9)/2.45)**2+((z/LAND_SPREAD-.5)/2.32)**2<=1||x>=4.85*LAND_SPREAD&&x<=8.05*LAND_SPREAD&&Math.abs(z-.5*LAND_SPREAD)<.48));
  const drawn=new Set(),draw=(points,width)=>{for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],distance=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.max(1,Math.ceil(distance/.44));for(let j=0;j<count;j++){const t=j/count,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,key=x.toFixed(3)+','+z.toFixed(3);if(drawn.has(key))continue;drawn.add(key);const stone=box(this.paths,width,.045,.32,color.path,x,.13,z);stone.rotation.y=Math.atan2(b[0]-a[0],b[1]-a[1]);}}if(points.length){const [x,z]=points.at(-1);const key=x.toFixed(3)+','+z.toFixed(3);if(!drawn.has(key)){drawn.add(key);box(this.paths,width,.045,.32,color.path,x,.13,z);}}};
  const hub=[[-.2,1.4],[0,0],[1.2,.1],[-1.2,.3]].map(spread).find(p=>!blocked(p))??spread([0,0]);const ends={};
  const connect=(id,g,offset,approach,start=hub)=>{const end=[g.position.x+offset[0],g.position.z+offset[1]],front=[end[0],end[1]+approach],points=routePath(start,front,{inside,blocked});if(points.length)draw([...points,end],id==='postoffice'?.35:.44);ends[id]={point:end,connected:points.length>0};};
  for(const [id,offset] of [['library',[.6,1.55]],['projects',[.95,1.55]],['workshop',[-.28,1.5]]])connect(id,this.buildings.get(id),offset,.5,this.grown&&id==='projects'?spread([8.05,.5]):hub);
  connect('postoffice',this.landmarks.get('postoffice'),[0,.42],.42);
  if(this.grown){const p=routePath(hub,spread([4.95,.5]),{inside,blocked});draw(p,.44);}
  this.canvas.dataset.pathEndpoints=JSON.stringify(ends);
 }
 inBounds(id,x,z) {
  if(!Number.isFinite(x)||!Number.isFinite(z))return false;
  if(id==='postoffice'||id.startsWith('tree-')||id.startsWith('decoration-')){const r=this.layoutRules?.scenery?.[this.grown?'grown':'initial']??{radius:this.grown?6.8:5.8,ellipse:.83,satellite:this.grown?{center:[9,.5],radius:[2.2,2.1]}:null};return (x/r.radius)**2+(z/(r.radius*r.ellipse))**2<=1||Boolean(r.satellite&&((x-r.satellite.center[0])/r.satellite.radius[0])**2+((z-r.satellite.center[1])/r.satellite.radius[1])**2<=1);}
  const rules=this.layoutRules?.[this.grown?'grown':'initial'],area=rules?.[id];
  if(area)return ((x-area.center[0])/area.radius[0])**2+((z-area.center[1])/area.radius[1])**2<=1;
  if(this.grown&&id==='projects')return ((x-9)/1.0)**2+((z-.5)/1.1)**2<=1;
  const r=rules?.radius??(this.grown?5.55:4.65);return (x/r)**2+(z/(r*(rules?.ellipse??.79)))**2<=1;
 }
 select(id,notify=true) {
  if(!this.buildings.has(id)&&!this.landmarks.has(id)&&!this.sceneryObjects.has(id))id=null;
  this.active=id;if(this.selectionRing){this.world.remove(this.selectionRing);this.selectionRing.geometry.dispose();this.selectionRing.material.dispose();}
  this.selectionRing=null;
  if(id){const g=this.editable(id)||this.landmarks.get(id),radius=this.sceneryObjects.has(id)&&id!=='postoffice'?.48:id==='postoffice'?.69*g.scale.x:this.landmarks.has(id)?.69:1.66;const ring=new THREE.Mesh(new THREE.RingGeometry(radius,radius+.04,40),new THREE.MeshBasicMaterial({color:0xf2e7b9,transparent:true,opacity:.82,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.set(g.position.x,.125,g.position.z);this.world.add(ring);this.selectionRing=ring;}
  this.dirty=true;if(notify)this.callbacks.select(id);
 }
 getLayout(){return Object.fromEntries([...this.buildings].map(([id,g])=>[id,[Number((g.position.x/LAND_SPREAD).toFixed(6)),Number((g.position.z/LAND_SPREAD).toFixed(6))]]));}
 saveLayout(){const phase=this.grown?'grown':'initial',layout=this.getLayout();if(this.layouts)this.layouts[phase]=layout;this.callbacks.layout?.(phase,layout);this.dirty=true;}
 resetLayout(){const phase=this.grown?'grown':'initial';this.scenery[phase]={postoffice:null,trees:{}};if(this.layouts)this.layouts[phase]=structuredClone(this.layoutRules?.defaults?.[phase]||{});this.build(this.grown);this.callbacks.layout?.(phase,this.getLayout());this.callbacks.scenery?.(phase,structuredClone(this.scenery[phase]));}
 updateIsland(value){this.scenery=structuredClone(value.scenery??{initial:{postoffice:null,trees:{}},grown:{postoffice:null,trees:{}}});this.decorations=value.decorations??[];this.layouts=structuredClone(value.layouts);this.build(value.phase==='grown');this.resize(true);this.setLight(value.lighting==='dusk');}
 setGrowth(grown){this.build(grown);this.resize(true);}
 setArrange(value){this.arranging=value;this.canvas.style.cursor=value?'grab':'default';this.dirty=true;}
 setLight(dusk){
  this.dusk=dusk;this.hemi.color.set(dusk?0xbdc9e5:0xfff5de);this.hemi.groundColor.set(dusk?0x789485:0x93a899);this.hemi.intensity=dusk?1.9:2.7;
  this.sun.color.set(dusk?0xeac092:0xffe8c0);this.sun.intensity=dusk?1.75:3.4;this.fill.intensity=dusk?.65:.8;
  this.scene.fog.color.set(dusk?0xa7b4b4:0xe9eee9);this.renderer.toneMappingExposure=dusk?.9:1.12;
  for(const m of windows)m.emissiveIntensity=dusk?.9:.08;this.dirty=true;
 }
 setPaused(value){this.paused=value;if(value){this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=true;}this.dirty=true;}
 setVisible(value){this.suspended=!value;this.controls.enabled=value;this.dirty=true;}
 resize(reset=false) {
  const width=this.canvas.clientWidth,height=this.canvas.clientHeight,mobile=width<760;if(!width||!height)return;
  const vertical=this.callbacks.centered?(this.grown?26:20)/(width/height):mobile?(this.grown?26:19.5)/(width/height):this.grown?24:19.5;
  this.camera.left=-vertical*width/height/2;this.camera.right=vertical*width/height/2;this.camera.top=vertical/2;this.camera.bottom=-vertical/2;
  this.camera.setViewOffset(width,height,this.callbacks.centered?0:mobile?0:-width*.12,this.callbacks.centered?0:mobile?-height*.07:height*.015,width,height);
  if(reset){this.camera.zoom=1;this.controls.target.set((this.grown?2:-.1)*LAND_SPREAD,-.3,0);}
  this.camera.updateProjectionMatrix();this.renderer.setSize(width,height,false);this.dirty=true;
 }
 resetView(){this.camera.position.set(15,12,18);this.camera.zoom=1;this.controls.target.set((this.grown?2:-.1)*LAND_SPREAD,-.3,0);this.camera.updateProjectionMatrix();this.controls.update();this.dirty=true;}
 pick(event) {
  const bounds=this.canvas.getBoundingClientRect();this.pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);
  for(const hit of this.ray.intersectObjects([...this.buildings.values(),...(this.arranging?this.sceneryObjects.values():!this.callbacks.centered?this.landmarks.values():[])],true)){let o=hit.object;while(o&&!o.userData.building&&!o.userData.editable)o=o.parent;if(o)return o.userData.editable||o.userData.building;}return null;
 }
 bindPointers() {
  this.canvas.addEventListener('pointerdown',event=>{
   this.down={x:event.clientX,y:event.clientY,id:event.pointerId};if(this.arranging){const id=this.pick(event);if(id){
    const hit=new THREE.Vector3(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-(this.world.position.y+.1));
    this.dragOffset=this.ray.ray.intersectPlane(plane,hit)?this.world.worldToLocal(hit).sub(this.editable(id).position):new THREE.Vector3();
    this.drag=id;this.dragChanged=false;this.select(id);this.controls.enabled=false;this.canvas.setPointerCapture(event.pointerId);this.canvas.style.cursor='grabbing';
   }}
  });
  this.canvas.addEventListener('pointermove',event=>{
   if(this.drag){
    this.pick(event);const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-(this.world.position.y+.1));const hit=new THREE.Vector3();
    if(this.ray.ray.intersectPlane(plane,hit)){
     const local=this.world.worldToLocal(hit).sub(this.dragOffset);const x=Math.round(local.x/LAND_SPREAD*4)/4,z=Math.round(local.z/LAND_SPREAD*4)/4;const worldX=x*LAND_SPREAD,worldZ=z*LAND_SPREAD;
     if(this.canMove(this.drag,x,z)){const g=this.editable(this.drag);if(g.position.x!==worldX||g.position.z!==worldZ){this.dragChanged=true;g.position.set(worldX,g.position.y,worldZ);if(this.selectionRing)this.selectionRing.position.set(worldX,.125,worldZ);this.pathsDirty=true;this.dirty=true;}}
    }return;
   }
   if(event.pointerType==='mouse'){const id=this.pick(event);this.canvas.style.cursor=id?(this.arranging?'grab':'pointer'):'default';}
  });
  const end=event=>{
   if(this.drag){const id=this.drag;this.drag=null;this.controls.enabled=true;this.canvas.style.cursor=this.arranging?'grab':'default';this.rebuildPaths();if(this.dragChanged){if(this.buildings.has(id))this.saveLayout();else this.saveScenery(id);}}
   else if(this.down&&Math.hypot(event.clientX-this.down.x,event.clientY-this.down.y)<7){const id=this.pick(event);if(id)this.select(id);}
   this.down=null;
  };
  this.canvas.addEventListener('pointerup',end);this.canvas.addEventListener('pointercancel',()=>{if(this.drag){const id=this.drag;this.drag=null;this.rebuildPaths();if(this.dragChanged){if(this.buildings.has(id))this.saveLayout();else this.saveScenery(id);}}this.down=null;this.controls.enabled=true;});
  this.canvas.addEventListener('keydown',event=>{if(event.key==='Escape')this.select(null);if(event.key==='Home'){event.preventDefault();this.resetView();}});
 }
 animate(now) {
  if(this.contextLost)return;
  requestAnimationFrame(this.animate);
  if(document.hidden||this.suspended||now-this.lastRender<1000/30)return;
  const controlsChanged=this.controls.update();
  if(!this.paused){const t=(now-this.start)/1000;this.world.position.y=Math.sin(t*.48)*.10;for(let i=0;i<this.clouds.length;i++)this.clouds[i].position.x+=Math.sin(t*.15+i)*.0006;this.dirty=true;}
  if(!this.dirty&&!controlsChanged)return;
  this.lastRender=now;this.scene.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);
  if(this.pathsDirty)this.rebuildPaths();this.renderer.render(this.scene,this.camera);this.dirty=false;
  const bounds=this.canvas.getBoundingClientRect();
  const positions={};for(const [id,g] of [...this.buildings,...(!this.callbacks.centered?this.landmarks:[...this.landmarks].filter(([id])=>id==='postoffice'))]){
   const pos=g.localToWorld(new THREE.Vector3(0,this.heightMap.get(id)+.35,0)).project(this.camera);
   positions[id]={x:(pos.x+1)/2*bounds.width,y:(1-pos.y)/2*bounds.height,visible:pos.z>-1&&pos.z<1&&Math.abs(pos.x)<1&&Math.abs(pos.y)<1};
  }
  const postoffice=this.landmarks.get('postoffice');if(postoffice){const hit=postoffice.localToWorld(new THREE.Vector3(0,1.12,.3)).project(this.camera);this.canvas.dataset.postofficeHitPoint=JSON.stringify({x:(hit.x+1)/2*bounds.width,y:(1-hit.y)/2*bounds.height});}
  const keeper=this.landmarks.get('about');if(keeper){const hit=keeper.localToWorld(new THREE.Vector3(0,.54,.04)).project(this.camera);this.canvas.dataset.aboutHitPoint=JSON.stringify({x:(hit.x+1)/2*bounds.width,y:(1-hit.y)/2*bounds.height});}this.callbacks.labels(positions);
  this.canvas.dataset.layout=JSON.stringify(this.getLayout());this.canvas.dataset.ready='true';this.canvas.dataset.growth=this.grown?'grown':'initial';this.canvas.dataset.frames=String((Number(this.canvas.dataset.frames)||0)+1);
 }
}
