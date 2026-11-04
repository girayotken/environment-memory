import * as THREE from 'three';

/** Operator-only unmarked geometry. Never pass these references or poses to inference. */
export function createNaturalMemoryChallenge(caseTemplate:THREE.Group,drillTemplate:THREE.Group){
  const group=new THREE.Group();group.visible=false;
  const blueA=caseTemplate.clone(true),blueB=caseTemplate.clone(true),black=caseTemplate.clone(true);
  const teal=drillTemplate.clone(true),yellow=drillTemplate.clone(true);
  const recolour=(object:THREE.Group,colours:Map<number,number>)=>object.traverse(child=>{
    if(!(child instanceof THREE.Mesh))return;
    const change=(material:THREE.Material)=>{
      if(!(material instanceof THREE.MeshStandardMaterial))return material;
      const colour=colours.get(material.color.getHex());if(colour===undefined)return material;
      const copy=material.clone();copy.color.setHex(colour);return copy;
    };
    child.material=Array.isArray(child.material)?child.material.map(change):change(child.material);
  });
  recolour(black,new Map([[0x255078,0x303338],[0x19394f,0x202327]]));
  recolour(yellow,new Map([[0x275a65,0xd8a52d]]));yellow.scale.set(.88,.91,.95);
  group.add(blueA,blueB,black,teal,yellow);
  const pose=(object:THREE.Group,at:[number,number,number],yaw:number)=>{object.position.set(...at);object.rotation.set(0,yaw,0);object.visible=true;};
  return {group,prepare(visit:1|2|3){
    group.visible=true;[blueA,blueB,black,teal,yellow].forEach(object=>object.visible=false);
    if(visit===1){
      pose(blueA,[-.95,.94,.38],.12);pose(blueB,[.77,.94,-.22],-.18);
      pose(teal,[-.32,.94,.25],.18);pose(yellow,[.3,.94,.43],-.35);
    }else if(visit===2){
      pose(blueA,[.7,.27,.08],.1);pose(blueB,[-.6,.94,.3],.4);
      pose(teal,[.75,.94,.42],-.48);pose(yellow,[-.05,.94,-.18],.32);
    }else{
      pose(blueB,[.15,.94,.3],-.35);pose(black,[.85,.94,-.2],.22);
      pose(yellow,[-.72,.94,.4],-.12);
    }
  }};
}
