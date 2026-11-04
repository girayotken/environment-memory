import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type V3 = [number, number, number];

/** Original, meter-scaled procedural props. No semantic labels are rendered. */
export function createHeroTools(): { group: THREE.Group; incomingParts: THREE.Group; drill: THREE.Group; robot: THREE.Group } {
  const group = new THREE.Group();
  const plastic = (color: number, roughness = 0.55, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const teal = plastic(0x275a65, 0.46);
  const rubber = plastic(0x202327, 0.94);
  const darkPlastic = plastic(0x33393e, 0.61);
  const aluminum = plastic(0xb6bfc4, 0.31, 0.83);
  const steel = plastic(0x6c7479, 0.36, 0.9);
  const brass = plastic(0xb39750, 0.4, 0.7);
  const pcb = plastic(0x205a42, 0.66);
  const cream = plastic(0xd4c8aa, 0.78);
  const red = plastic(0x923c32, 0.55);
  const blue = plastic(0x31567f, 0.48);
  const white = plastic(0xd9dcd7, 0.67);

  const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, at: V3) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...at); object.castShadow = true; object.receiveShadow = true;
    parent.add(object); return object;
  };
  const box = (parent: THREE.Object3D, size: V3, at: V3, material: THREE.Material, bevel = 0.004) =>
    mesh(parent, new RoundedBoxGeometry(...size, 2, Math.min(bevel, ...size.map(s => s * 0.25))), material, at);
  // Default cylinder axis is vertical; rotate callers for shafts and front-facing lenses.
  const cylinder = (parent: THREE.Object3D, radius: number, length: number, at: V3, material: THREE.Material, segments = 24) =>
    mesh(parent, new THREE.CylinderGeometry(radius, radius, length, segments), material, at);
  const wire = (parent: THREE.Object3D, points: V3[], radius: number, material: THREE.Material) =>
    mesh(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 18, radius, 5, false), material, [0, 0, 0]);
  const screw = (parent: THREE.Object3D, at: V3) => {
    cylinder(parent, 0.004, 0.0025, at, steel, 12);
    box(parent, [0.005, 0.001, 0.001], [at[0], at[1] + 0.0015, at[2]], rubber, 0.0001);
  };

  // Drill: separate motor shell, gearbox, knurled chuck, bit, overmould and battery.
  // Stands on its battery; physical dimensions are roughly 0.30 × 0.24 × 0.085m.
  const drill = new THREE.Group(); drill.position.set(0.75, 0.94, 0.22);
  drill.rotation.y = -0.32; group.add(drill);
  box(drill, [0.124, 0.047, 0.088], [0.053, 0.024, 0], rubber, 0.009);
  box(drill, [0.105, 0.013, 0.076], [0.053, 0.054, 0], darkPlastic, 0.004);
  box(drill, [0.057, 0.016, 0.068], [0.053, 0.068, 0], teal, 0.004);
  for (const z of [-0.045, 0.045]) {
    box(drill, [0.025, 0.018, 0.004], [0.07, 0.025, z], teal, 0.002);
    for (let i = 0; i < 4; i++) box(drill, [0.012, 0.005, 0.002], [0.025 + i * 0.016, 0.029, z], darkPlastic, 0.0005);
  }
  const grip = new THREE.Group(); grip.position.set(0.049, 0.076, 0); grip.rotation.z = -0.17; drill.add(grip);
  box(grip, [0.053, 0.108, 0.055], [0, 0.052, 0], teal, 0.012);
  box(grip, [0.026, 0.097, 0.059], [0.018, 0.054, 0], rubber, 0.009);
  for (const z of [-0.029, 0.029]) for (let i = 0; i < 5; i++) {
    const rib = box(grip, [0.028, 0.004, 0.003], [0.008, 0.022 + i * 0.014, z], rubber, 0.001);
    rib.rotation.z = -0.22;
  }
  box(drill, [0.023, 0.033, 0.042], [0.013, 0.153, 0], darkPlastic, 0.006); // trigger
  box(drill, [0.045, 0.019, 0.035], [-0.005, 0.178, 0], teal, 0.005);
  const motor = box(drill, [0.145, 0.08, 0.079], [0.036, 0.202, 0], teal, 0.022);
  motor.rotation.z = 0.025;
  box(drill, [0.025, 0.068, 0.073], [0.105, 0.202, 0], rubber, 0.013);
  // Visible shell seam and recessed motor cooling fins on both sides.
  for (const z of [-0.04, 0.04]) {
    box(drill, [0.104, 0.0018, 0.001], [0.038, 0.204, z], darkPlastic, 0.0002);
    for (let i = 0; i < 4; i++) box(drill, [0.004, 0.024, 0.002], [0.065 + i * 0.009, 0.211, z], rubber, 0.001);
    box(drill, [0.03, 0.008, 0.002], [0.005, 0.222, z], darkPlastic, 0.001);
  }
  for (const [x, radius, length, material] of [
    [-0.047, 0.034, 0.029, aluminum], [-0.071, 0.032, 0.026, darkPlastic],
    [-0.096, 0.026, 0.034, rubber], [-0.122, 0.016, 0.018, steel],
    [-0.148, 0.0037, 0.042, steel],
  ] as [number, number, number, THREE.Material][]) {
    const part = cylinder(drill, radius, length, [x, 0.202, 0], material); part.rotation.z = Math.PI / 2;
  }
  // Knurling physically breaks up the chuck silhouette.
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI * 2 / 16;
    const rib = box(drill, [0.027, 0.003, 0.003], [-0.096, 0.202 + Math.cos(angle) * 0.026, Math.sin(angle) * 0.026], darkPlastic, 0.0006);
    rib.rotation.x = angle;
  }
  const led = new THREE.MeshStandardMaterial({ color: 0xe4ecdd, emissive: 0xb8c8af, emissiveIntensity: 0.25, roughness: 0.4 });
  box(drill, [0.009, 0.007, 0.018], [-0.014, 0.163, 0], led, 0.002);

  // Assembled differential-drive robot: wheels, layered cut-metal plates and electronics.
  const robot = new THREE.Group(); robot.position.set(-0.18, 0.94, 0.08); robot.rotation.y = -0.13; group.add(robot);
  box(robot, [0.355, 0.012, 0.285], [0, 0.076, 0], aluminum, 0.017);
  box(robot, [0.33, 0.009, 0.259], [0, 0.186, 0], cream, 0.013);
  // Narrow dark slots read as plate cutouts rather than surface labels.
  for (const x of [-0.118, 0.118]) for (const z of [-0.06, 0.005, 0.07]) {
    box(robot, [0.012, 0.001, 0.031], [x, 0.191, z], darkPlastic, 0.005);
  }
  for (const x of [-0.13, 0.13]) for (const z of [-0.105, 0.105]) {
    cylinder(robot, 0.0055, 0.102, [x, 0.132, z], brass, 12);
    screw(robot, [x, 0.193, z]);
  }
  for (const x of [-0.199, 0.199]) {
    box(robot, [0.053, 0.041, 0.067], [Math.sign(x) * 0.142, 0.064, 0], darkPlastic, 0.006);
    const wheel = cylinder(robot, 0.064, 0.037, [x, 0.064, 0], rubber, 32); wheel.rotation.z = Math.PI / 2;
    const rim = cylinder(robot, 0.039, 0.039, [x, 0.064, 0], aluminum); rim.rotation.z = Math.PI / 2;
    const hub = cylinder(robot, 0.013, 0.043, [x, 0.064, 0], darkPlastic, 16); hub.rotation.z = Math.PI / 2;
    for (let i = 0; i < 20; i++) {
      const a = i * Math.PI * 2 / 20;
      const tread = box(robot, [0.039, 0.007, 0.015], [x, 0.064 + Math.cos(a) * 0.063, Math.sin(a) * 0.063], darkPlastic, 0.001);
      tread.rotation.x = -a;
    }
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI * 2 / 6;
      const hole = cylinder(robot, 0.005, 0.041, [x, 0.064 + Math.cos(a) * 0.025, Math.sin(a) * 0.025], rubber, 10);
      hole.rotation.z = Math.PI / 2;
    }
  }
  const caster = mesh(robot, new THREE.SphereGeometry(0.018, 16, 10), steel, [0, 0.021, 0.115]);
  caster.scale.y = 0.8;
  box(robot, [0.035, 0.04, 0.043], [0, 0.045, 0.115], darkPlastic, 0.006);
  box(robot, [0.095, 0.036, 0.14], [0.055, 0.104, -0.025], darkPlastic, 0.005);
  box(robot, [0.07, 0.003, 0.105], [0.057, 0.124, -0.025], red, 0.002);
  box(robot, [0.103, 0.005, 0.068], [-0.025, 0.198, -0.028], pcb, 0.003);
  box(robot, [0.027, 0.012, 0.027], [-0.036, 0.207, -0.03], rubber, 0.001);
  box(robot, [0.031, 0.015, 0.019], [0.022, 0.209, -0.026], aluminum, 0.001);
  for (const z of [-0.057, 0]) {
    box(robot, [0.077, 0.009, 0.006], [-0.027, 0.205, z], rubber, 0.001);
    for (let i = 0; i < 8; i++) cylinder(robot, 0.0009, 0.011, [-0.059 + i * 0.009, 0.214, z], brass, 5);
  }
  cylinder(robot, 0.005, 0.016, [0.003, 0.211, -0.044], aluminum, 12);
  box(robot, [0.037, 0.019, 0.025], [0.086, 0.204, 0.051], blue, 0.002);
  wire(robot, [[0.086, 0.212, 0.052], [0.063, 0.245, 0.086], [-0.046, 0.234, 0.068], [-0.054, 0.211, 0]], 0.002, red);
  wire(robot, [[0.06, 0.119, -0.07], [0.105, 0.153, -0.11], [0.11, 0.215, -0.09], [0.023, 0.216, -0.04]], 0.0018, rubber);
  wire(robot, [[-0.14, 0.083, 0.01], [-0.097, 0.115, 0.06], [-0.08, 0.209, 0.065], [-0.052, 0.212, 0]], 0.0016, white);
  // Front sensor installed on a bracket. Small cavities preserve optical depth.
  box(robot, [0.076, 0.032, 0.004], [0, 0.217, 0.117], pcb, 0.002);
  box(robot, [0.055, 0.018, 0.03], [0, 0.197, 0.111], darkPlastic, 0.003);
  for (const x of [-0.022, 0.022]) {
    const sleeve = cylinder(robot, 0.012, 0.014, [x, 0.22, 0.128], aluminum, 24); sleeve.rotation.x = Math.PI / 2;
    const recess = cylinder(robot, 0.009, 0.001, [x, 0.22, 0.136], rubber, 20); recess.rotation.x = Math.PI / 2;
  }

  // Loose incoming sensor and servo; root controls their placement/unpacking only.
  const incomingParts = new THREE.Group();
  box(incomingParts, [0.085, 0.004, 0.039], [-0.065, 0.009, 0.01], pcb, 0.002);
  for (const x of [-0.089, -0.041]) {
    const shell = cylinder(incomingParts, 0.015, 0.014, [x, 0.027, 0.02], aluminum); shell.rotation.x = Math.PI / 2;
    const aperture = cylinder(incomingParts, 0.0115, 0.0015, [x, 0.027, 0.028], rubber, 20); aperture.rotation.x = Math.PI / 2;
    for (const dx of [-0.004, 0.004]) box(incomingParts, [0.001, 0.018, 0.001], [x + dx, 0.027, 0.029], steel, 0.0002);
  }
  box(incomingParts, [0.023, 0.007, 0.009], [-0.066, 0.016, -0.004], rubber, 0.001);
  for (let i = 0; i < 4; i++) {
    const pin = cylinder(incomingParts, 0.0008, 0.014, [-0.075 + i * 0.005, 0.009, -0.018], brass, 5); pin.rotation.x = Math.PI / 2;
  }
  box(incomingParts, [0.044, 0.044, 0.029], [0.057, 0.025, 0.002], blue, 0.003);
  box(incomingParts, [0.061, 0.005, 0.031], [0.057, 0.043, 0.002], blue, 0.002);
  box(incomingParts, [0.041, 0.008, 0.026], [0.057, 0.051, 0.002], darkPlastic, 0.002);
  cylinder(incomingParts, 0.007, 0.01, [0.051, 0.06, 0.002], brass, 16);
  box(incomingParts, [0.049, 0.004, 0.008], [0.051, 0.067, 0.002], white, 0.003);
  screw(incomingParts, [0.051, 0.07, 0.002]);
  for (const x of [0.031, 0.083]) cylinder(incomingParts, 0.002, 0.001, [x, 0.047, 0.002], rubber, 10);
  wire(incomingParts, [[0.078, 0.017, -0.008], [0.098, 0.009, -0.019], [0.108, 0.007, -0.045], [0.05, 0.005, -0.052]], 0.0014, red);
  wire(incomingParts, [[0.078, 0.019, -0.005], [0.101, 0.012, -0.018], [0.109, 0.01, -0.048], [0.05, 0.007, -0.054]], 0.0014, rubber);
  box(incomingParts, [0.017, 0.007, 0.012], [0.045, 0.008, -0.053], rubber, 0.001);

  return { group, incomingParts, drill, robot };
}
