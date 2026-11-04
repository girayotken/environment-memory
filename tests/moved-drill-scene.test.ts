import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createHeroTools} from '../src/client/models/hero-tools.ts';
import {applyMovedDrillScene, createDemoSceneControls} from '../src/client/evaluation/moved-drill-scene.ts';
import {applyMovedCaseScene} from '../src/client/evaluation/moved-case-scene.ts';
import {createStorageProps} from '../src/client/models/storage-props.ts';
import type {Workshop} from '../src/client/scene.ts';

test('evaluator variant moves only the existing drill position',()=>{
 const {group,drill,robot}=createHeroTools();const all:THREE.Object3D[]=[];group.traverse(o=>all.push(o));
 const before=all.map(o=>({o,parent:o.parent,position:o.position.toArray(),rotation:o.rotation.toArray(),scale:o.scale.toArray(),visible:o.visible,geometry:o instanceof THREE.Mesh?o.geometry:null,material:o instanceof THREE.Mesh?o.material:null}));
 assert.deepEqual(drill.position.toArray(),[0.75,0.94,0.22]);applyMovedDrillScene({drill} as unknown as Workshop);
 assert.deepEqual(drill.position.toArray(),[-0.45,0.94,0.40]);
 group.updateMatrixWorld(true);assert.equal(new THREE.Box3().setFromObject(drill).intersectsBox(new THREE.Box3().setFromObject(robot)),false);const bounds=new THREE.Box3().setFromObject(drill);assert.ok(bounds.min.z>-.6&&bounds.max.z<.6);
 for(const item of before){assert.equal(item.o.parent,item.parent);if(item.o!==drill)assert.deepEqual(item.o.position.toArray(),item.position);assert.deepEqual(item.o.rotation.toArray(),item.rotation);assert.deepEqual(item.o.scale.toArray(),item.scale);assert.equal(item.o.visible,item.visible);if(item.o instanceof THREE.Mesh){assert.equal(item.o.geometry,item.geometry);assert.equal(item.o.material,item.material);}}
});

test('demo controls preserve scene identities and restore the exact original drill after repeated moves',()=>{
 const {group,drill}=createHeroTools();
 drill.rotation.set(.2,.3,.4);drill.scale.set(1.1,.9,1.2);drill.visible=false;
 const all:THREE.Object3D[]=[];group.traverse(o=>all.push(o));
 const before=all.map(o=>({o,parent:o.parent,position:o.position.toArray(),rotation:o.rotation.toArray(),scale:o.scale.toArray(),visible:o.visible,geometry:o instanceof THREE.Mesh?o.geometry:null,material:o instanceof THREE.Mesh?o.material:null}));
 const controls=createDemoSceneControls({drill} as unknown as Workshop);
 controls.moveDrill();const moved=drill.position.toArray();controls.moveDrill();assert.deepEqual(drill.position.toArray(),moved);
 drill.rotation.set(0,0,0);drill.scale.set(1,1,1);drill.visible=true;
 controls.resetScene();controls.resetScene();
 for(const item of before){assert.equal(item.o.parent,item.parent);assert.deepEqual(item.o.position.toArray(),item.position);assert.deepEqual(item.o.rotation.toArray(),item.rotation);assert.deepEqual(item.o.scale.toArray(),item.scale);assert.equal(item.o.visible,item.visible);if(item.o instanceof THREE.Mesh){assert.equal(item.o.geometry,item.geometry);assert.equal(item.o.material,item.material);}}
});

test('controls reset a pre-applied moved-drill preset to its original pose',()=>{
 const {drill}=createHeroTools();const original=drill.position.toArray();
 const controls=createDemoSceneControls({drill} as unknown as Workshop);applyMovedDrillScene({drill} as unknown as Workshop);
 controls.resetScene();assert.deepEqual(drill.position.toArray(),original);
});

test('controls remove the moved-case replacement and restore original drill and case',()=>{
 const {group,drill}=createHeroTools();const {group:storage,blueCase}=createStorageProps();
 const originalDrill=drill.position.toArray(),originalCase=blueCase.visible,children=storage.children.slice();
 const workshop={drill,blueCase} as unknown as Workshop;let restore:(()=>void)|undefined;
 const controls=createDemoSceneControls(workshop,()=>restore?.());restore=applyMovedCaseScene(workshop);
 assert.equal(blueCase.visible,false);controls.moveDrill();controls.resetScene();controls.resetScene();
 assert.deepEqual(drill.position.toArray(),originalDrill);assert.equal(blueCase.visible,originalCase);assert.deepEqual(storage.children,children);assert.equal(group.children.includes(drill),true);
});

test('replacement is distinct, preserves pose, moves together, and cleans up without leaks',()=>{
 const {group,drill}=createHeroTools();const children=group.children.slice();
 const controls=createDemoSceneControls({drill} as unknown as Workshop);controls.moveDrill();
 const pose=drill.position.toArray();controls.replaceDrill();
 const replacement=group.children.find(o=>!children.includes(o)) as THREE.Group;
 assert.ok(replacement);assert.notEqual(replacement,drill);assert.equal(drill.visible,false);assert.deepEqual(replacement.position.toArray(),pose);
 const originalMeshes:THREE.Mesh[]=[],cloneMeshes:THREE.Mesh[]=[];
 drill.traverse(o=>{if(o instanceof THREE.Mesh)originalMeshes.push(o);});replacement.traverse(o=>{if(o instanceof THREE.Mesh)cloneMeshes.push(o);});
 assert.notEqual(cloneMeshes[0].geometry,originalMeshes[0].geometry);assert.notEqual(cloneMeshes[0].material,originalMeshes[0].material);
 assert.notDeepEqual(cloneMeshes[0].scale.toArray(),originalMeshes[0].scale.toArray());
 let disposed=0;cloneMeshes[0].geometry.addEventListener('dispose',()=>disposed++);
 controls.replaceDrill();assert.equal(group.children.filter(o=>!children.includes(o)).length,1);
 controls.moveDrill();assert.deepEqual(replacement.position.toArray(),drill.position.toArray());
 controls.resetScene();controls.resetScene();assert.equal(disposed,1);assert.deepEqual(group.children,children);assert.equal(drill.visible,true);assert.deepEqual(drill.position.toArray(),[.75,.94,.22]);
 controls.replaceDrill();controls.resetScene();assert.deepEqual(group.children,children);
});
