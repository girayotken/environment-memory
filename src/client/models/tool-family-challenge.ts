import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Evaluation/operator geometry only. No names, poses or target types enter capture(). */
export function createToolFamilyChallenge(template:THREE.Group){
  const group=new THREE.Group();group.visible=false;
  const yellow=new THREE.MeshStandardMaterial({color:0xd8a52d,roughness:.5});
  const rubber=new THREE.MeshStandardMaterial({color:0x202327,roughness:.9});
  const steel=new THREE.MeshStandardMaterial({color:0x9ba5aa,roughness:.32,metalness:.8});
  const red=new THREE.MeshStandardMaterial({color:0x9e3930,roughness:.55});
  const add=(parent:THREE.Object3D,geometry:THREE.BufferGeometry,material:THREE.Material,p:[number,number,number])=>{
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...p);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const box=(parent:THREE.Object3D,size:[number,number,number],p:[number,number,number],mat:THREE.Material,r=.006)=>add(parent,new RoundedBoxGeometry(...size,2,r),mat,p);
  const shaft=(parent:THREE.Object3D,r:number,length:number,p:[number,number,number],mat:THREE.Material,sides=24)=>{
    const mesh=add(parent,new THREE.CylinderGeometry(r,r,length,sides),mat,p);mesh.rotation.z=Math.PI/2;return mesh;
  };
  const clone=(colour:number)=>{
    const object=template.clone(true);object.traverse(child=>{
      if(!(child instanceof THREE.Mesh))return;
      const change=(mat:THREE.Material)=>{
        if(!(mat instanceof THREE.MeshStandardMaterial)||mat.color.getHex()!==0x275a65)return mat;
        const copy=mat.clone();copy.color.setHex(colour);return copy;
      };
      child.material=Array.isArray(child.material)?child.material.map(change):change(child.material);
    });return object;
  };
  const drill=clone(0xd8a52d),replacement=clone(0x2d5b86);
  const impact=new THREE.Group();
  box(impact,[.12,.045,.083],[.045,.024,0],rubber);
  box(impact,[.09,.014,.071],[.045,.051,0],yellow);
  box(impact,[.048,.115,.053],[.038,.115,0],yellow);
  box(impact,[.023,.105,.058],[.052,.112,0],rubber);
  for(const z of [-.03,.03])for(let i=0;i<5;i++)box(impact,[.032,.004,.003],[.035,.078+i*.014,z],rubber,.001);
  box(impact,[.115,.078,.079],[.025,.205,0],yellow,.015);
  box(impact,[.026,.068,.073],[.088,.205,0],rubber,.008);
  box(impact,[.02,.032,.038],[.005,.16,0],rubber);
  shaft(impact,.032,.035,[-.047,.205,0],steel);
  shaft(impact,.015,.032,[-.079,.205,0],rubber,6);
  shaft(impact,.0036,.045,[-.115,.205,0],steel,6);
  for(const z of [-.041,.041])for(let i=0;i<4;i++)box(impact,[.004,.022,.002],[.037+i*.009,.208,z],rubber,.0005);
  const inline=new THREE.Group();
  shaft(inline,.027,.145,[0,.029,0],red);
  shaft(inline,.029,.027,[.084,.029,0],rubber);
  shaft(inline,.021,.027,[-.084,.029,0],rubber);
  shaft(inline,.01,.023,[-.108,.029,0],steel,6);
  shaft(inline,.003,.075,[-.153,.029,0],steel,6);
  box(inline,[.031,.008,.018],[-.023,.056,0],rubber,.003);
  for(const x of [.025,.04,.055])shaft(inline,.0275,.004,[x,.029,0],rubber);
  box(inline,[.009,.009,.012],[.099,.029,0],rubber,.002);
  const corded=new THREE.Group(),body=clone(0x2d5b86);
  // A side-resting drill without the battery pack; real cord/plug, no identity marks.
  for(const child of [...body.children])if(child instanceof THREE.Mesh&&child.position.y<.075)body.remove(child);
  body.position.set(0,.045,0);body.rotation.set(Math.PI/2,0,0);corded.add(body);
  const cordPoints=[[.05,.045,.075],[.08,.012,.18],[.18,.01,.24],[.27,.01,.13],[.19,.01,.04],[.07,.01,.13],[-.03,.01,.25],[-.17,.01,.22]] as [number,number,number][];
  add(corded,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cordPoints.map(p=>new THREE.Vector3(...p))),48,.0045,8,false),rubber,[0,0,0]);
  box(corded,[.04,.024,.024],[-.19,.015,.22],rubber,.004);
  for(const z of [.214,.226])box(corded,[.018,.004,.003],[-.218,.015,z],steel,.0005);
  group.add(drill,impact,inline,corded,replacement);
  const pose=(o:THREE.Group,p:[number,number,number],yaw:number)=>{o.position.set(...p);o.rotation.set(0,yaw,0);o.visible=true;};
  return {group,prepare(visit:1|2|3){
    group.visible=true;[drill,impact,inline,corded,replacement].forEach(o=>o.visible=false);
    if(visit===1){
      pose(drill,[-.85,.94,.32],.1);pose(impact,[-.2,.94,.42],-.25);
      pose(inline,[.4,.94,.43],.5);pose(corded,[.82,.94,-.27],-.15);
    }else if(visit===2){
      pose(drill,[.75,.94,.38],-.4);pose(impact,[-.72,.94,-.13],.4);
      pose(inline,[-.13,.94,.5],-.4);pose(corded,[.3,.94,-.27],.2);
    }else{
      pose(impact,[.12,.94,.42],-.2);pose(inline,[-.72,.94,.35],.65);
      pose(replacement,[.83,.94,-.2],-.25);
    }
  }};
}
