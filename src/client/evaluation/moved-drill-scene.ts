import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import type {Workshop} from '../scene.ts';

/** Evaluator-only: move the original drill without changing any other scene object. */
export function applyMovedDrillScene(workshop:Workshop){
 const {drill}=workshop as unknown as {drill:THREE.Group};
 drill.position.set(-0.45,0.94,0.40);
}

/** Local scene controls; state stays inside the renderer and never enters capture metadata. */
export function createDemoSceneControls(workshop:Workshop, restoreScenario?:()=>void){
 const {drill}=workshop as unknown as {drill:THREE.Group};
 const position=drill.position.clone(), rotation=drill.rotation.clone(), scale=drill.scale.clone(), visible=drill.visible;
 let cleanup=restoreScenario;
 let replacement:THREE.Group|undefined;
 let disposeReplacement:(()=>void)|undefined;
 let visibilityBeforeReplacement=visible;
 const removeReplacement=()=>{disposeReplacement?.();disposeReplacement=undefined;replacement=undefined;drill.visible=visibilityBeforeReplacement;};
 return {
  moveDrill(){applyMovedDrillScene(workshop);if(replacement)replacement.position.copy(drill.position);},
  replaceDrill(){
   if(replacement)return;
   if(!drill.parent)throw new Error('The evaluator drill needs its original support hierarchy.');
   visibilityBeforeReplacement=drill.visible;
   replacement=drill.clone(true);
   const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
   replacement.traverse(object=>{if(!(object instanceof THREE.Mesh))return;object.geometry=object.geometry.clone();geometries.add(object.geometry);object.material=Array.isArray(object.material)?object.material.map(m=>m.clone()):object.material.clone();(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m));});
   const near=(a:number,b:number)=>Math.abs(a-b)<0.00001;
   for(const object of replacement.children){
    if(!(object instanceof THREE.Mesh))continue;
    const {x,y}=object.position;
    if(near(y,.024)){object.scale.x=1.2;object.scale.z=1.18;}
    if(near(y,.054)||near(y,.068)){object.scale.x=1.12;object.scale.z=1.12;}
    // Shorten the front assembly together, keeping its parts aligned.
    if(y>.17&&x<-.03){object.position.x=-.03+(x+.03)*.82;object.scale.x*=.82;}
    if(near(x,-.096)&&near(y,.202)){object.scale.y*=1.2;object.scale.z*=1.2;}
   }
   const panelMaterial=new THREE.MeshStandardMaterial({color:0x33393e,roughness:.61});materials.add(panelMaterial);
   for(const z of [-.041,.041]){const panel=new THREE.Mesh(new RoundedBoxGeometry(.056,.027,.003,2,.001),panelMaterial);panel.position.set(.019,.215,z);panel.castShadow=panel.receiveShadow=true;replacement.add(panel);geometries.add(panel.geometry);}
   replacement.visible=true;drill.visible=false;drill.parent.add(replacement);
   const added=replacement;
   disposeReplacement=()=>{added.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());};
  },
  resetScene(){if(replacement)removeReplacement();cleanup?.();cleanup=undefined;drill.position.copy(position);drill.rotation.copy(rotation);drill.scale.copy(scale);drill.visible=visible;},
 };
}
