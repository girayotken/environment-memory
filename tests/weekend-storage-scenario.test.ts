import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWeekendStorageScenario} from '../src/client/models/weekend-storage-scenario';
import {createWeekendWorkshop} from '../src/client/models/weekend-workshop';

function position(object:THREE.Object3D) {
  object.updateWorldMatrix(true,false);
  return object.getWorldPosition(new THREE.Vector3()).toArray();
}

test('closed box prevents charger extraction and retains both contents',()=>{
  const s=createWeekendStorageScenario();
  const box=s.group.getObjectByName('portable-storage-box')!;
  const charger=s.group.getObjectByName('camera-battery-charger')!;
  const adapter=s.group.getObjectByName('power-adapter')!;
  s.takeCharger();
  assert.equal(s.chargerOut,false);assert.equal(charger.parent,box);assert.equal(adapter.parent,box);
  s.toggleOpen();s.takeCharger();s.toggleOpen();
  assert.equal(s.chargerOut,true);assert.equal(adapter.parent,box);assert.equal(s.open,false);
});

test('moving the box preserves contents while an extracted charger stays on the table',()=>{
  const s=createWeekendStorageScenario();
  const box=s.group.getObjectByName('portable-storage-box')!;
  const charger=s.group.getObjectByName('camera-battery-charger')!;
  const adapter=s.group.getObjectByName('power-adapter')!;
  s.toggleOpen();s.takeCharger();const chargerBefore=position(charger), adapterBefore=position(adapter);
  s.moveBox();
  assert.equal(s.boxOnShelf,true);assert.deepEqual(position(charger),chargerBefore);
  assert.notDeepEqual(position(adapter),adapterBefore);assert.equal(adapter.parent,box);
  assert.deepEqual(position(box),[-2.355,.95,-1.68]);
  s.moveBox();assert.deepEqual(position(box),[-2.355,.95,-1.68]);
  assert.deepEqual(position(charger),chargerBefore);
});

test('box and extracted charger rest within their supporting surfaces and closed lid covers contents',()=>{
  const s=createWeekendStorageScenario();
  const box=s.group.getObjectByName('portable-storage-box')!;
  const lid=s.group.getObjectByName('box-lid')!;
  const charger=s.group.getObjectByName('camera-battery-charger')!;
  const adapter=s.group.getObjectByName('power-adapter')!;
  s.group.updateMatrixWorld(true);
  const cover=new THREE.Box3().setFromObject(lid);
  for(const content of [charger,adapter]) {
    const bounds=new THREE.Box3().setFromObject(content);
    assert.ok(cover.min.x<=bounds.min.x && cover.max.x>=bounds.max.x);
    assert.ok(cover.min.z<=bounds.min.z && cover.max.z>=bounds.max.z);
    assert.ok(cover.min.y>=bounds.max.y);
  }
  let bounds=new THREE.Box3().setFromObject(box);
  assert.ok(Math.abs(bounds.min.y-.92)<1e-9);
  assert.ok(bounds.min.x>=1.5 && bounds.max.x<=3 && bounds.min.z>=-1.975 && bounds.max.z<=-1.125);
  s.toggleOpen();s.takeCharger();s.moveBox();s.toggleOpen();s.group.updateMatrixWorld(true);
  bounds=new THREE.Box3().setFromObject(box);
  assert.ok(Math.abs(bounds.min.y-.95)<1e-9);
  assert.ok(bounds.min.x>=-2.9 && bounds.max.x<=-1.8 && bounds.min.z>=-1.975 && bounds.max.z<=-1.425);
  bounds=new THREE.Box3().setFromObject(charger);
  assert.ok(Math.abs(bounds.min.y-.921)<1e-9);
  assert.ok(bounds.min.x>=1.5 && bounds.max.x<=3 && bounds.min.z>=-1.975 && bounds.max.z<=-1.125);
});

test('reset restores the closed initial arrangement idempotently',()=>{
  const s=createWeekendStorageScenario();
  const charger=s.group.getObjectByName('camera-battery-charger')!;
  const lid=s.group.getObjectByName('box-lid')!;
  const initial=position(charger);
  s.toggleOpen();s.takeCharger();s.moveBox();s.reset();s.reset();
  assert.equal(s.open,false);assert.equal(s.chargerOut,false);assert.equal(s.boxOnShelf,false);
  assert.equal(lid.rotation.x,0);assert.deepEqual(position(charger),initial);
});

test('scenario objects clear remaining portable props in the full workshop',()=>{
  const workshop=createWeekendWorkshop(), scenario=workshop.scenario;
  const box=workshop.group.getObjectByName('portable-storage-box')!;
  const charger=workshop.group.getObjectByName('camera-battery-charger')!;
  function assertClear(object:THREE.Object3D) {
    workshop.group.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(object);
    for(const prop of workshop.group.children) {
      if(prop===scenario.group) continue;
      const other=new THREE.Box3().setFromObject(prop);
      assert.equal(bounds.intersectsBox(other),false,`${object.name} intersects portable prop at ${prop.position.toArray()}`);
    }
  }
  assertClear(box);
  scenario.toggleOpen();scenario.takeCharger();assertClear(charger);
  scenario.toggleOpen();scenario.moveBox();assertClear(box);assertClear(charger);
});

test('similar replacement preserves the shelf pose, detached charger and resets cleanly',()=>{
  const s=createWeekendStorageScenario();const box=s.group.getObjectByName('portable-storage-box')!;
  s.toggleOpen();s.takeCharger();s.toggleOpen();s.moveBox();
  const charger=s.group.getObjectByName('camera-battery-charger')!,chargerBefore=position(charger),pose=position(box),children=s.group.children.slice();
  s.replaceBox();const replacement=s.group.getObjectByName('replacement-storage-box')!;
  assert.ok(replacement);assert.equal(s.boxReplaced,true);assert.equal(box.visible,false);assert.deepEqual(position(replacement),pose);assert.deepEqual(position(charger),chargerBefore);
  assert.equal(replacement.getObjectByName('box-lid')!.children[1].visible,false);
  const bounds=new THREE.Box3().setFromObject(replacement),original=new THREE.Box3().setFromObject(box);
  assert.ok(bounds.getSize(new THREE.Vector3()).distanceTo(original.getSize(new THREE.Vector3()))<.05);
  s.replaceBox();assert.equal(s.group.children.filter(o=>o.name==='replacement-storage-box').length,1);
  s.toggleOpen();s.moveBox();assert.equal(s.open,false);assert.equal(s.boxOnShelf,true);
  s.reset();s.reset();assert.equal(s.boxReplaced,false);assert.equal(box.visible,true);assert.deepEqual(s.group.children,children.filter(o=>o!==charger));
});
