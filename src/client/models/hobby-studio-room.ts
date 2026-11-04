import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Small deterministic color maps keep the room self-contained and work in Node tests.
function surfaceTexture(kind: 'wood' | 'paint'): THREE.DataTexture {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = ((x * 37 + y * 73 + x * y * 13) % 31) / 30 - 0.5;
    const grain = kind === 'wood' ? Math.sin(y * 0.34 + Math.sin(x * 0.055) * 1.7) * 5 + Math.sin(y * 0.91 + x * 0.025) * 2 : 0;
    const value = Math.max(0, Math.min(255, 240 + grain + noise * (kind === 'wood' ? 5 : 3)));
    const i = (y * size + x) * 4;
    data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  return texture;
}

/** Fixed architecture and furniture for the modelmaker's room. Portable props live separately. */
export function createHobbyStudioRoom(): THREE.Group {
  const room = new THREE.Group();
  room.name = 'hobby-studio-room';
  const mat = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const cream = mat(0xd8d5c9), trim = mat(0xe8e4d9), sage = mat(0x879b80), darkSage = mat(0x566b58);
  const wood = mat(0xb99773), woodLight = mat(0xc5a584), woodDark = mat(0x80694f);
  const woodMap = surfaceTexture('wood');
  wood.map = woodMap; woodLight.map = woodMap; woodDark.map = woodMap;
  cream.map = surfaceTexture('paint');
  const metal = mat(0x4b5550, 0.5, 0.45), brass = mat(0xc6a86b, 0.4, 0.5);
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff5d4, emissive: 0xffe8ad, emissiveIntensity: 0.5 });
  const box = (size: [number, number, number], pos: [number, number, number], material: THREE.Material, radius = 0) => {
    const mesh = new THREE.Mesh(radius ? new RoundedBoxGeometry(...size, 2, radius) : new THREE.BoxGeometry(...size), material);
    mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; room.add(mesh); return mesh;
  };
  const cylinder = (radius: number, length: number, pos: [number, number, number], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
    mesh.position.set(...pos); mesh.castShadow = true; room.add(mesh); return mesh;
  };
  const beam = (a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) => {
    const m = cylinder(radius, a.distanceTo(b), [(a.x+b.x)/2, (a.y+b.y)/2, (a.z+b.z)/2], material);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); return m;
  };

  // Open front keeps the room readable from the existing free camera.
  box([6, 0.12, 5], [0, -0.06, 0], woodDark);
  for (let i = 0; i < 13; i++) {
    box([6, 0.018, 0.375], [0, 0.009, -2.31 + i * 0.385], wood);
  }
  box([6, 3.15, 0.12], [0, 1.575, -2.56], cream);
  box([0.12, 3.15, 5], [-3.06, 1.575, 0], cream);
  box([0.12, 3.15, 5], [3.06, 1.575, 0], cream);
  box([6, 0.14, 0.045], [0, 0.13, -2.47], trim);
  box([0.045, 0.14, 5], [-2.97, 0.13, 0], trim);
  box([0.045, 0.14, 5], [2.97, 0.13, 0], trim);
  box([6, 0.07, 0.07], [0, 3.08, -2.46], trim);

  // Large north window, frosted blue daylight and shallow sill.
  const glass = new THREE.MeshStandardMaterial({ color: 0xc7dfe2, roughness: 0.3, emissive: 0x9cbcc3, emissiveIntensity: 0.3 });
  box([1.65, 1.1, 0.035], [-0.6, 2.23, -2.47], glass);
  for (const x of [-1.45, 0.25]) box([0.08, 1.2, 0.09], [x, 2.23, -2.43], trim, 0.01);
  for (const y of [1.65, 2.81]) box([1.78, 0.08, 0.09], [-0.6, y, -2.43], trim, 0.01);
  box([0.045, 1.1, 0.07], [-0.6, 2.23, -2.42], trim);
  box([1.65, 0.04, 0.07], [-0.6, 2.23, -2.42], trim);
  box([1.9, 0.08, 0.23], [-0.6, 1.63, -2.39], woodLight, 0.015);

  // Main workbench: top surface exactly 0.92 m.
  box([2.6, 0.09, 1.2], [0, 0.875, 0], woodLight, 0.02);
  box([2.48, 0.15, 0.06], [0, 0.76, 0.48], woodDark);
  box([2.48, 0.15, 0.06], [0, 0.76, -0.48], woodDark);
  for (const x of [-1.16, 1.16]) for (const z of [-0.47, 0.47]) box([0.105, 0.83, 0.105], [x, 0.415, z], woodDark, 0.012);
  box([2.2, 0.055, 0.54], [0, 0.25, 0], wood);
  // A few localized marks on the working surface, raised above the tabletop.
  const scuff = mat(0x9f8065), paintTrace = mat(0x7f8b7d);
  for (const [x, z, length, angle] of [[-.22,.27,.075,.35],[.19,.31,.055,-.27],[.83,-.20,.045,.5],[-.12,.34,.035,-.6]]) {
    const mark = box([length,.001,.002],[x,.921,z],scuff); mark.rotation.y = angle;
  }
  const fleck = cylinder(.008,.001,[.89,.921,-.15],paintTrace); fleck.castShadow = false;
  // Thin front edge and two built-in drawers.
  for (const x of [-0.57, 0.57]) {
    box([1.05, 0.135, 0.025], [x, 0.755, 0.518], wood, 0.008);
    box([0.14, 0.022, 0.018], [x, 0.755, 0.536], brass, 0.006);
  }

  // Paint desk and left open shelving. Exact shelf top heights are prop anchors.
  box([1.5, 0.08, 0.85], [2.25, 0.88, -1.55], woodLight, 0.015);
  // Low raised shelf keeps bottles and the parts organizer on the desk.
  box([1.3, .035, .23], [2.2, 1.095, -1.83], woodLight, .006);
  for (const x of [1.6,2.8]) box([.035,.16,.18], [x,1.00,-1.83], woodDark);
  for (const x of [1.6, 2.9]) for (const z of [-1.89, -1.21]) box([0.08, 0.84, 0.08], [x, 0.42, z], sage, 0.01);
  box([1.28, 0.12, 0.035], [2.25, 0.77, -1.1], sage);
  for (const x of [-2.86, -1.84]) box([0.08, 2.08, 0.55], [x, 1.04, -1.7], sage, 0.01);
  box([1.1, 2.08, 0.035], [-2.35, 1.04, -1.957], darkSage);
  for (const y of [0.45, 0.95, 1.45, 1.95]) box([1.1, 0.055, 0.55], [-2.35, y - 0.0275, -1.7], woodLight, 0.008);
  for (const x of [-2.81,-1.89]) for (const y of [.42,.92,1.42,1.92]) {
    const screw = cylinder(.008,.003,[x,y,-1.42],metal); screw.rotation.x = Math.PI / 2;
  }

  // Pegboard with regular perforations; organizer has shallow usable ledges.
  box([0.045, 0.85, 1.12], [-2.97, 1.95, -0.25], woodLight, 0.01);
  for (let row = 0; row < 7; row++) for (let col = 0; col < 9; col++) {
    const dot = cylinder(0.012, 0.006, [-2.942, 1.64 + row * 0.105, -0.68 + col * 0.105], woodDark);
    dot.rotation.z = Math.PI / 2;
  }
  for (const z of [-.57,-.15,.27]) {
    beam(new THREE.Vector3(-2.94,2.06,z), new THREE.Vector3(-2.88,2.06,z), .006, metal);
    beam(new THREE.Vector3(-2.88,2.06,z), new THREE.Vector3(-2.88,2.09,z), .006, metal);
  }
  box([1.2, 0.98, 0.045], [1.35, 1.76, -2.46], sage, 0.01);
  for (const y of [1.38, 1.63, 1.88, 2.13]) {
    box([1.2, 0.035, 0.16], [1.35, y - 0.0175, -2.37], woodLight, 0.005);
    box([1.2, 0.045, 0.018], [1.35, y + 0.018, -2.29], woodDark);
  }

  // Adjustable fixed task light at the rear right corner of the main bench.
  cylinder(0.105, 0.025, [1.05, 0.935, -0.44], metal);
  const a = new THREE.Vector3(1.05, 0.95, -0.44), b = new THREE.Vector3(1.07, 1.45, -0.46), c = new THREE.Vector3(0.75, 1.7, -0.32);
  beam(a, b, 0.025, metal); beam(b, c, 0.025, metal);
  for (const p of [b, c]) { const joint = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), brass); joint.position.copy(p); room.add(joint); }
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.18, 16, 1, true), darkSage); shade.position.set(0.75, 1.64, -0.32); room.add(shade);
  cylinder(0.105, 0.015, [0.75, 1.56, -0.32], glow);
  // Cable follows the lamp arm and drops behind the bench.
  const cable = mat(0x333a37, .95);
  for (const [from, to] of [[new THREE.Vector3(.78,1.7,-.34),new THREE.Vector3(1.07,1.44,-.48)], [new THREE.Vector3(1.07,1.44,-.48),new THREE.Vector3(1.07,.94,-.50)], [new THREE.Vector3(1.07,.94,-.50),new THREE.Vector3(1.07,.32,-.54)]]) beam(from,to,.006,cable);

  // Simple upholstered chair, placed behind the workbench.
  box([0.55, 0.09, 0.52], [0, 0.48, 1.2], sage, 0.045);
  box([0.55, 0.5, 0.09], [0, 0.79, 1.43], sage, 0.04);
  for (const x of [-0.22, 0.22]) for (const z of [1.0, 1.4]) box([0.045, 0.45, 0.045], [x, 0.225, z], woodDark, 0.006);
  return room;
}
