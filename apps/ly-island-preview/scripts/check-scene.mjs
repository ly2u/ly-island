import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {batchStaticMeshes,createRenderQuality} from '../src/scene-performance.js';
import {SceneFocus,readingFrame} from '../src/scene-focus.js';
import {IslandScene} from '../src/scene.js';

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

function cameraFixture(){
 const camera=new THREE.OrthographicCamera(-16,16,10,-10,.1,130);camera.position.set(13,11,17);camera.zoom=1.2;
 const controls={target:new THREE.Vector3(2,.3,-1),enableDamping:true,update(){camera.lookAt(this.target);}};
 const focus=new SceneFocus(camera,controls);focus.viewport(1280,800,{x:-.12,y:.015});controls.update();
 return {camera,controls,focus};
}
test('reading focus keeps geometry stationary and restores the exact previous orbit and zoom',()=>{
 const {camera,controls,focus}=cameraFixture(),before=focus.snapshot(),target=[-3,2,1];
 focus.focus(target,readingFrame(1280),{now:0});assert.equal(focus.step(210),true);assert.notEqual(camera.zoom,before.zoom);
 focus.step(420);close(controls.target,new THREE.Vector3(...target));assert.equal(camera.zoom,1.65);
 const projected=new THREE.Vector3(...target).project(camera);assert.ok(Math.abs((projected.x+1)*640-168)<.001,'subject stays in the visible shore');
 focus.restore({now:500});focus.step(920);assert.equal(focus.home,null);assert.equal(focus.step(950),false);
 close(camera.position,new THREE.Vector3(...before.position));close(controls.target,new THREE.Vector3(...before.target));assert.equal(camera.zoom,before.zoom);
 assert.deepEqual(focus.snapshot().offset,before.offset);
});
test('rapid room changes and interrupted return retain the original home view',()=>{
 const {focus}=cameraFixture(),before=focus.snapshot();
 focus.focus([3,2,1],readingFrame(1280),{now:0});focus.step(100);
 focus.focus([-5,1,2],readingFrame(1280),{now:110});focus.step(220);
 focus.restore({now:230});focus.step(300);
 focus.focus([0,1,-4],readingFrame(1280),{now:310});focus.step(730);
 focus.restore({now:740});focus.step(1160);assert.deepEqual(focus.snapshot(),before);
});
test('responsive framing and reduced-motion transitions finish immediately without rendering forever',()=>{
 const {focus,camera}=cameraFixture(),before=focus.snapshot();
 assert.equal(readingFrame(1099),null);
 focus.focus([3,1,2],readingFrame(1280),{immediate:true,now:0});assert.equal(focus.transition,null);
 focus.viewport(390,844,{x:0,y:-.07});focus.restore({immediate:true,now:1});assert.equal(focus.transition,null);assert.equal(focus.home,null);
 assert.deepEqual(focus.snapshot().position,before.position);assert.equal(camera.view.fullWidth,390);assert.deepEqual(focus.snapshot().offset,{x:0,y:-.07});
 focus.viewport(1600,900,{x:-.12,y:.015});focus.focus([3,1,2],readingFrame(1600),{immediate:true});
 const target=new THREE.Vector3(3,1,2).project(camera);assert.ok(Math.abs((target.x+1)*800-268)<.001);
 focus.restore({immediate:true});assert.equal(focus.step(99999),false);
});

test('preview view capture and return keep the original orbit after preview rotation',()=>{
 const {camera,controls,focus}=cameraFixture();const scene={camera,controls,focus,focusId:null,dirty:false};
 const before=IslandScene.prototype.captureView.call(scene);camera.position.set(-5,8,20);controls.target.set(8,1,0);camera.zoom=1.7;controls.update();
 IslandScene.prototype.restoreView.call(scene,before);close(camera.position,new THREE.Vector3(...before.position));close(controls.target,new THREE.Vector3(...before.target));assert.equal(camera.zoom,before.zoom);assert.equal(focus.transition,null);assert.equal(scene.dirty,true);
});

import {initialVisit,interactionHint} from '../src/visit-policy.mjs';
test('explicit view choice wins; unknown or limited hardware never forces every phone into reading mode',()=>{
 assert.equal(initialVisit({savedView:'3d',saveData:true,coarse:true,memory:1,cores:1}).reading,false);
 assert.equal(initialVisit({savedView:'reading'}).reading,true);
 assert.equal(initialVisit({saveData:true}).reading,true);
 assert.equal(initialVisit({coarse:true,memory:2}).reading,true);
 assert.equal(initialVisit({coarse:true,cores:2}).reading,true);
 for(const hardware of [{},{memory:8,cores:8},{memory:NaN,cores:undefined},{memory:0,cores:-1}])assert.equal(initialVisit({coarse:true,...hardware}).reading,false);
 assert.equal(initialVisit({coarse:false,memory:1,cores:1}).reading,false);
 assert.equal(initialVisit({savedView:'unexpected'}).reading,false);
});
test('touch instructions describe real gestures and retain the separate layout-edit instruction',()=>{
 assert.match(interactionHint(true),/单指旋转.*双指缩放.*轻点/);
 assert.doesNotMatch(interactionHint(true),/滚轮/);
 assert.match(interactionHint(false),/滚轮缩放/);
 assert.match(interactionHint(true,true),/拖动建筑/);
 assert.doesNotMatch(interactionHint(true,true),/轻点建筑探索/);
});

test('two-finger gestures and another pointer release do not activate buildings; a normal tap still does',()=>{
 const handlers={},selected=[];const scene={canvas:{style:{},addEventListener:(type,fn)=>handlers[type]=fn},arranging:false,controls:{enabled:true},pick:()=> 'library',select:id=>selected.push(id)};
 IslandScene.prototype.bindPointers.call(scene);
 const event=(id,x=100,primary=true)=>({pointerId:id,pointerType:'touch',isPrimary:primary,clientX:x,clientY:100});
 handlers.pointerdown(event(1,90));handlers.pointerdown(event(2,100,false));handlers.pointerup(event(2,100,false));handlers.pointerup(event(1,90));assert.deepEqual(selected,[]);
 handlers.pointerdown(event(3));handlers.pointerup(event(4));assert.deepEqual(selected,[]);
 handlers.pointerdown(event(5));handlers.pointerup(event(5));assert.deepEqual(selected,['library']);
 handlers.pointerdown(event(6));handlers.pointerup(event(6,130));assert.deepEqual(selected,['library']);
});
