import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Workshop } from '../scene.ts';

/** Evaluator-only geometry; enabled exclusively in an isolated local camera build. */
export function applyMovedCaseScene(workshop: Workshop) {
  const { drill, blueCase } = workshop as unknown as { drill: THREE.Group; blueCase: THREE.Group };
  if (!blueCase.parent) throw new Error('The evaluator case needs its original support hierarchy.');
  // Retain the exact drill instance, geometry, materials and orientation.
  drill.position.set(-0.45, 0.269, -0.08);

  // A distinct case instance at the same pose. Clone resources so changes cannot
  // alter the original object or other workshop props sharing its materials.
  const replacement = blueCase.clone(true);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  replacement.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material) ? object.material.map(material => material.clone()) : object.material.clone();
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  const near = (a: number, b: number) => Math.abs(a - b) < 0.00001;
  const lidBlue = new THREE.MeshStandardMaterial({ color: 0x255078, roughness: 0.58 });
  const darkClasp = new THREE.MeshStandardMaterial({ color: 0x343b3d, roughness: 0.48, metalness: 0.62 });
  materials.add(lidBlue); materials.add(darkClasp);
  for (const object of [...replacement.children]) {
    if (!(object instanceof THREE.Mesh)) continue;
    const { x, y, z } = object.position;
    if (near(y, 0.143) && near(x, 0)) { object.scale.x = 0.80; object.scale.z = 1.18; }
    // The replacement has two crosswise molded lid ribs, rather than four
    // fore-aft ribs. Keep removed clone resources reachable for scene disposal.
    if (near(y, 0.143) && !near(x, 0)) object.visible = false;
    if (near(y, 0.079) && near(z, 0.201)) object.scale.x = 1.25;
    if (near(y, 0.079) && near(z, 0.175)) object.position.x = Math.sign(x) * 0.095;
    if (near(y, 0.1) && near(z, 0.163)) { object.scale.x = 1.5; object.material = darkClasp; }
  }
  for (const z of [-0.08, 0.08]) {
    const rib = new THREE.Mesh(new RoundedBoxGeometry(0.41, 0.011, 0.018, 2, 0.003), lidBlue);
    geometries.add(rib.geometry);
    rib.position.set(0, 0.146, z); rib.castShadow = rib.receiveShadow = true; replacement.add(rib);
  }
  const originalVisibility = blueCase.visible;
  replacement.visible = true; blueCase.visible = false; blueCase.parent.add(replacement);
  return () => { replacement.removeFromParent(); blueCase.visible = originalVisibility; geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); };
}
