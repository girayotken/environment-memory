import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createHobbyStudioProps} from '../src/client/models/hobby-studio-props.ts';
import {createHobbyStudioRoom} from '../src/client/models/hobby-studio-room.ts';

test('studio separates fixtures and portable inventory',()=>{
 const room=createHobbyStudioRoom(), {group,drill,blueCase,inventory}=createHobbyStudioProps();
 assert.equal(room.name,'hobby-studio-room');
 assert.equal(drill.parent,group); assert.equal(blueCase.parent,group);
 assert.equal(inventory.paint,28); assert.equal(inventory.kitBoxes,10);
 assert.equal(inventory.drill,1); assert.equal(inventory.toolCase,1);
 assert.equal(inventory.openKit,1); assert.equal(inventory.partsTray,1);
 assert.equal(inventory.modelCar,1); assert.equal(inventory.brushCup,1);
 assert.equal(Object.values(inventory).reduce((a,b)=>a+b,0),103);
 assert.equal(Object.values(inventory).reduce((a,b)=>a+b,0),group.children.length);
});

test('added stored items stay on their supporting surfaces',()=>{
 const {group}=createHobbyStudioProps(); group.updateMatrixWorld(true);
 const bounds=(name:string)=>{const object=group.getObjectByName(name); assert.ok(object,name); return new THREE.Box3().setFromObject(object);};
 for(const name of ['small-parts-organizer','supply-jar','thinner-can','used-brush-cup','masking-sheet']) {
  const b=bounds(name); assert.ok(b.min.x>=1.5 && b.max.x<=3 && b.min.z>=-1.975 && b.max.z<=-1.125,name);
  assert.ok(Math.abs(b.min.y-1.113)<.002,name);
 }
 for(const name of ['sheet-stock','rod-stock','scrap-container','archive-carton-a','archive-carton-b','archive-carton-c','unfinished-plane','unfinished-hull','unfinished-diorama']) {
  const b=bounds(name); assert.ok(b.min.x>=-2.9 && b.max.x<=-1.8 && b.min.z>=-1.975 && b.max.z<=-1.425,name);
 }
 for(const [name,height] of [['sheet-stock',.506],['rod-stock',.520],['scrap-container',.534],['unfinished-plane',1.589],['unfinished-hull',1.617],['unfinished-diorama',1.451]] as const)
  assert.ok(Math.abs(bounds(name).min.y-height)<.002,name);
});
