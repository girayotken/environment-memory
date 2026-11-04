import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cameraHeightLimit} from '../src/client/scene.ts';
import {createStorageRoom} from '../src/client/models/storage-room.ts';

test('storage box carries its distinct contents; removal and reset preserve scene objects',()=>{
 const room=createStorageRoom();room.group.updateMatrixWorld(true);
 assert.notEqual(room.charger,room.adapter);assert.equal(room.charger.parent,room.target.container);assert.equal(room.adapter.parent,room.other.container);
 const start=room.charger.getWorldPosition(new THREE.Vector3()), target=room.target.container.position.clone(), local=room.charger.position.clone();
 room.setOpen(false);assert.equal(room.target.lid.visible,true);assert.equal(room.other.lid.visible,true);
 room.moveBox();room.group.updateMatrixWorld(true);const moved=room.charger.getWorldPosition(new THREE.Vector3());assert.ok(Math.abs(moved.y-start.y)>.5);assert.equal(room.charger.parent,room.target.container);
 room.takeCharger();assert.equal(room.charger.parent,room.group);assert.equal(room.getState().removed,true);
 room.reset();room.group.updateMatrixWorld(true);assert.equal(room.charger.parent,room.target.container);assert.deepEqual(room.target.container.position.toArray(),target.toArray());assert.deepEqual(room.charger.position.toArray(),local.toArray());assert.deepEqual(room.getState(),{open:true,moved:false,removed:false});assert.deepEqual(room.charger.getWorldPosition(new THREE.Vector3()).toArray(),start.toArray());
});

test('storage packing camera remains inside its animation height bounds',()=>{
 const preset=4.2; assert.equal(THREE.MathUtils.clamp(preset,.25,cameraHeightLimit('storage-room')),preset);
 assert.equal(cameraHeightLimit('workshop'),2.95);assert.equal(cameraHeightLimit('model-maker-studio'),2.95);
});
