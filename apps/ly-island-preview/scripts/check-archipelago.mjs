import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {IslandScene} from '../src/scene.js';
import {defaultIsland,LAYOUT_RULES,DECORATION_SLOTS} from '../../rqly-sites/island-store.mjs';
function fixture({scenery,decorations=[]}={}){
 const island=defaultIsland(),scene=Object.create(IslandScene.prototype);
 Object.assign(scene,{world:new THREE.Group(),canvas:{dataset:{}},landmarks:new Map(),sceneryObjects:new Map(),buildings:new Map(),heightMap:new Map(),active:null,selectionRing:null,layouts:island.layouts,scenery:scenery||island.scenery,decorations,decorationSlots:DECORATION_SLOTS,layoutRules:LAYOUT_RULES,callbacks:{}});
 scene.build(true);return scene;
}
test('grown building logical positions survive rebuilding across the satellite gap',()=>{
 const scene=fixture(),before=scene.getLayout();assert.deepEqual(before,defaultIsland().layouts.grown);
 scene.layouts.grown=before;scene.build(true);assert.deepEqual(scene.getLayout(),before);assert.equal(scene.buildings.get('projects').position.x,9*1.25+3.6);
});
test('saved satellite mailbox and decoration tree use the same visual coordinates as other trees',()=>{
 const scenery=defaultIsland().scenery;scenery.grown={postoffice:[7.75,1],trees:{'tree-12':[7.75,1.5],'decoration-west':[8,-1.25]}};
 const scene=fixture({scenery,decorations:[{slot:'west',type:'tree'}]});
 for(const[id,x,z]of[['postoffice',7.75,1],['tree-12',7.75,1.5],['decoration-west',8,-1.25]]){
  const g=scene.sceneryObjects.get(id);assert(g,id);assert.equal(g.position.x,x*1.25+3.6,id);assert.equal(g.position.z,z*1.25,id);
  scene.saveScenery(id);
 }
 assert.deepEqual(scene.scenery.grown,scenery.grown);scene.build(true);assert.equal(scene.sceneryObjects.get('postoffice').position.x,7.75*1.25+3.6);
});
test('new grown buildings retain usable paths and separate animated sails after batching',()=>{
 const scene=fixture(),ends=JSON.parse(scene.canvas.dataset.pathEndpoints);
 for(const id of['library','projects','workshop','postoffice'])assert.equal(ends[id].connected,true,id);
 assert(scene.windmill);assert(scene.windmill.parent);assert(scene.windmill.children.some(c=>c.isMesh));
 const box=new THREE.Box3().setFromObject(scene.buildings.get('library'));scene.windmill.rotation.z+=.25;scene.world.updateMatrixWorld(true);assert.deepEqual(new THREE.Box3().setFromObject(scene.buildings.get('library')),box);
});

test('drag clearance rejects decorative tree positions that a rebuild would remove',()=>{
 const scenery=defaultIsland().scenery;scenery.grown.postoffice=[7,.5];
 const scene=fixture({scenery,decorations:[{slot:'west',type:'tree'}]});
 assert.equal(scene.canMove('decoration-west',7,-.25),false);
 assert.equal(scene.canMove('decoration-west',7.5,-1),true);
 const tree=scene.sceneryObjects.get('decoration-west');tree.position.set(7.5*1.25+3.6,0,-1.25);scene.saveScenery('decoration-west');
 assert.equal(scene.canMove('postoffice',7.5,-.5),false);
 scene.build(true);assert(scene.sceneryObjects.has('decoration-west'));
});
