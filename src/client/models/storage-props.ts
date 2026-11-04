import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type V3 = [number, number, number];

/** Repository-authored workshop props; model names and transforms never leave the simulator. */
export function createStorageProps(): {
  group: THREE.Group;
  blueCase: THREE.Group;
  parcel: THREE.Group;
  flaps: THREE.Group[];
} {
  const group = new THREE.Group();
  const mat = (color: number, roughness = 0.65, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const steel = mat(0x6c7478, 0.38, 0.72);
  const darkSteel = mat(0x343b3d, 0.48, 0.62);
  const rubber = mat(0x222729, 0.9);
  const blue = mat(0x255078, 0.58);
  const blueEdge = mat(0x19394f, 0.7);
  const orange = mat(0xb85b2c, 0.64);
  const green = mat(0x637464, 0.63);
  const cabinetPaint = mat(0x758681, 0.52, 0.18);
  const pale = mat(0xe0ded2, 0.75);
  const card = mat(0xa98960, 0.96);
  const cardEdge = mat(0x7c6242, 1);
  const tape = mat(0xb8a17b, 0.48);
  const paper = mat(0xe8e4d8, 0.88);
  const plywood = mat(0xa88d67, 0.87);
  const translucent = new THREE.MeshPhysicalMaterial({ color: 0xc1cbbf, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false });

  function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: V3) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(...position); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  function box(parent: THREE.Object3D, size: V3, position: V3, material: THREE.Material, radius = 0.004) {
    return mesh(parent, radius > 0 ? new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(n => n / 3))) : new THREE.BoxGeometry(...size), material, position);
  }
  function cyl(parent: THREE.Object3D, radius: number, length: number, position: V3, material: THREE.Material, segments = 16) {
    return mesh(parent, new THREE.CylinderGeometry(radius, radius, length, segments), material, position);
  }
  function torus(parent: THREE.Object3D, radius: number, tube: number, position: V3, material: THREE.Material) {
    return mesh(parent, new THREE.TorusGeometry(radius, tube, 5, 24), material, position);
  }
  function cable(parent: THREE.Object3D, points: V3[], radius: number, material = rubber) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return mesh(parent, new THREE.TubeGeometry(curve, 24, radius, 6, false), material, [0, 0, 0]);
  }
  function screw(parent: THREE.Object3D, p: V3) {
    cyl(parent, 0.006, 0.003, p, steel, 8);
    box(parent, [0.007, 0.001, 0.0014], [p[0], p[1] + 0.002, p[2]], darkSteel, 0);
  }
  function plainLabel(parent: THREE.Object3D, size: [number, number], p: V3) {
    box(parent, [size[0], size[1], 0.0015], p, paper, 0.0008);
    // Unreadable stock marks rather than object identifiers or target words.
    for (let i = 0; i < 5; i++) box(parent, [0.002 + (i % 2) * 0.001, size[1] * 0.52, 0.0008], [p[0] - size[0] * 0.24 + i * 0.006, p[1], p[2] + 0.001], darkSteel, 0);
  }

  // Molded tool case: shell radii, split line, clasp recesses and a genuinely open handle.
  const blueCase = new THREE.Group(); blueCase.position.set(0.94, 0.94, -0.32); group.add(blueCase);
  box(blueCase, [0.5, 0.107, 0.31], [0, 0.058, 0], blue, 0.018);
  box(blueCase, [0.502, 0.006, 0.312], [0, 0.104, 0], blueEdge, 0.017);
  box(blueCase, [0.5, 0.035, 0.31], [0, 0.123, 0], blue, 0.013);
  box(blueCase, [0.37, 0.004, 0.21], [0, 0.143, 0], blueEdge, 0.015);
  for (const x of [-0.18, -0.12, 0.12, 0.18]) {
    box(blueCase, [0.025, 0.009, 0.23], [x, 0.143, 0], blue, 0.004);
    box(blueCase, [0.018, 0.065, 0.012], [x, 0.056, -0.154], blueEdge, 0.003);
  }
  for (const x of [-0.23, 0.23]) for (const z of [-0.135, 0.135]) {
    box(blueCase, [0.035, 0.024, 0.038], [x, 0.016, z], rubber, 0.008);
  }
  for (const x of [-0.17, 0.17]) {
    box(blueCase, [0.051, 0.045, 0.007], [x, 0.093, 0.157], blueEdge, 0.005);
    box(blueCase, [0.032, 0.034, 0.012], [x, 0.1, 0.163], steel, 0.003);
    box(blueCase, [0.023, 0.004, 0.004], [x, 0.086, 0.171], darkSteel, 0.001);
    const hinge = cyl(blueCase, 0.009, 0.065, [x, 0.105, -0.16], darkSteel); hinge.rotation.z = Math.PI / 2;
  }
  for (const x of [-0.076, 0.076]) box(blueCase, [0.025, 0.023, 0.052], [x, 0.079, 0.175], blueEdge, 0.008);
  box(blueCase, [0.165, 0.024, 0.021], [0, 0.079, 0.201], rubber, 0.009);
  for (const x of [-0.13, 0.13]) screw(blueCase, [x, 0.146, 0.077]);

  // Thin-walled carton with actual interior and independent hinge pivots.
  const parcel = new THREE.Group(); parcel.position.set(-1.03, 0.94, -0.13); group.add(parcel);
  box(parcel, [0.5, 0.006, 0.4], [0, 0.004, 0], cardEdge, 0);
  for (const x of [-0.247, 0.247]) box(parcel, [0.006, 0.33, 0.4], [x, 0.168, 0], card, 0);
  for (const z of [-0.197, 0.197]) box(parcel, [0.5, 0.33, 0.006], [0, 0.168, z], card, 0);
  box(parcel, [0.05, 0.33, 0.0008], [-0.11, 0.168, 0.201], tape, 0);
  plainLabel(parcel, [0.105, 0.065], [0.075, 0.18, 0.201]);
  const flaps: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const flap = new THREE.Group(); flap.position.set(0, 0.333, side * 0.197); flap.rotation.x = side * 0.3;
    box(flap, [0.49, 0.005, 0.2], [0, 0, side * 0.1], card, 0);
    box(flap, [0.05, 0.0007, 0.185], [-0.11, 0.003, side * 0.1], tape, 0);
    parcel.add(flap); flaps.push(flap);
  }
  for (const side of [-1, 1]) {
    const flap = new THREE.Group(); flap.position.set(side * 0.247, 0.331, 0); flap.rotation.z = -side * 0.32;
    box(flap, [0.13, 0.005, 0.385], [side * 0.065, 0, 0], card, 0);
    parcel.add(flap); flaps.push(flap);
  }
  // Folded packing paper breaks the perfect empty carton without hiding its rim.
  for (let i = 0; i < 3; i++) {
    const fold = box(parcel, [0.16, 0.008, 0.07], [-0.12 + i * 0.105, 0.025 + i * 0.013, -0.1 + (i % 2) * 0.1], paper, 0.003);
    fold.rotation.set(0.25 * (i - 1), i * 0.7, 0.15);
  }

  // Open bins retain a visible floor, high back and low scooped front.
  function bin(parent: THREE.Object3D, w: number, h: number, d: number, p: V3, material: THREE.Material) {
    const b = new THREE.Group(); b.position.set(...p); parent.add(b);
    const t = 0.006;
    box(b, [w, t, d], [0, t / 2, 0], material, 0.003);
    box(b, [w, h, t], [0, h / 2, -d / 2], material, 0.004);
    for (const x of [-w / 2, w / 2]) {
      box(b, [t, h, d], [x, h / 2, 0], material, 0.003);
      box(b, [t * 1.7, 0.009, d], [x, h, 0], material, 0.003);
    }
    box(b, [w, h * 0.34, t], [0, h * 0.17, d / 2], material, 0.004);
    box(b, [w * 0.65, 0.012, 0.016], [0, h * 0.34, d / 2 + 0.003], material, 0.003);
    plainLabel(b, [w * 0.34, h * 0.21], [0, h * 0.17, d / 2 + 0.004]);
    return b;
  }
  function hardware(parent: THREE.Object3D, count: number, spread: number) {
    for (let i = 0; i < count; i++) {
      const x = Math.sin(i * 2.4) * spread, z = Math.cos(i * 1.73) * spread * 0.6;
      const bolt = new THREE.Group(); bolt.position.set(x, 0.018, z); bolt.rotation.z = (i % 3 - 1) * 0.7;
      cyl(bolt, 0.009, 0.006, [0, 0.014, 0], steel, 6);
      cyl(bolt, 0.004, 0.024, [0, 0, 0], steel, 8); parent.add(bolt);
    }
  }
  function carton(parent: THREE.Object3D, size: V3, p: V3) {
    const c = new THREE.Group(); c.position.set(...p); parent.add(c);
    box(c, size, [0, size[1] / 2, 0], card, 0.004);
    box(c, [0.045, 0.001, size[2]], [0, size[1] + 0.001, 0], tape, 0);
    box(c, [0.001, 0.0006, size[2]], [0, size[1] + 0.002, 0], cardEdge, 0);
    plainLabel(c, [size[0] * 0.35, size[1] * 0.23], [size[0] * 0.15, size[1] * 0.55, size[2] / 2 + 0.002]);
    return c;
  }

  const shelf = new THREE.Group(); shelf.position.set(-2.5, 0, -2.1); group.add(shelf);
  for (const x of [-0.635, 0.635]) for (const z of [-0.29, 0.29]) {
    box(shelf, [0.035, 2.13, 0.035], [x, 1.065, z], darkSteel, 0.003);
    box(shelf, [0.075, 0.012, 0.075], [x, 0.008, z], steel, 0.002);
    for (const y of [0.25, 0.6, 0.95, 1.3, 1.65, 2.0]) box(shelf, [0.012, 0.023, 0.0015], [x, y, z + 0.019], rubber, 0.003);
  }
  for (const y of [0.19, 0.75, 1.32, 1.94]) {
    box(shelf, [1.34, 0.025, 0.64], [0, y, 0], plywood, 0.003);
    box(shelf, [1.33, 0.045, 0.025], [0, y - 0.018, 0.308], darkSteel, 0.003);
  }
  // Diagonal back brace reads as load-bearing steel rather than a floating stack.
  for (const sign of [-1, 1]) {
    const brace = box(shelf, [0.019, 1.9, 0.009], [0, 1.08, -0.31], steel, 0.002);
    brace.rotation.z = sign * 0.59;
  }
  carton(shelf, [0.57, 0.34, 0.46], [-0.28, 0.205, -0.015]);
  const lowerBin = bin(shelf, 0.46, 0.24, 0.45, [0.37, 0.205, 0], green);
  const cableSpool = cyl(lowerBin, 0.11, 0.09, [0, 0.12, 0], darkSteel); cableSpool.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) torus(lowerBin, 0.08 + i * 0.009, 0.008, [0, 0.12, 0.052], rubber);
  const middleBin = bin(shelf, 0.53, 0.2, 0.45, [-0.3, 0.765, 0], blue);
  hardware(middleBin, 7, 0.15);
  const clearBox = new THREE.Group(); clearBox.position.set(0.33, 0.765, 0); shelf.add(clearBox);
  for (let i = 0; i < 4; i++) box(clearBox, [0.12, 0.055, 0.09], [-0.1 + (i % 2) * 0.2, 0.035 + Math.floor(i / 2) * 0.065, 0], i % 2 ? green : darkSteel, 0.006);
  box(clearBox, [0.47, 0.23, 0.42], [0, 0.115, 0], translucent, 0.015);
  box(clearBox, [0.49, 0.024, 0.44], [0, 0.24, 0], pale, 0.009);
  for (const x of [-0.23, 0.23]) box(clearBox, [0.016, 0.04, 0.1], [x, 0.224, 0], blueEdge, 0.004);
  carton(shelf, [0.34, 0.29, 0.4], [-0.4, 1.335, 0]);
  const topBin = bin(shelf, 0.65, 0.23, 0.45, [0.2, 1.335, 0], orange);
  for (let i = 0; i < 4; i++) {
    const coil = torus(topBin, 0.067, 0.009, [-0.19 + i * 0.12, 0.092, -0.025], i % 2 ? rubber : blueEdge);
    coil.rotation.y = i * 0.14;
  }
  carton(shelf, [0.52, 0.27, 0.44], [-0.23, 1.955, 0]);
  const reel = cyl(shelf, 0.18, 0.13, [0.38, 2.14, 0], darkSteel); reel.rotation.x = Math.PI / 2;
  const reelFlange = cyl(shelf, 0.2, 0.013, [0.38, 2.14, 0.073], pale); reelFlange.rotation.x = Math.PI / 2;
  const reelHub = cyl(shelf, 0.055, 0.025, [0.38, 2.14, 0.088], darkSteel); reelHub.rotation.x = Math.PI / 2;

  // Steel drawer cabinet and open, visibly populated component bins.
  const station = new THREE.Group(); station.position.set(2.35, 0, -2.1); group.add(station);
  box(station, [1.28, 0.81, 0.62], [0, 0.45, 0], cabinetPaint, 0.012);
  box(station, [1.18, 0.07, 0.52], [0, 0.055, 0], darkSteel, 0.004);
  box(station, [1.36, 0.04, 0.7], [0, 0.92, 0], plywood, 0.005);
  for (const x of [-0.31, 0.31]) for (let i = 0; i < 3; i++) {
    const y = 0.24 + i * 0.245;
    box(station, [0.585, 0.219, 0.017], [x, y, 0.319], cabinetPaint, 0.005);
    box(station, [0.45, 0.016, 0.026], [x, y + 0.055, 0.34], darkSteel, 0.004);
    box(station, [0.015, 0.045, 0.007], [x + 0.235, y + 0.05, 0.334], steel, 0.002);
  }
  for (let i = 0; i < 3; i++) {
    const b = bin(station, 0.35, 0.18, 0.37, [-0.43 + i * 0.43, 0.94, -0.075], i === 1 ? blue : orange);
    if (i === 0) hardware(b, 8, 0.105);
    else if (i === 1) {
      for (let n = 0; n < 5; n++) { const washer = torus(b, 0.022, 0.005, [Math.sin(n * 2) * 0.09, 0.017 + n * 0.003, Math.cos(n * 3) * 0.07], steel); washer.rotation.x = Math.PI / 2 - n * 0.03; }
    } else for (let n = 0; n < 4; n++) box(b, [0.055, 0.028, 0.055], [-0.08 + (n % 2) * 0.12, 0.025, -0.07 + Math.floor(n / 2) * 0.12], green, 0.004);
  }

  const tray = bin(group, 0.33, 0.045, 0.2, [0.26, 0.94, -0.37], orange);
  box(tray, [0.005, 0.04, 0.195], [0, 0.022, 0], orange, 0.001);
  hardware(tray, 5, 0.115);

  // Adjustable shop stool: wood seat, turned lip, steel legs and a foot ring.
  const stool = new THREE.Group(); stool.position.set(1.8, 0, 1.15); group.add(stool);
  cyl(stool, 0.23, 0.045, [0, 0.64, 0], plywood, 32);
  cyl(stool, 0.214, 0.022, [0, 0.665, 0], plywood, 32);
  cyl(stool, 0.05, 0.07, [0, 0.59, 0], darkSteel);
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + i * Math.PI / 2;
    const x = Math.sin(angle), z = Math.cos(angle);
    const a = new THREE.Vector3(x * 0.12, 0.6, z * 0.12), b = new THREE.Vector3(x * 0.23, 0.02, z * 0.23);
    const leg = cyl(stool, 0.013, a.distanceTo(b), a.clone().add(b).multiplyScalar(0.5).toArray() as V3, darkSteel);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    cyl(stool, 0.022, 0.012, [b.x, 0.012, b.z], rubber);
  }
  const footRing = torus(stool, 0.188, 0.009, [0, 0.22, 0], steel); footRing.rotation.x = Math.PI / 2;
  // An ordinary floor cable adds scale and a soft non-box silhouette away from hero assets.
  cable(group, [[-2.8, 0.018, -1.7], [-2.6, 0.018, -1.2], [-2.9, 0.018, -0.7], [-2.4, 0.018, -0.45]], 0.007);
  box(group, [0.06, 0.026, 0.035], [-2.4, 0.022, -0.45], rubber, 0.006);

  return { group, blueCase, parcel, flaps };
}
