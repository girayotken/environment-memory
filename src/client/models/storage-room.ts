import * as THREE from 'three';

/** Evaluator-owned scene. Only rendered pixels leave the simulator. */
export function createStorageRoom() {
 const group=new THREE.Group();
 const material=(color:number)=>new THREE.MeshStandardMaterial({color,roughness:.78});
 const wall=material(0xe5e0d4), wood=material(0x9b7350), cardboard=material(0xb88a52), blue=material(0x547d87), black=material(0x292d2d), grey=material(0x565a58), white=material(0xe6dfc7);
 const block=(parent:THREE.Object3D,w:number,h:number,d:number,mat:THREE.Material,x:number,y:number,z:number)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;};
 block(group,5,3,.1,wall,0,1.5,-1);block(group,5,.1,4,wood,0,-.05,0);
 // Two wide shelves make the before/after locations visible in a single frame.
 for(const y of [.55,1.18])block(group,2.2,.07,.8,wood,0,y,-.48);
 for(const x of [-1.08,1.08])block(group,.07,1.9,.8,wood,x,.94,-.48);
 const box=(x:number,y:number,mat:THREE.Material)=>{const container=new THREE.Group();container.position.set(x,y,-.46);group.add(container);const w=.82,d=.55,h=.22,t=.025;
  block(container,w,t,d,mat,0,t/2,0);block(container,w,h,t,mat,0,h/2,-d/2);block(container,w,h,t,mat,0,h/2,d/2);block(container,t,h,d,mat,-w/2,h/2,0);block(container,t,h,d,mat,w/2,h/2,0);
  const lid=block(container,w+.04,.035,d+.04,mat,0,h+.02,0);return {container,lid,h};};
 const target=box(-.49,1.22,cardboard), other=box(.49,1.22,blue);
 // Physical stripe distinguishes the closed target and remains attached when moved.
 block(target.container,.20,.06,.008,white,0,.15,.283);block(other.container,.18,.04,.008,white,0,.15,.283);
 const charger=new THREE.Group();target.container.add(charger);charger.position.set(-.12,.08,.02);
 block(charger,.23,.09,.15,black,0,.045,0);block(charger,.04,.02,.10,grey,.13,.065,0);
 const cable=new THREE.Mesh(new THREE.TorusGeometry(.09,.012,8,28),black);cable.rotation.x=Math.PI/2;cable.position.set(.18,.06,.03);target.container.add(cable);
 const adapter=new THREE.Group();other.container.add(adapter);adapter.position.set(0,.08,0);block(adapter,.22,.09,.15,grey,0,.045,0);block(adapter,.04,.02,.10,black,.125,.065,0);
 const initial=target.container.position.clone(), chargerInitial=charger.position.clone();let open=true,moved=false,removed=false;
 const setOpen=(value:boolean)=>{open=value;target.lid.visible=!value;other.lid.visible=!value;};setOpen(true);
 return {group,target,other,charger,adapter,cable,setOpen,toggleOpen(){setOpen(!open);return open;},moveBox(){moved=!moved;target.container.position.copy(initial);if(moved)target.container.position.set(-.48,.59,-.46);return moved;},takeCharger(){if(!removed){group.attach(charger);charger.position.set(.45,.64,-.12);removed=true;}},reset(){target.container.add(charger);charger.position.copy(chargerInitial);target.container.position.copy(initial);moved=false;removed=false;setOpen(true);},getState(){return {open,moved,removed};}};
}
