import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Keep movable buildings/trees as separate roots. Only their static contents
// are merged, so picking, bounds, dragging and layout serialization stay intact.
export function batchStaticMeshes(root,{exclude=new Set()}={}) {
 const buckets=new Map(),inverse=new THREE.Matrix4(),matrix=new THREE.Matrix4();
 root.updateWorldMatrix(true,true);inverse.copy(root.matrixWorld).invert();
 function visit(object){
  if(!object.visible||exclude.has(object))return;
  if(object.isMesh&&!object.isInstancedMesh&&!Array.isArray(object.material)&&!object.material.transparent&&!object.morphTargetInfluences){
   const signature=Object.entries(object.geometry.attributes).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join('|');
   const key=[object.material.uuid,object.castShadow,object.receiveShadow,object.renderOrder,object.layers.mask,signature].join(':');
   if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(object);
  }
  for(const child of object.children)visit(child);
 }
 visit(root);
 for(const meshes of buckets.values()){
  if(meshes.length<2)continue;
  const parts=meshes.map(mesh=>{
   const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
   matrix.multiplyMatrices(inverse,mesh.matrixWorld);geometry.applyMatrix4(matrix);return geometry;
  });
  const geometry=mergeGeometries(parts,false);for(const part of parts)part.dispose();
  if(!geometry)continue;
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const first=meshes[0],batch=new THREE.Mesh(geometry,first.material);
  batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;batch.renderOrder=first.renderOrder;batch.layers.mask=first.layers.mask;
  batch.name='static-batch';root.add(batch);
  const released=new Set();for(const mesh of meshes){mesh.removeFromParent();if(!released.has(mesh.geometry)){released.add(mesh.geometry);mesh.geometry.dispose();}}
 }
}

// Bound actual canvas pixels as well as DPR. Downshift only after sustained
// slow *active* frames; reading, a hidden tab and idle gaps are not samples.
export function createRenderQuality({dpr=1,mobile=false,saveData=false}={}) {
 const base=Math.min(dpr,mobile?1.25:1.5,saveData?1:Infinity),budget=mobile?900000:2000000;
 let level=0,duration=0,frames=0;
 return {
  ratio(width,height){return Math.min(dpr,Math.max(Math.min(dpr,mobile?.75:1),base*.8**level),Math.sqrt(budget/Math.max(1,width*height)));},
  sample(ms){
   if(!Number.isFinite(ms)||ms<=0)return false;
   duration+=Math.min(ms,250);frames++;
   if(duration<3000)return false;
   const slow=duration/frames>50;duration=frames=0;
   if(slow&&level<2){level++;return true;}return false;
  },
  reset(){duration=frames=0;},
  get level(){return level;}
 };
}
