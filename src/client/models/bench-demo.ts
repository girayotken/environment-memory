import * as THREE from 'three';
import {createHobbyStudioRoom} from './hobby-studio-room';
import {createHobbyStudioProps} from './hobby-studio-props';
type V3=[number,number,number];
/** Authored tabletop geometry; no inventory or simulator state goes to the observer. */
export function createBenchDemo() {
  const old=createHobbyStudioProps(), group=old.group, room=createHobbyStudioRoom();
  // Keep the room and accumulated shelves; replace only the near working surface.
  for(const o of [...group.children]) if(o.position.y>.8 && o.position.y<1.3 && o.position.x<1.45 && o.position.z>-.7) {
    group.remove(o); o.traverse(m=>{if(m instanceof THREE.Mesh)m.geometry.dispose();});
  }
  const mat=(color:number,metalness=0)=>new THREE.MeshStandardMaterial({color,metalness,roughness:metalness?.38:.75});
  const blue=mat(0x1766ad),orange=mat(0xe57929),black=mat(0x252b31),foam=mat(0x11171a),steel=mat(0xb9c4cc,.75),white=mat(0xf1eee0),green=mat(0x345b50),wood=mat(0xc7a66f),red=mat(0xb44435);
  function box(p:THREE.Object3D,s:V3,v:V3,m:THREE.Material){const o=new THREE.Mesh(new THREE.BoxGeometry(...s),m);o.position.set(...v);o.castShadow=o.receiveShadow=true;p.add(o);return o;}
  function cylinder(p:THREE.Object3D,r:number,h:number,v:V3,m:THREE.Material){const o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,20),m);o.position.set(...v);o.castShadow=true;p.add(o);return o;}
  function item(x:number,z:number,a=0){const o=new THREE.Group();o.position.set(x,.927,z);o.rotation.y=a;group.add(o);return o;}
  function wire(p:THREE.Object3D,points:V3[],m:THREE.Material,r=.002){const path=new THREE.CatmullRomCurve3(points.map(v=>new THREE.Vector3(...v)));const o=new THREE.Mesh(new THREE.TubeGeometry(path,24,r,6,false),m);p.add(o);}
  const cutting=item(0,-.02,-.025);box(cutting,[1.15,.006,.75],[0,0,0],green);
  const grid=mat(0x718d7c);for(let x=-.55;x<.56;x+=.05)box(cutting,[.0008,.001,.70],[x,.004,0],grid);for(let z=-.35;z<.36;z+=.05)box(cutting,[1.1,.001,.0008],[0,.004,z],grid);
  // Open case behind the loose working tools: hinge, foam, storage channels and latches.
  const toolcase=item(-.31,-.24,-.12);box(toolcase,[.43,.028,.27],[0,.014,0],black);box(toolcase,[.40,.008,.24],[0,.032,0],foam);
  for(const x of [-.21,.21])box(toolcase,[.012,.035,.27],[x,.032,0],black);
  for(const z of [-.13,.13])box(toolcase,[.42,.035,.012],[0,.032,z],black);
  const lid=new THREE.Group();lid.position.set(0,.025,-.135);lid.rotation.x=.88;toolcase.add(lid);
  box(lid,[.43,.018,.27],[0,.009,-.135],black);box(lid,[.39,.006,.23],[0,.021,-.135],foam);
  for(const x of [-.13,.13])box(toolcase,[.035,.014,.018],[x,.025,.145],steel);
  for(let i=0;i<7;i++){box(toolcase,[.018,.004,.085],[-.15+i*.05,.038,-.035],black);const bit=cylinder(toolcase,.006,.06,[-.15+i*.05,.046,-.035],steel);bit.rotation.x=Math.PI/2;box(toolcase,[.007,.007,.012],[-.15+i*.05,.046,-.074],steel);}
  box(toolcase,[.23,.016,.055],[-.03,.044,.075],blue);box(toolcase,[.036,.019,.055],[.103,.044,.075],orange);
  // The chosen precision screwdriver is out of its case, angled toward the repair.
  const driver=item(-.14,.22,-.30);
  const shaft=cylinder(driver,.004,.115,[.11,.016,0],steel);shaft.rotation.z=Math.PI/2;
  const grip=cylinder(driver,.017,.125,[-.005,.018,0],blue);grip.rotation.z=Math.PI/2;
  for(const x of [-.05,-.025,0,.025]){const ring=cylinder(driver,.0176,.004,[x,.018,0],black);ring.rotation.z=Math.PI/2;}
  const cap=cylinder(driver,.019,.026,[-.08,.019,0],orange);cap.rotation.z=Math.PI/2;
  box(driver,[.026,.007,.003],[.178,.016,0],steel);
  // Pliers have separated curved grips and tapered metal jaws.
  const pliers=item(.34,.22,.6);
  for(const sign of [-1,1]){wire(pliers,[[sign*.025,.014,.105],[sign*.035,.014,.045],[sign*.012,.014,0]],orange,.011);wire(pliers,[[sign*.012,.015,0],[sign*.018,.015,-.045],[sign*.007,.015,-.105]],steel,.007);}
  cylinder(pliers,.013,.015,[0,.018,0],steel);
  // Recognisable micro servo: mounting ears, gearbox, white horn, screws and lead.
  const servo=item(.19,.015,-.2);box(servo,[.074,.065,.042],[0,.039,0],blue);box(servo,[.1,.008,.033],[0,.053,0],blue);box(servo,[.065,.016,.038],[.002,.078,0],blue);
  cylinder(servo,.015,.014,[-.017,.093,0],white);box(servo,[.09,.006,.012],[-.017,.103,0],white);box(servo,[.012,.006,.052],[-.017,.103,0],white);cylinder(servo,.003,.007,[-.017,.108,0],steel);
  for(const x of [-.044,.044])cylinder(servo,.003,.002,[x,.058,0],steel);
  for(const [i,m] of [black,red,orange].entries())wire(servo,[[.036,.025,i*.004-.004],[.09,.009,.025+i*.004],[.105,.009,-.055+i*.004],[.18,.009,-.07+i*.004]],m,.0016);
  box(servo,[.018,.012,.025],[.186,.012,-.066],black);
  // Unfinished small robot chassis explains the servo and loose fasteners.
  const chassis=item(.31,-.26,.18);box(chassis,[.29,.012,.19],[0,.024,0],wood);
  for(const x of [-.10,.10])for(const z of [-.10,.10]){const wheel=cylinder(chassis,.043,.026,[x,.025,z],black);wheel.rotation.x=Math.PI/2;cylinder(chassis,.015,.028,[x,.025,z],steel).rotation.x=Math.PI/2;}
  box(chassis,[.10,.024,.075],[-.06,.042,-.015],black);box(chassis,[.065,.004,.065],[.035,.035,0],green);
  for(const x of [.08,.11])box(chassis,[.009,.035,.009],[x,.047,.065],steel);
  wire(chassis,[[-.02,.05,-.02],[.02,.065,-.05],[.08,.038,-.04]],red);
  for(const [x,z] of [[.02,.13],[.055,.15],[-.005,.16]]){const screw=cylinder(group,.004,.019,[x,.934,z],steel);screw.rotation.z=1.4;}
  // Move the reused drill outside the close composition; standard scene controls remain valid.
  old.drill.position.set(1.06,.94,-.39);group.add(old.drill);
  return {room,group,drill:old.drill,blueCase:old.blueCase,scenario:undefined};
}
