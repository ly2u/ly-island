import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {batchStaticMeshes,createRenderQuality} from '../src/scene-performance.js';

const bounds=root=>new THREE.Box3().setFromObject(root);
const close=(a,b)=>assert.ok(a.distanceTo(b)<1e-5,`${a.toArray()} != ${b.toArray()}`);
const material=new THREE.MeshStandardMaterial({color:0x987654});
function box(parent,x){const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);mesh.position.x=x;parent.add(mesh);return mesh;}

test('batching preserves world bounds, triangle count and picking through nested transforms',()=>{
 const world=new THREE.Group(),building=new THREE.Group(),shelf=new THREE.Group();
 world.position.set(8,.1,-3);world.rotation.y=.4;world.add(building);building.position.set(2,1,4);building.rotation.y=.7;building.userData.building='library';building.add(shelf);shelf.scale.set(.7,1.5,1);
 box(shelf,-1);box(shelf,1);const before=bounds(world),hitPoint=shelf.localToWorld(new THREE.Vector3(-1,0,0));
 batchStaticMeshes(building);assert.equal(building.children.filter(x=>x.isMesh).length,1);
 const batch=building.children.find(x=>x.isMesh);assert.equal(batch.geometry.attributes.position.count/3,24);
 const after=bounds(world);close(before.min,after.min);close(before.max,after.max);
 world.updateMatrixWorld(true);
 const ray=new THREE.Raycaster(hitPoint.clone().add(new THREE.Vector3(0,10,0)),new THREE.Vector3(0,-1,0));
 assert.equal(ray.intersectObject(building,true)[0].object.parent.userData.building,'library');
});

test('editable roots move independently after batching; transparent and hidden meshes are retained',()=>{
 const world=new THREE.Group(),tree=new THREE.Group(),house=new THREE.Group();world.add(tree,house);house.position.x=10;
 box(tree,0);box(tree,1);box(house,0);box(house,1);box(world,-5);box(world,-6);
 const glass=box(world,4);glass.material=new THREE.MeshBasicMaterial({transparent:true,opacity:.5});
 const hidden=box(world,5);hidden.visible=false;
 batchStaticMeshes(tree);batchStaticMeshes(house);batchStaticMeshes(world,{exclude:new Set([tree,house])});
 const oldHouse=bounds(house);tree.position.z=3;world.updateMatrixWorld(true);
 close(oldHouse.min,bounds(house).min);assert.equal(bounds(tree).min.z,2.5);
 assert.equal(glass.parent,world);assert.equal(hidden.parent,world);assert.equal(hidden.visible,false);
 assert.equal(tree.parent,world);assert.equal(house.parent,world);
});

test('batches preserve separate shadow, material and layer behavior',()=>{
 const root=new THREE.Group();for(let i=0;i<4;i++){const m=box(root,i);m.castShadow=i<2;m.receiveShadow=true;}
 batchStaticMeshes(root);const meshes=root.children.filter(x=>x.isMesh);assert.equal(meshes.length,2);
 assert.deepEqual(meshes.map(m=>m.castShadow).sort(),[false,true]);assert.ok(meshes.every(m=>m.receiveShadow&&m.material===material));
});

test('DPR and pixel budget cap retina phone and 4K canvases without raising a low-DPR screen',()=>{
 const phone=createRenderQuality({dpr:3,mobile:true});assert.equal(phone.ratio(390,844),1.25);
 const desktop=createRenderQuality({dpr:3});assert.ok(3840*2160*desktop.ratio(3840,2160)**2<=2000000.01);
 assert.equal(createRenderQuality({dpr:.7,mobile:true}).ratio(390,844),.7);
 assert.equal(createRenderQuality({dpr:3,saveData:true}).ratio(800,600),1);
});

test('sustained slow active frames lower quality at most twice; stable 30 fps does not',()=>{
 const slow=createRenderQuality({dpr:2,mobile:true});for(let i=0;i<100;i++)slow.sample(100);
 assert.equal(slow.level,2);assert.ok(slow.ratio(390,844)<1.25);assert.ok(slow.ratio(390,844)>=.75);
 const normal=createRenderQuality({dpr:2,mobile:true});for(let i=0;i<300;i++)normal.sample(1000/30);assert.equal(normal.level,0);
});

test('idle/hidden resets do not combine isolated slow frames into a downshift',()=>{
 const quality=createRenderQuality({dpr:2});for(let i=0;i<20;i++)quality.sample(100);quality.reset();for(let i=0;i<20;i++)quality.sample(100);
 assert.equal(quality.level,0);
});
