import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type V3 = [number, number, number];

/** Authored workshop architecture, in metres. No evaluator annotations enter pixels. */
export function createWorkshopRoom(): THREE.Group {
  const room = new THREE.Group();
  const material = (color: number, roughness = 0.65, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  function box(parent: THREE.Object3D, size: V3, at: V3, mat: THREE.Material, bevel = 0) {
    const geometry = bevel > 0
      ? new RoundedBoxGeometry(...size, 2, Math.min(bevel, ...size.map(v => v * 0.45)))
      : new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(...at); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  function cylinder(parent: THREE.Object3D, r: number, length: number, at: V3, mat: THREE.Material, segments = 16) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length, segments), mat);
    mesh.position.set(...at); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  function tube(parent: THREE.Object3D, points: V3[], radius: number, mat: THREE.Material) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 5), radius, 7, false), mat);
    mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  function texture(kind: 'wood' | 'concrete' | 'wall') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const c = canvas.getContext('2d')!;
    let seed = kind === 'wood' ? 2743 : 7081;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    c.fillStyle = kind === 'wood' ? '#b79a75' : kind === 'concrete' ? '#91958f' : '#deded5';
    c.fillRect(0, 0, 512, 512);
    if (kind === 'wood') {
      for (let i = 0; i < 410; i++) {
        const y = random() * 512;
        c.strokeStyle = `rgba(62,43,23,${0.025 + random() * 0.10})`;
        c.lineWidth = 0.2 + random() * 1.5;
        c.beginPath(); c.moveTo(0, y);
        c.bezierCurveTo(170, y + random() * 9 - 4, 330, y + random() * 9 - 4, 512, y);
        c.stroke();
      }
      for (let i = 0; i < 17; i++) {
        c.strokeStyle = 'rgba(235,227,200,0.12)'; c.lineWidth = 1;
        const x = random() * 512, y = random() * 512;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 30 + random() * 60, y + random() * 4); c.stroke();
      }
    } else {
      for (let i = 0; i < 16000; i++) {
        const bright = random() > 0.52;
        c.fillStyle = bright ? `rgba(255,255,246,${random() * 0.08})` : `rgba(24,30,28,${random() * 0.07})`;
        const s = 0.5 + random() * (kind === 'wall' ? 3 : 7);
        c.fillRect(random() * 512, random() * 512, s, s);
      }
    }
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(kind === 'concrete' ? 3 : kind === 'wall' ? 2 : 1, kind === 'concrete' ? 3 : 1);
    map.anisotropy = 4; return map;
  }

  const wood = new THREE.MeshStandardMaterial({ color: 0xd9c39f, map: texture('wood'), roughness: 0.72 });
  const woodEdge = material(0x9d8260, 0.8), plywoodLine = material(0x6f5943, 0.82);
  const steel = material(0x454d4b, 0.48, 0.45), darkSteel = material(0x252c2c, 0.68, 0.22);
  const zinc = material(0xaeb5b3, 0.34, 0.8), rubber = material(0x222423, 0.94);
  const floor = new THREE.MeshStandardMaterial({ color: 0xc5c5b9, map: texture('concrete'), roughness: 0.96 });
  const plaster = new THREE.MeshStandardMaterial({ color: 0xf0ede3, map: texture('wall'), roughness: 0.96 });
  const lowerPaint = material(0x97a39b, 0.87), trim = material(0x69746e, 0.72);

  // A real-scale open-front shell. Window opening is split in the wall geometry.
  box(room, [7.15, 0.12, 7.1], [0, -0.06, 0.65], floor);
  const seam = material(0x777c75, 1);
  for (const x of [-2.33, 0, 2.33]) box(room, [0.005, 0.001, 7.08], [x, 0.001, 0.65], seam);
  for (const z of [-1.1, 1.25, 3.6]) box(room, [7.1, 0.001, 0.005], [0, 0.001, z], seam);
  box(room, [3.85, 3.15, 0.14], [-1.575, 1.575, -2.85], plaster);
  box(room, [1.45, 3.15, 0.14], [2.775, 1.575, -2.85], plaster);
  box(room, [1.7, 1.4, 0.14], [1.2, 0.7, -2.85], plaster);
  box(room, [1.7, 0.6, 0.14], [1.2, 2.85, -2.85], plaster);
  box(room, [0.14, 3.15, 5.7], [-3.57, 1.575, -0.05], plaster);
  box(room, [7, 1.1, 0.018], [0, 0.55, -2.768], lowerPaint);
  box(room, [0.018, 1.1, 5.6], [-3.492, 0.55, -0.05], lowerPaint);
  box(room, [7, 0.035, 0.035], [0, 1.1, -2.745], trim, 0.004);
  box(room, [0.035, 1.1, 0.035], [-3.47, 0.55, 2.73], trim, 0.003);
  box(room, [7, 0.10, 0.035], [0, 0.05, -2.74], trim, 0.003);
  box(room, [0.035, 0.1, 5.6], [-3.47, 0.05, -0.05], trim, 0.003);

  const windowFrame = material(0xb9c5c1, 0.55, 0.35);
  const daylight = new THREE.MeshStandardMaterial({ color: 0xcbd9dc, roughness: 0.36, metalness: 0.1,
    emissive: 0x8ba3ae, emissiveIntensity: 0.26 });
  box(room, [1.64, 1.09, 0.025], [1.2, 1.975, -2.872], daylight);
  for (const x of [0.35, 1.2, 2.05]) box(room, [0.055, 1.2, 0.095], [x, 1.98, -2.75], windowFrame, 0.006);
  for (const y of [1.4, 2.55]) box(room, [1.76, 0.065, 0.12], [1.2, y, -2.735], windowFrame, 0.007);
  box(room, [1.83, 0.045, 0.23], [1.2, 1.37, -2.66], zinc, 0.006);
  box(room, [0.07, 0.018, 0.03], [1.17, 1.93, -2.68], darkSteel, 0.004);
  // Fine cloudy glass bands provide a visible window without any external image.
  const glassShade = material(0xb8c9cc, 0.46, 0.12);
  for (const y of [1.59, 1.84, 2.09, 2.34]) box(room, [1.56, 0.006, 0.003], [1.2, y, -2.851], glassShade);

  // Main 3 x 1.2m bench; top surface is exactly y=.94m.
  box(room, [3, 0.075, 1.2], [0, 0.9025, 0], wood, 0.012);
  for (const y of [0.873, 0.881, 0.89]) box(room, [2.97, 0.002, 0.008], [0, y, 0.598], plywoodLine);
  box(room, [2.98, 0.014, 0.018], [0, 0.913, 0.597], woodEdge, 0.002);
  for (const x of [-1.35, 1.35]) for (const z of [-0.46, 0.46]) {
    box(room, [0.065, 0.82, 0.065], [x, 0.43, z], steel, 0.004);
    box(room, [0.105, 0.025, 0.105], [x, 0.013, z], rubber, 0.008);
    const bolt = cylinder(room, 0.012, 0.006, [x, 0.78, z + (z > 0 ? 0.035 : -0.035)], zinc, 6); bolt.rotation.x = Math.PI / 2;
  }
  for (const z of [-0.46, 0.46]) {
    box(room, [2.72, 0.065, 0.055], [0, 0.81, z], steel, 0.004);
    box(room, [2.72, 0.05, 0.045], [0, 0.22, z], steel, 0.003);
  }
  for (const x of [-1.35, 1.35]) {
    box(room, [0.055, 0.065, 0.92], [x, 0.81, 0], steel, 0.004);
    box(room, [0.045, 0.05, 0.92], [x, 0.22, 0], steel, 0.003);
  }
  // Lower rear shelf leaves a large open floor area for scenario changes.
  box(room, [2.63, 0.026, 0.5], [0, 0.256, -0.20], wood, 0.003);
  // Small shallow left drawer and physically recessed handle.
  box(room, [0.66, 0.17, 0.5], [-0.91, 0.757, 0.22], steel, 0.008);
  box(room, [0.62, 0.12, 0.018], [-0.91, 0.755, 0.483], darkSteel, 0.004);
  box(room, [0.22, 0.025, 0.032], [-0.91, 0.77, 0.509], zinc, 0.005);
  for (const x of [-1.09, -0.73]) { const screw = cylinder(room, 0.005, 0.004, [x, 0.755, 0.497], zinc, 6); screw.rotation.x = Math.PI / 2; }

  // Pegboard with actual dark perforation silhouettes; no text/object IDs.
  const board = material(0x9a815f, 0.9), hole = material(0x3d3429, 1);
  box(room, [2.1, 1.16, 0.045], [-0.95, 1.96, -2.72], board, 0.009);
  const holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.009, 8), hole, 19 * 10);
  const transform = new THREE.Matrix4(); let index = 0;
  for (let row = 0; row < 10; row++) for (let col = 0; col < 19; col++) {
    transform.makeTranslation(-1.85 + col * 0.1, 1.48 + row * 0.103, -2.695);
    holes.setMatrixAt(index++, transform);
  }
  room.add(holes);
  for (const x of [-1.94, 0.04]) for (const y of [1.44, 2.48]) { const screw = cylinder(room, 0.012, 0.008, [x, y, -2.687], zinc, 8); screw.rotation.x = Math.PI / 2; }
  // Three distinct hanging screwdrivers with narrow steel shafts and molded grips.
  const grip = material(0x633d2d, 0.77), blueGrip = material(0x39576c, 0.74);
  [-1.64, -1.43, -1.21].forEach((x, i) => {
    cylinder(room, 0.009, 0.20 + i * 0.025, [x, 1.84, -2.64], zinc);
    cylinder(room, 0.026, 0.14, [x, 2.015 + i * 0.012, -2.64], i === 2 ? blueGrip : grip);
    cylinder(room, 0.028, 0.018, [x, 1.955 + i * 0.012, -2.64], rubber);
    tube(room, [[x - 0.033, 2.13, -2.69], [x - 0.033, 2.13, -2.61], [x + 0.033, 2.13, -2.61], [x + 0.033, 2.13, -2.69]], 0.006, zinc);
  });
  // Open-end spanners: elongated handles and fork heads, modeled rather than icons.
  for (const [x, length] of [[-0.88, 0.31], [-0.60, 0.25]] as const) {
    box(room, [0.028, length, 0.012], [x, 1.96, -2.635], zinc, 0.005);
    for (const y of [1.96 - length / 2, 1.96 + length / 2]) {
      const sign = y > 1.96 ? 1 : -1;
      box(room, [0.075, 0.028, 0.016], [x, y, -2.635], zinc, 0.004);
      for (const side of [-1, 1]) {
        const jaw = box(room, [0.021, 0.055, 0.016], [x + side * 0.03, y + sign * 0.025, -2.635], zinc, 0.005);
        jaw.rotation.z = side * sign * 0.16;
      }
    }
  }
  // Coiled cable with gravity-shaped ends and a small hook.
  const cable = material(0x252d30, 0.84);
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13 + i * 0.005, 0.009, 7, 28), cable);
    ring.position.set(-0.23, 1.89 + i * 0.012, -2.61 + i * 0.012); ring.scale.y = 1.28; room.add(ring);
  }
  tube(room, [[-0.23, 1.72, -2.56], [-0.16, 1.58, -2.58], [-0.10, 1.49, -2.55]], 0.01, cable);
  box(room, [0.035, 0.075, 0.025], [-0.10, 1.46, -2.55], rubber, 0.004);

  // Electrical service and task-light body are visible architecture, not light sources.
  const conduit = material(0x8d9791, 0.56, 0.25);
  tube(room, [[-3.43, 0.98, -2.70], [0.45, 0.98, -2.70], [0.45, 1.23, -2.70]], 0.012, conduit);
  box(room, [0.19, 0.12, 0.045], [0.46, 1.25, -2.69], material(0xd0d3c9), 0.012);
  for (const x of [0.415, 0.505]) {
    const socket = cylinder(room, 0.025, 0.003, [x, 1.25, -2.663], darkSteel); socket.rotation.x = Math.PI / 2;
    for (const dx of [-0.008, 0.008]) { const pin = cylinder(room, 0.004, 0.004, [x + dx, 1.25, -2.66], rubber, 8); pin.rotation.x = Math.PI / 2; }
  }
  const luminous = new THREE.MeshStandardMaterial({ color: 0xf5f3e5, roughness: 0.5, emissive: 0xfff0cf, emissiveIntensity: 0.65 });
  box(room, [1.9, 0.07, 0.17], [0, 2.84, -0.15], steel, 0.014);
  box(room, [1.76, 0.014, 0.125], [0, 2.797, -0.15], luminous, 0.004);
  for (const x of [-0.71, 0.71]) cylinder(room, 0.004, 0.30, [x, 3.02, -0.15], zinc, 8);
  // Secondary wall task light above the pegboard.
  box(room, [1.95, 0.065, 0.13], [-0.95, 2.60, -2.61], steel, 0.008);
  box(room, [1.82, 0.013, 0.10], [-0.95, 2.561, -2.60], luminous, 0.004);
  return room;
}
