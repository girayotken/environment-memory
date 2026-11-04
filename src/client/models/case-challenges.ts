import * as THREE from 'three';

// Operator/evaluation only. Never serialize these cases, indices or poses to inference.
export type CaseChallenge = 'challenge-bands' | 'challenge-shapes' | 'challenge-duplicates';
export function createCaseChallenges(original: THREE.Group) {
  const group = new THREE.Group(); group.visible = false;
  const cases = Array.from({ length: 3 }, () => {
    const object = original.clone(true), marks = new THREE.Group(); object.add(marks); group.add(object);
    const red = new THREE.MeshStandardMaterial({ color: 0xd73d35, roughness: 0.8 });
    const green = new THREE.MeshStandardMaterial({ color: 0x36a96a, roughness: 0.8 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xf28d28, roughness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf9f5e7, roughness: 0.8 });
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, p: [number,number,number]) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...p); mesh.castShadow = mesh.receiveShadow = true; return mesh;
    };
    const bands = [red,green,orange].map(material => {
      const band = new THREE.Group();
      band.add(add(new THREE.BoxGeometry(0.065,0.003,0.29), material,[-0.105,0.151,0]));
      band.add(add(new THREE.BoxGeometry(0.065,0.115,0.003),material,[-0.105,0.088,0.159]));
      marks.add(band); return band;
    });
    const circle = new THREE.Group(); circle.add(add(new THREE.CylinderGeometry(0.075,0.075,0.003,32),white,[0,0.158,0]));
    const cross = new THREE.Group();
    cross.add(add(new THREE.BoxGeometry(0.15,0.003,0.035),white,[0,0.158,0]),add(new THREE.BoxGeometry(0.035,0.003,0.15),white,[0,0.159,0]));
    const triangle = new THREE.Group();
    const triangleMesh = add(new THREE.CylinderGeometry(0.095,0.095,0.003,3),white,[0,0.158,0]); triangleMesh.rotation.y = .3; triangle.add(triangleMesh);
    const shapes = [circle,cross,triangle]; marks.add(...shapes);
    return { object, marks: [...bands,...shapes] };
  });
  function prepare(challenge: CaseChallenge, returning: boolean) {
    group.visible = true;
    const top: [number,number,number][] = [[-.32,.94,.33],[.72,.94,.22],[.2,.94,-.28]];
    const below: [number,number,number] = [-.4,.27,.12];
    cases.forEach(({object,marks},i) => {
      object.visible = returning || challenge === 'challenge-duplicates' || i < 2;
      object.position.set(...top[i]); object.rotation.y = [-.25,.3,-.15][i];
      marks.forEach(mark => mark.visible = false);
      const mark = challenge === 'challenge-bands' ? [0,1,2][i] : challenge === 'challenge-shapes' ? i+3 : [0,0,1][i];
      marks[mark].visible = true;
    });
    if (returning) {
      const poses = challenge === 'challenge-bands' ? [below,top[1],top[0]] : [top[1],below,top[0]];
      cases.forEach(({object},i)=>{object.position.set(...poses[i]);object.rotation.y=[.2,-.3,.25][i];});
    } else if (challenge === 'challenge-bands') {
      cases[0].object.position.set(...top[1]); cases[1].object.position.set(...top[0]);
    }
  }
  return { group, prepare };
}
