import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Authored operator-test prop; neither its name nor pose leaves the renderer. */
export function createInspectionMeter() {
  const group = new THREE.Group(); group.position.set(-0.59, 0.94, 0.34); group.rotation.y = 0.1;
  const red = new THREE.MeshStandardMaterial({ color: 0xb93d32, roughness: 0.62 });
  const black = new THREE.MeshStandardMaterial({ color: 0x20272a, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9c4c5, metalness: 0.8, roughness: 0.35 });
  const display = new THREE.MeshStandardMaterial({ color: 0x9cafa0, roughness: 0.45 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  add(new RoundedBoxGeometry(0.17, 0.28, 0.058, 2, 0.013), red, 0, 0.14, 0);
  add(new RoundedBoxGeometry(0.143, 0.25, 0.008, 2, 0.008), black, 0, 0.14, 0.029);
  add(new RoundedBoxGeometry(0.116, 0.05, 0.005, 2, 0.003), display, 0, 0.224, 0.035);
  for (let i = 0; i < 3; i++) {
    add(new THREE.BoxGeometry(0.015, 0.003, 0.001), black, -0.025 + i * 0.025, 0.226, 0.038);
    add(new THREE.BoxGeometry(0.003, 0.02, 0.001), black, -0.032 + i * 0.025, 0.224, 0.038);
    add(new THREE.BoxGeometry(0.003, 0.02, 0.001), black, -0.018 + i * 0.025, 0.224, 0.038);
  }
  const dial = add(new THREE.CylinderGeometry(0.031, 0.031, 0.014, 24), black, 0, 0.121, 0.041); dial.rotation.x = Math.PI / 2;
  add(new RoundedBoxGeometry(0.011, 0.043, 0.012, 2, 0.003), black, 0, 0.121, 0.051).rotation.z = -0.4;
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9;
    add(new THREE.BoxGeometry(0.003, 0.007, 0.001), display, Math.sin(a) * 0.043, 0.121 + Math.cos(a) * 0.043, 0.035).rotation.z = -a;
  }
  for (const [x, material] of [[-0.037, black], [0.037, red]] as const) {
    add(new THREE.TorusGeometry(0.008, 0.003, 6, 16), material, x, 0.042, 0.037);
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 0.042, 0.04), new THREE.Vector3(x * 2.4, 0.008, 0.12), new THREE.Vector3(x * 3, 0.006, 0.21), new THREE.Vector3(x * 2, 0.013, 0.28)]);
    add(new THREE.TubeGeometry(path, 24, 0.0025, 5, false), material, 0, 0, 0);
    const probe = add(new THREE.CylinderGeometry(0.005, 0.005, 0.07, 12), material, x * 2, 0.012, 0.3); probe.rotation.x = Math.PI / 2;
    const tip = add(new THREE.CylinderGeometry(0.002, 0.002, 0.025, 8), metal, x * 2, 0.012, 0.347); tip.rotation.x = Math.PI / 2;
  }
  return group;
}
