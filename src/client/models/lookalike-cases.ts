import * as THREE from 'three';

/** Renderer-owned duplicate geometry; none of these references cross capture(). */
export function createLookalikeCases(original: THREE.Group) {
  // Clone before adding marks so both can also be genuinely indistinguishable.
  const second = original.clone(true), third = original.clone(true);
  function tape(parent: THREE.Group, color: number) {
    const group = new THREE.Group(), material = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    for (const [size, position] of [
      [[0.065, 0.003, 0.29], [-0.105, 0.151, 0]],
      [[0.065, 0.115, 0.003], [-0.105, 0.088, 0.159]],
    ] as [number[], number[]][]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), material);
      mesh.position.set(...position as [number, number, number]); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    }
    parent.add(group); return group;
  }
  const yellowTape = tape(second, 0xf6ca32), whiteTape = tape(third, 0xf4f2e4);
  second.visible = third.visible = false;
  return { second, third, yellowTape, whiteTape };
}
