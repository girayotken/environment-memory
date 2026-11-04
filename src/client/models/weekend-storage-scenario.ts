import * as THREE from 'three';

export interface WeekendStorageScenario {
  group: THREE.Group;
  readonly open: boolean;
  readonly chargerOut: boolean;
  readonly boxOnShelf: boolean;
  readonly boxReplaced: boolean;
  replaceBox(): void;
  toggleOpen(): void;
  takeCharger(): void;
  moveBox(): void;
  reset(): void;
}

/** Scene-only demonstration. Authored names and state are not observer evidence. */
export function createWeekendStorageScenario(): WeekendStorageScenario {
  const group=new THREE.Group(); group.name='weekend-storage-scenario';
  const boxGroup=new THREE.Group(); boxGroup.name='portable-storage-box'; group.add(boxGroup);
  const blue=new THREE.MeshStandardMaterial({color:0x657e87,roughness:.78});
  const dark=new THREE.MeshStandardMaterial({color:0x293237,roughness:.7});
  const lining=new THREE.MeshStandardMaterial({color:0xd4d1c1,roughness:.9});
  const accent=new THREE.MeshStandardMaterial({color:0xb4b7aa,roughness:.75});
  const metal=new THREE.MeshStandardMaterial({color:0xaab0ab,metalness:.65,roughness:.4});
  function part(parent:THREE.Object3D,size:[number,number,number],pos:[number,number,number],mat:THREE.Material) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),mat); mesh.position.set(...pos);
    mesh.castShadow=mesh.receiveShadow=true; parent.add(mesh); return mesh;
  }
  // The opaque shell remains physically present when its lid is closed.
  part(boxGroup,[.34,.012,.25],[0,.006,0],blue);
  part(boxGroup,[.322,.003,.232],[0,.013,0],lining);
  for(const x of [-.164,.164])part(boxGroup,[.012,.12,.25],[x,.07,0],blue);
  for(const z of [-.119,.119])part(boxGroup,[.316,.12,.012],[0,.07,z],blue);
  const lid=new THREE.Group(); lid.name='box-lid'; lid.position.set(0,.13,-.125);boxGroup.add(lid);
  part(lid,[.35,.018,.26],[0,.009,.125],blue);
  part(lid,[.08,.012,.018],[0,.01,.257],metal);
  // Camera battery charger has a recognizable recessed battery bay and contacts.
  const charger=new THREE.Group();charger.name='camera-battery-charger';boxGroup.add(charger);
  part(charger,[.105,.025,.075],[0,.0125,0],dark);
  part(charger,[.065,.004,.048],[0,.026,0],accent);
  part(charger,[.050,.003,.035],[0,.0285,0],dark);
  for(const x of [-.013,0,.013])part(charger,[.004,.002,.008],[x,.0305,-.011],metal);
  part(charger,[.009,.002,.004],[.039,.026,.023],accent);
  // Similar power adapter stays in the box throughout the demonstration.
  const adapter=new THREE.Group(); adapter.name='power-adapter'; adapter.position.set(.083,.015,.035);boxGroup.add(adapter);
  part(adapter,[.075,.028,.050],[0,.014,0],dark);
  for(const x of [-.012,.012])part(adapter,[.005,.012,.004],[x,.032,-.014],metal);
  let open=false,chargerOut=false,boxOnShelf=false;
  let replacement:THREE.Group|undefined;
  const replacementGeometries:THREE.BufferGeometry[]=[];
  function replaceBox() {
    if(replacement || open) return;
    replacement=boxGroup.clone(true);replacement.name='replacement-storage-box';
    const replacementLid=replacement.getObjectByName('box-lid')!;
    // Exchange the central metal clasp for two dark latches and an inset grip.
    replacementLid.children[1].visible=false;
    for(const x of [-.105,.105]) {
      const latch=part(replacement,[.045,.05,.012],[x,.112,.13],dark);
      replacementGeometries.push(latch.geometry);
    }
    const grip=part(replacementLid,[.115,.012,.018],[0,.011,.24],dark);
    replacementGeometries.push(grip.geometry);
    boxGroup.visible=false;group.add(replacement);
  }
  function removeReplacement() {
    replacement?.removeFromParent();replacement=undefined;
    replacementGeometries.splice(0).forEach(geometry=>geometry.dispose());boxGroup.visible=true;
  }
  function apply() {
    if(boxOnShelf) boxGroup.position.set(-2.355,.95,-1.68);
    else boxGroup.position.set(2.12,.92,-1.34);
    lid.rotation.x=open ? -Math.PI*.53 : 0;
    if(chargerOut) { group.add(charger);charger.position.set(2.40,.921,-1.30); }
    else { boxGroup.add(charger);charger.position.set(-.06,.015,.015); }
  }
  apply();
  return {group,get open(){return open;},get chargerOut(){return chargerOut;},get boxOnShelf(){return boxOnShelf;},get boxReplaced(){return !!replacement;},
    replaceBox,
    toggleOpen(){if(replacement)return;open=!open;apply();},
    takeCharger(){if(!replacement && open && !chargerOut){chargerOut=true;apply();}},
    moveBox(){if(replacement)return;boxOnShelf=true;apply();},
    reset(){removeReplacement();open=false;chargerOut=false;boxOnShelf=false;apply();}};
}
