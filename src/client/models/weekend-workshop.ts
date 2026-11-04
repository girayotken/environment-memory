import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {createHobbyStudioRoom} from './hobby-studio-room';
import {createHobbyStudioProps} from './hobby-studio-props';
import {createWeekendStorageScenario} from './weekend-storage-scenario';

type V3 = [number, number, number];

/** Authored scene only. Names and construction state are never observer evidence. */
export function createWeekendWorkshop() {
  const room = createHobbyStudioRoom(), old = createHobbyStudioProps();
  const group = old.group;
  group.name = 'weekend-workshop-props';
  // Retain the surrounding accumulated supplies, clear the old display-like bench.
  // Replaced geometries are disposed because they never reach Workshop.dispose().
  const removed: THREE.Object3D[] = [];
  for (const object of [...group.children]) {
    const p=object.position;
    const packingClear=p.y>.8 && p.y<1 && p.x>1.92 && p.x<2.57 && p.z>-1.49 && p.z<-1.20;
    const shelfClear=p.y>=.95 && p.y<1.12 && p.x>-2.56 && p.x<-2.18 && p.z>-1.9 && p.z<-1.4;
    if (object !== old.drill && object !== old.blueCase && ((p.y > .8 && p.x < 1.4 && p.z > -.65) || packingClear || shelfClear)) {
      group.remove(object); removed.push(object);
    }
  }
  const retainedGeometry = new Set<THREE.BufferGeometry>();
  group.traverse(o => {if (o instanceof THREE.Mesh) retainedGeometry.add(o.geometry);});
  removed.forEach(o => o.traverse(m => {if (m instanceof THREE.Mesh && !retainedGeometry.has(m.geometry)) m.geometry.dispose();}));

  const material = (color:number, metalness=0) => new THREE.MeshStandardMaterial({color, roughness:metalness ? .43 : .82, metalness});
  const board=material(0xc8af87), card=material(0xe8dfc8), cut=material(0xb29d7b), wood=material(0xc49b65);
  const dark=material(0x353b3c), steel=material(0x9ba7ad,.7), blue=material(0x4f7185), red=material(0xa4543c);
  const green=material(0x365b50), pencil=material(0x7c817a), yellow=material(0xe4bb56);
  function box(parent:THREE.Object3D,size:V3,pos:V3,m:THREE.Material) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),m);mesh.position.set(...pos);
    mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function cylinder(parent:THREE.Object3D,r:number,h:number,pos:V3,m:THREE.Material,top=r) {
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(top,r,h,20),m);mesh.position.set(...pos);
    mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function tapeRoll(parent:THREE.Object3D, outer:number, inner:number, height:number, pos:V3, m:THREE.Material) {
    const shape=new THREE.Shape();shape.absarc(0,0,outer,0,Math.PI*2,false);
    const hole=new THREE.Path();hole.absarc(0,0,inner,0,Math.PI*2,true);shape.holes.push(hole);
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,curveSegments:32}),m);
    mesh.rotation.x=-Math.PI/2;mesh.position.set(...pos);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function item(name:string,x:number,z:number,angle=0,y=.921) {
    const g=new THREE.Group();g.name=name;g.position.set(x,y,z);g.rotation.y=angle;group.add(g);return g;
  }
  function line(parent:THREE.Object3D,points:V3[],radius:number,m:THREE.Material,smooth=false) {
    const vertices=points.map(p=>new THREE.Vector3(...p));
    const path=new THREE.CurvePath<THREE.Vector3>();
    for(let i=1;i<vertices.length;i++)path.add(new THREE.LineCurve3(vertices[i-1],vertices[i]));
    const curve=smooth?new THREE.CatmullRomCurve3(vertices):path;
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,24,radius,6,false),m);mesh.castShadow=true;parent.add(mesh);return mesh;
  }
  function timber(parent:THREE.Object3D,a:V3,b:V3,width:number) {
    const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b);
    const mesh=box(parent,[width,from.distanceTo(to),width],[0,0,0],wood);
    mesh.position.copy(from).add(to).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),to.sub(from).normalize());
  }
  function tray(name:string,x:number,z:number,w:number,d:number,angle=0) {
    const t=item(name,x,z,angle);box(t,[w,.009,d],[0,.0045,0],card);
    for(const xx of [-w/2,w/2])box(t,[.009,.065,d],[xx,.036,0],card);
    for(const zz of [-d/2,d/2])box(t,[w,.065,.009],[0,.036,zz],card);
    return t;
  }
  // Working surface: the model occupies the far side, leaving a cutting lane.
  const mat=item('used-cutting-mat',-.12,-.04,-.035);
  box(mat,[1.08,.005,.70],[0,.0025,0],green);
  for(let x=-.50;x<=.501;x+=.05)box(mat,[.0008,.0005,.65],[x,.0055,0],pencil);
  for(let z=-.30;z<=.301;z+=.05)box(mat,[1.03,.0005,.0008],[0,.0055,z],pencil);
  const model=item('unfinished-house',-.14,-.20,-.07,.927);
  box(model,[.48,.014,.32],[0,.007,0],board);
  box(model,[.42,.008,.27],[0,.018,0],card);
  // Thin foamboard walls, with two cut-through openings and fitted balsa frames.
  box(model,[.42,.06,.005],[0,.052,-.13],card);
  box(model,[.42,.025,.005],[0,.1945,-.13],card);
  for(const x of [-.165,0,.165])box(model,[.09,.10,.005],[x,.132,-.13],card);
  box(model,[.005,.185,.265],[-.2075,.1145,0],card);
  box(model,[.005,.09,.12],[.2075,.067,-.075],card);
  for(const x of [-.0825,.0825]) {
    for(const dx of [-.036,.036])box(model,[.004,.096,.004],[x+dx,.132,-.1255],wood);
    for(const y of [.086,.178])box(model,[.076,.004,.004],[x,y,-.1255],wood);
    box(model,[.004,.088,.004],[x,.132,-.1255],wood);
  }
  // A few installed roof timbers describe the pitched roof; the rest is open.
  for(const x of [-.207,.16]) {
    timber(model,[x,.207,-.13],[x,.29,0],.006);
    timber(model,[x,.29,0],[x,.207,.13],.006);
  }
  timber(model,[.16,.022,.13],[.16,.207,.13],.006);
  timber(model,[-.207,.29,0],[.16,.29,0],.006);
  timber(model,[-.207,.207,-.13],[.16,.207,-.13],.006);
  for(const z of [-.09,.04])box(model,[.022,.035,.001],[-.19,.10,z],yellow).rotation.y=Math.PI/2;
  // Completed window frames set to one side; the next frame is being assembled.
  function frame(parent:THREE.Object3D,x:number,z:number,angle:number,y=.0025) {
    const f=new THREE.Group();f.position.set(x,y,z);f.rotation.y=angle;parent.add(f);
    for(const xx of [-.033,.033])box(f,[.006,.005,.092],[xx,0,0],wood);
    for(const zz of [-.043,.043])box(f,[.072,.005,.006],[0,0,zz],wood);
    box(f,[.004,.005,.086],[0,0,0],wood);return f;
  }
  const completed=item('finished-window-frames',-.47,.12,.06,.927);
  frame(completed,0,0,0);frame(completed,.035,.018,-.22,.0075);
  const assembly=item('window-being-glued',-.08,.18,-.09,.927);frame(assembly,0,0,.06);
  // Mini clamp holds one joint, rather than a decorative isolated tool.
  box(assembly,[.018,.021,.055],[.037,.016,.025],blue);
  box(assembly,[.045,.005,.008],[.047,.03,.038],steel);
  const screw=cylinder(assembly,.003,.035,[.064,.019,.036],steel);screw.rotation.z=Math.PI/2;
  // Stock on left, measured pieces beside the rule, waste in an offcut lid.
  const stock=item('balsa-strip-bundle',-.91,-.20,.08);
  for(let i=0;i<8;i++)box(stock,[.012,.009,.45+(i%3)*.025],[(i%4)*.016,.005+Math.floor(i/4)*.01,0],wood);
  // The opened bundle fans toward the work; two pieces have already been measured.
  stock.children.slice(4).forEach((o,i)=>{o.rotation.y=(i-1)*.045;o.position.z+=i*.012;});
  const measured=item('measured-roof-strips',-.48,-.17,.20,.927);
  for(let i=0;i<3;i++)box(measured,[.009,.006,.16],[i*.018,.003,-i*.008],wood);
  const rule=item('ruler-at-last-cut',.20,.17,-.11,.927);
  box(rule,[.33,.003,.028],[0,.0015,0],steel);
  for(let i=0;i<31;i++)box(rule,[.0007,.0005,i%5===0?.013:.007],[-.15+i*.01,.0034,.006],dark);
  box(rule,[.14,.005,.008],[-.04,.003,-.025],wood);
  const knife=item('knife-beside-cut',.31,.27,-.40,.927);
  const handle=new THREE.Mesh(new RoundedBoxGeometry(.12,.014,.020,3,.006),blue);
  handle.position.set(0,.007,0);handle.castShadow=handle.receiveShadow=true;knife.add(handle);
  box(knife,[.035,.002,.012],[.075,.007,0],steel);
  box(knife,[.022,.002,.009],[-.012,.015,0],dark);
  const graphite=item('pencil-by-rule',.23,.07,-.23,.927);
  const shaft=cylinder(graphite,.0035,.17,[0,.004,0],yellow);shaft.rotation.z=Math.PI/2;
  const tip=cylinder(graphite,.0035,.015,[.092,.004,0],cut,0);tip.rotation.z=-Math.PI/2;
  const waste=tray('offcuts-in-box-lid',-.88,.26,.29,.22,-.17);
  for(let i=0;i<9;i++)box(waste,[.025+(i%3)*.025,.004,.01],[-.10+(i%3)*.075,.012+Math.floor(i/3)*.005,-.06+Math.floor(i/3)*.05],wood).rotation.y=i*.71;
  const loose=item('recent-cutoffs',-.57,.28,-.1,.927);
  for(const [x,z,a] of [[0,0,.7],[.04,-.02,-.4],[-.02,.035,1.1]])box(loose,[.035,.003,.007],[x,.0015,z],wood).rotation.y=a;
  // Open glue and its detached cap sit just outside the cutting patch.
  const glue=item('open-glue-bottle',.54,-.04,.12);
  const bottle=new THREE.Mesh(new RoundedBoxGeometry(.055,.085,.043,3,.009),card);
  bottle.position.set(0,.0425,0);bottle.castShadow=bottle.receiveShadow=true;glue.add(bottle);
  cylinder(glue,.017,.012,[0,.091,0],card,.011);cylinder(glue,.011,.025,[0,.1095,0],card,.003);
  box(glue,[.036,.033,.001],[0,.048,.022],blue);
  cylinder(glue,.012,.019,[.061,.0095,.015],red,.006);
  const tape=item('tape-with-pulled-end',.50,-.22,.4);
  tapeRoll(tape,.041,.021,.018,[0,0,0],yellow);
  box(tape,[.065,.001,.018],[.054,.001,.006],yellow).rotation.y=.18;
  // Referenced sketch propped on a carton, with an unfinished revision on paper.
  const plans=item('propped-working-drawing',-.69,-.44,-.12);
  box(plans,[.24,.11,.10],[0,.055,-.04],card);
  const drawing=new THREE.Group();drawing.position.set(0,.015,.036);drawing.rotation.x=-.22;plans.add(drawing);
  box(drawing,[.24,.24,.002],[0,.12,0],card);
  line(drawing,[[-.08,.07,.002],[-.08,.18,.002],[.08,.18,.002],[.08,.07,.002],[-.08,.07,.002]],.0007,blue);
  line(drawing,[[-.025,.07,.002],[-.025,.14,.002],[.08,.14,.002]],.0007,pencil);
  line(drawing,[[.025,.07,.002],[.025,.11,.002],[.08,.11,.002]],.0007,pencil);
  line(drawing,[[-.09,.04,.002],[.09,.04,.002]],.0006,pencil);
  for(const x of [-.09,.09])line(drawing,[[x,.032,.002],[x,.049,.002]],.0006,pencil);
  line(drawing,[[-.01,.025,.002],[.02,.033,.002],[-.02,.033,.002],[.015,.024,.002]],.0008,red);
  // A larger dog-eared plan is partly trapped under the model's base.
  const plan=item('plan-under-model',.19,-.35,.16,.927);
  box(plan,[.29,.001,.20],[0,.0005,0],card);
  for(const x of [-.10,.10])box(plan,[.001,.0005,.13],[x,.0015,0],pencil);
  for(const z of [-.065,.065])box(plan,[.20,.0005,.001],[0,.0015,z],pencil);
  box(plan,[.001,.0005,.13],[.01,.0015,0],blue);
  box(plan,[.10,.0005,.001],[.05,.0015,.015],blue);
  for(let i=0;i<4;i++)box(plan,[.038,.0005,.001],[-.07,.0015,-.035+i*.014],pencil);
  box(plan,[.035,.001,.04],[.127,.007,.08],card).rotation.z=.35;
  // A phone and mug occupy a small personal corner.
  const phone=item('phone-outside-work-area',1.01,-.22,-.16);
  box(phone,[.077,.010,.15],[0,.005,0],dark);box(phone,[.068,.001,.133],[0,.011,0],steel);
  const mug=group.children.find(o=>o.position.x===2.78 && o.position.z===-1.27);
  if(mug)mug.position.set(.79,.921,-.47);
  old.drill.position.set(.86,.94,.27);old.drill.rotation.y=-.22;
  // The reused tool has its origin above the battery's lowest face.
  old.drill.updateMatrixWorld(true);
  old.drill.position.y += .921 - new THREE.Box3().setFromObject(old.drill).min.y;
  // Pull chair back as if the maker has just left, preserving its assembled frame.
  const chair=new THREE.Group();chair.position.set(0,0,1.2);room.add(chair);room.updateMatrixWorld(true);
  for(const part of [...room.children])if(part!==chair && part.position.z>.8 && part.position.y<1.1 && Math.abs(part.position.x)<.5)chair.attach(part);
  chair.position.x=.20;chair.position.z=1.53;chair.rotation.y=-.14;
  // The recently opened drawer has depth and contents, not just a shifted face.
  for(const part of room.children)if(part.position.x>.3 && (Math.abs(part.position.z-.518)<.001 || Math.abs(part.position.z-.536)<.001))part.position.z+=.12;
  const drawer=new THREE.Group();drawer.name='half-open-supply-drawer';room.add(drawer);
  box(drawer,[1.03,.012,.40],[.57,.70,.43],board);
  for(const x of [.062,1.078])box(drawer,[.014,.09,.40],[x,.751,.43],board);
  box(drawer,[1.002,.09,.014],[.57,.751,.237],board);
  box(drawer,[.17,.018,.11],[.26,.715,.38],card).rotation.y=.09;
  box(drawer,[.17,.003,.11],[.27,.7255,.41],card).rotation.y=-.14;
  for(let i=0;i<2;i++) {
    tapeRoll(drawer,.049,.027,.018,[.48+i*.105,.706,.44],i?yellow:card);
  }
  for(let i=0;i<4;i++)box(drawer,[.16,.006,.007],[.80+i*.012,.709,.41+i*.018],i%2?wood:yellow).rotation.y=.15-i*.08;
  box(drawer,[.18,.009,.12],[.96,.7105,.52],green).rotation.y=.17;
  // Standing foamboard and a drawing pinned under the window connect the room to the project.
  const sheets=item('leaning-foamboard',-1.55,-2.18,.04,.015);sheets.rotation.x=-.14;
  for(let i=0;i<3;i++)box(sheets,[.43-i*.045,.83-i*.07,.012],[i*.024,(.83-i*.07)/2,i*.023],i===1?board:card);
  const wallPlans=new THREE.Group();wallPlans.name='working-sketches';wallPlans.position.set(-.62,1.27,-2.475);room.add(wallPlans);
  box(wallPlans,[.74,.43,.016],[0,0,.015],board);
  for(let i=0;i<2;i++) {
    const sheet=new THREE.Group();sheet.position.set(-.18+i*.34,.01,.026);sheet.rotation.z=i===0?.045:-.06;wallPlans.add(sheet);
    box(sheet,[.27,.32,.002],[0,0,0],card);
    if(i===0) {
      line(sheet,[[-.09,-.075,.002],[-.09,.075,.002],[.09,.075,.002],[.09,-.075,.002],[-.09,-.075,.002]],.0007,blue);
      line(sheet,[[-.03,-.075,.002],[-.03,.025,.002],[.09,.025,.002]],.0006,pencil);
      line(sheet,[[.035,-.075,.002],[.035,-.025,.002],[.09,-.025,.002]],.0006,pencil);
    } else {
      line(sheet,[[-.09,-.065,.002],[-.09,.035,.002],[0,.105,.002],[.09,.035,.002],[.09,-.065,.002],[-.09,-.065,.002]],.0007,blue);
      for(const x of [-.045,.045])line(sheet,[[x-.016,-.03,.002],[x-.016,.015,.002],[x+.016,.015,.002],[x+.016,-.03,.002],[x-.016,-.03,.002]],.0006,pencil);
    }
    line(sheet,[[-.105,-.10,.002],[.105,-.10,.002]],.0006,pencil);
    for(const x of [-.09,.09])line(sheet,[[x,-.11,.002],[x,-.085,.002]],.0006,pencil);
    box(sheet,[.04,.025,.003],[0,.15,.003],yellow);
  }
  // An open carry carton below the bench explains the loose packaging.
  const packing=item('open-packing-carton',-1.76,.16,-.13,0);
  box(packing,[.42,.012,.34],[0,.006,0],cut);
  for(const x of [-.21,.21])box(packing,[.01,.29,.34],[x,.15,0],cut);
  for(const z of [-.17,.17])box(packing,[.42,.29,.01],[0,.15,z],cut);
  for(const side of [-1,1])box(packing,[.22,.009,.34],[side*.29,.32,0],cut).rotation.z=side*.32;
  box(packing,[.26,.035,.21],[0,.035,0],card);
  const scenario=createWeekendStorageScenario(); group.add(scenario.group);
  return {room,group,drill:old.drill,blueCase:old.blueCase,scenario};
}
