import * as THREE from 'three';
import { createHeroTools } from './hero-tools';
import { createStorageProps } from './storage-props';

type V3 = [number, number, number];

/** Portable objects in the authored model-making studio. Inventory is evaluator-only. */
export function createHobbyStudioProps(): { group: THREE.Group; drill: THREE.Group; blueCase: THREE.Group; inventory: Record<string, number> } {
  const group = new THREE.Group();
  const mat = (color: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness: .72, metalness });
  const dark = mat(0x323b3a), steel = mat(0xa6aaa5, .65), paper = mat(0xe5dfca), green = mat(0x344e42), cream = mat(0xd2c7a9), red = mat(0x9b4d3d), wood = mat(0xa27950), blue = mat(0x426884);
  dark.roughness = 0.92; steel.roughness = 0.38;
  const colors = [0xd6d0b5,0x565d4f,0x7c8067,0x384a48,0x9a6b4a,0x4b5662,0xa59574,0x71655b,0x879489,0xccc3aa,0x635b4d,0x7c8268].map(c => mat(c));
  function box(p: THREE.Object3D, size: V3, pos: V3, m: THREE.Material) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(...size), m); o.position.set(...pos); o.castShadow = true; o.receiveShadow = true; p.add(o); return o;
  }
  function cyl(p: THREE.Object3D, radius: number, height: number, pos: V3, m: THREE.Material, top = radius) {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(top, radius, height, 12), m); o.position.set(...pos); o.castShadow = true; p.add(o); return o;
  }
  function item(x: number, y: number, z: number, angle = 0) { const o = new THREE.Group(); o.position.set(x,y,z); o.rotation.y = angle; group.add(o); return o; }
  function restOn(o: THREE.Object3D, surface: number) {
    o.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(o);
    o.position.y += surface - bounds.min.y;
  }
  // Four compact, irregular rows of paint: jars and dropper bottles share some colours.
  for (let i = 0; i < 28; i++) {
    const row = Math.floor(i / 7), col = i % 7;
    const o = item(.84 + col * .145 + (row % 2) * .017, 1.38 + row * .25, -2.37 + (col % 3 - 1) * .012, (i % 5 - 2) * .09);
    const color = colors[i % colors.length];
    if (i % 3 === 0) {
      cyl(o,.025,.047,[0,.024,0],color); cyl(o,.026,.012,[0,.053,0],dark); box(o,[.037,.015,.002],[0,.029,.025],paper);
      cyl(o,.024,.002,[0,.060,0],cream); box(o,[.021,.002,.002],[0,.029,.026],dark);
    } else {
      cyl(o,.018,.057,[0,.029,0],color,.015); cyl(o,.013,.013,[0,.064,0],cream,.009); cyl(o,.006,.009,[0,.075,0],dark,.002);
      box(o,[.027,.017,.002],[0,.028,.019],paper);
      box(o,[.016,.002,.002],[0,.029,.020],dark);
    }
  }
  // Ten differently proportioned kit cartons, stacked on shelf tiers.
  const cartons = [blue,cream,red,green,paper];
  for (let i = 0; i < 10; i++) {
    const tier = Math.floor(i / 3), slot = i % 3;
    const x = i === 8 ? -2.72 : i === 9 ? -2.38 : -2.72 + slot * .34 + (tier % 2) * .025;
    const y = i === 8 ? 1.45 + .083 : i === 9 ? 1.45 + .097 : [.45,.95,1.45,1.95][tier];
    const w = .25 + (i % 3) * .027, h = .055 + (i % 4) * .014, d = .23 + (i % 2) * .05;
    const o = item(x,y,-1.68,(i % 3 - 1) * .055); box(o,[w,h,d],[0,h/2,0],cartons[i%cartons.length]);
    box(o,[w+.004,.008,d+.004],[0,h-.004,0],cartons[i%cartons.length]);
    box(o,[w*.92,.002,.002],[0,h-.010,d/2+.003],dark);
    box(o,[w*.82,.002,d*.76],[0,h+.001,0],paper);
    box(o,[w*.72,.003,d*.045],[0,h+.004,-d*.29],cartons[(i+2)%cartons.length]);
    // Simple aircraft or vehicle artwork, authored as flat shapes without branding.
    const ink = colors[(i+2)%colors.length];
    if (i % 2 === 0) {
      box(o,[w*.55,.003,d*.07],[0,h+.003,0],ink);
      box(o,[w*.17,.003,d*.48],[0,h+.003,0],ink);
      box(o,[w*.12,.003,d*.22],[-w*.21,h+.003,0],ink);
    } else {
      box(o,[w*.48,.003,d*.23],[0,h+.003,0],ink);
      box(o,[w*.23,.004,d*.16],[w*.03,h+.005,0],dark);
      for (const xx of [-w*.16,w*.16]) for (const zz of [-d*.13,d*.13]) box(o,[w*.08,.004,d*.06],[xx,h+.004,zz],dark);
    }
    box(o,[w*.72,h*.32,.002],[0,h*.55,d/2+.001],paper);
  }
  const { drill } = createHeroTools(); drill.position.set(.65,.94,.15); group.add(drill);
  const { blueCase } = createStorageProps(); blueCase.position.set(2.65,.92,-1.55); blueCase.rotation.y = .12; blueCase.scale.setScalar(.7); group.add(blueCase);
  // Cutting mat and partly assembled aircraft occupy one corner, leaving the move target clear.
  const matGroup = item(.05,.925,-.19,-.06); box(matGroup,[.65,.006,.4],[0,0,0],green);
  const grid = mat(0x6d8974); for(let x=-.3;x<=.301;x+=.05) box(matGroup,[.001,.001,.38],[x,.004,0],grid);
  for(let z=-.18;z<=.181;z+=.05) box(matGroup,[.63,.001,.001],[0,.004,z],grid);
  const cutMark = mat(0x94a995);
  for (const [x,z,length,angle] of [[-.18,-.09,.09,.35],[.17,.09,.065,-.45],[-.05,.13,.048,.2],[.23,-.12,.07,.65]]) {
    const mark = box(matGroup,[length,.001,.0015],[x,.005,z],cutMark); mark.rotation.y = angle;
  }
  const aircraft = item(.04,.94,-.22,.24); const plastic = mat(0xa4aaa5); plastic.side = THREE.DoubleSide;
  const body = cyl(aircraft,.012,.25,[0,.025,0],plastic,.023); body.rotation.z=-Math.PI/2;
  const wing = new THREE.Shape(); wing.moveTo(-.05,-.035); wing.lineTo(-.075,-.15); wing.lineTo(-.025,-.15); wing.lineTo(.045,-.025); wing.lineTo(.045,.025); wing.lineTo(-.025,.15); wing.lineTo(-.075,.15); wing.lineTo(-.05,.035); wing.closePath();
  const wingMesh = new THREE.Mesh(new THREE.ShapeGeometry(wing),plastic); wingMesh.rotation.x=-Math.PI/2; wingMesh.position.y=.025; wingMesh.castShadow = wingMesh.receiveShadow = true; aircraft.add(wingMesh);
  const tail = new THREE.Shape(); tail.moveTo(-.105,-.018); tail.lineTo(-.135,-.065); tail.lineTo(-.095,-.065); tail.lineTo(-.075,0); tail.lineTo(-.095,.065); tail.lineTo(-.135,.065); tail.lineTo(-.105,.018); tail.closePath();
  const tailMesh = new THREE.Mesh(new THREE.ShapeGeometry(tail),plastic); tailMesh.rotation.x=-Math.PI/2; tailMesh.position.y=.035; tailMesh.castShadow = tailMesh.receiveShadow = true; aircraft.add(tailMesh);
  const fin = new THREE.Shape(); fin.moveTo(-.125,.03); fin.lineTo(-.105,.075); fin.lineTo(-.07,.03); fin.closePath();
  const finMesh = new THREE.Mesh(new THREE.ShapeGeometry(fin),plastic); finMesh.castShadow = finMesh.receiveShadow = true; aircraft.add(finMesh);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(.018,12,8),mat(0x53666a, .15)); canopy.scale.set(1.8,.65,.8); canopy.position.set(.025,.043,0); aircraft.add(canopy);
  restOn(aircraft,.929);
  const sprue = item(-.38,.936,-.34,-.13);
  for (const z of [-.075,.075]) box(sprue,[.25,.006,.006],[0,0,z],plastic);
  for (const x of [-.125,0,.125]) box(sprue,[.006,.006,.15],[x,0,0],plastic);
  for (const x of [-.075,.055]) box(sprue,[.055,.008,.025],[x,.005,0],plastic);
  restOn(sprue,.921);
  // Small hand tools in functional clusters, each object has its own silhouette.
  function tool(x:number,z:number,a:number,kind:string) {
    const o=item(x,.938,z,a);
    if(kind==='scissors') {
      for (const side of [-1,1]) {
        const loop = new THREE.Mesh(new THREE.TorusGeometry(.016,.0035,8,16),dark);
        loop.rotation.x=Math.PI/2; loop.position.set(-.046,.009,side*.02); o.add(loop);
        const blade=box(o,[.085,.004,.007],[.03,.011,side*.006],steel); blade.rotation.y=side*.24;
      }
      cyl(o,.005,.009,[0,.012,0],steel);
    } else if(kind==='nippers'||kind==='pliers') {
      for(const s of [-1,1]) { const h=box(o,[.095,.012,.016],[-.035,.008,s*.022],red); h.rotation.y=s*.22; const jaw=box(o,[.055,.008,.011],[.039,.009,s*.009],steel); jaw.rotation.y=-s*.18; }
      cyl(o,.006,.009,[0,.01,0],steel);
      cyl(o,.003,.002,[0,.016,0],dark);
    } else if(kind==='knife') {
      box(o,[.105,.012,.014],[-.026,.009,0],blue);
      const shape=new THREE.Shape(); shape.moveTo(0,-.008); shape.lineTo(.045,0); shape.lineTo(0,.008); shape.closePath();
      const blade=new THREE.Mesh(new THREE.ShapeGeometry(shape),steel); blade.rotation.x=-Math.PI/2; blade.position.set(.027,.014,0); o.add(blade);
    } else if(kind==='pinvise') {
      const handle=cyl(o,.007,.11,[-.02,.009,0],steel); handle.rotation.z=Math.PI/2;
      for(let j=0;j<5;j++) {const ring=cyl(o,.008,.003,[-.055+j*.015,.009,0],dark); ring.rotation.z=Math.PI/2;}
      const tip=cyl(o,.002,.055,[.063,.009,0],steel,.001); tip.rotation.z=Math.PI/2;
    } else if(kind==='tweezers') { for(const s of [-1,1]) { const t=box(o,[.13,.004,.004],[0,.006,s*.009],steel); t.rotation.y=-s*.1; } }
    else if(kind==='ruler') { box(o,[.20,.003,.025],[0,.004,0],steel); for(let i=0;i<10;i++) box(o,[.001,.001,.008],[-.09+i*.02,.006,.006],dark); }
    else { const handle=kind==='brush'?wood:kind==='file'?dark:blue; box(o,[.105,.009,.009],[-.025,.008,0],handle); box(o,[.06,.005,.006],[.057,.008,0],kind==='brush'?cream:steel); }
    restOn(o,.921);
  }
  const tools: [number,number,number,string][] = [[-.85,-.38,.32,'nippers'],[-.76,-.27,-.3,'pliers'],[-.94,-.12,.44,'tweezers'],[-.83,.02,-.26,'file'],[-.96,.13,.19,'knife'],[-.75,.19,.43,'scissors'],[.34,-.45,.11,'ruler'],[.42,-.35,-.23,'pinvise'],[.37,-.25,.43,'brush'],[.46,-.17,.16,'brush'],[-1.05,-.35,-.3,'file']];
  tools.forEach(t=>tool(...t));
  // Glue, solvent, tape and sanding sticks on the separate paint desk.
  for(let i=0;i<4;i++) { const o=item(1.67+i*.105,.92,-1.34,(i-2)*.12); box(o,[.05,.085,.05],[0,.043,0],i<2?cream:colors[i]); cyl(o,.012,.028,[0,.097,0],i<2?red:dark,.007); box(o,[.035,.025,.002],[0,.05,.026],paper); }
  for(let i=0;i<2;i++) { const o=item(2.18+i*.105,.92,-1.37,.15*i); const ring=new THREE.Mesh(new THREE.TorusGeometry(.034,.012,8,20),cream); ring.rotation.x=Math.PI/2; ring.position.y=.014; o.add(ring); }
  for(let i=0;i<3;i++) { const o=item(2.37+i*.035,.926,-1.32,.28); box(o,[.15,.006,.018],[0,0,0],i===1?dark:cream); }
  // Caliper and two spring clips.
  const caliper=item(2.12,.93,-1.66,-.22); box(caliper,[.19,.006,.014],[0,0,0],steel); box(caliper,[.012,.008,.055],[-.075,.003,.02],steel); box(caliper,[.025,.01,.04],[.02,.005,.015],dark); restOn(caliper,.921);
  for(let i=0;i<2;i++) {const o=item(2.42+i*.075,.93,-1.7,i*.4); box(o,[.06,.012,.015],[0,.01,0],dark); box(o,[.04,.008,.014],[.015,.024,0],steel); restOn(o,.921);}
  const mug=item(2.78,.92,-1.27); cyl(mug,.037,.085,[0,.043,0],cream); cyl(mug,.029,.002,[0,.086,0],dark); const handle=new THREE.Mesh(new THREE.TorusGeometry(.022,.005,8,16),cream); handle.position.set(.039,.048,0); mug.add(handle);
  const notebook=item(2.58,.925,-1.24,-.12); box(notebook,[.19,.012,.13],[0,.006,0],paper); box(notebook,[.19,.003,.13],[0,.014,0],blue); restOn(notebook,.921);
  // Additional working kit. Contents of trays, open boxes and cups belong to their
  // parent group; they are not counted as separate portable inventory objects.
  const openKit = item(-.48,.921,-.43,.1);
  box(openKit,[.26,.014,.16],[0,.007,0],cream);
  for (const x of [-.125,.125]) box(openKit,[.01,.04,.16],[x,.027,0],cream);
  for (const z of [-.075,.075]) box(openKit,[.25,.04,.01],[0,.027,z],cream);
  box(openKit,[.20,.003,.11],[0,.016,0],paper);
  for (const x of [-.07,0,.07]) box(openKit,[.045,.006,.035],[x,.021,0],plastic);

  const tray = item(.75,.921,-.32,-.18);
  box(tray,[.22,.012,.14],[0,.006,0],dark);
  for (const x of [-.105,.105]) box(tray,[.01,.025,.14],[x,.018,0],dark);
  for (const z of [-.065,.065]) box(tray,[.21,.025,.01],[0,.018,z],dark);
  for (const [x,z] of [[-.055,-.025],[.005,.015],[.055,-.02]]) cyl(tray,.012,.008,[x,.017,z],plastic);

  const car = item(-.49,.921,.02,.22);
  box(car,[.19,.035,.09],[0,.037,0],plastic);
  box(car,[.09,.027,.075],[-.018,.068,0],plastic);
  for (const x of [-.065,.065]) for (const z of [-.047,.047]) { const wheel=cyl(car,.018,.012,[x,.02,z],dark); wheel.rotation.x=Math.PI/2; }
  box(car,[.04,.015,.002],[.025,.069,.039],blue);

  const spareSprue = item(-.32,.921,-.52,.19);
  for (const y of [.004,.013,.022]) {
    for (const z of [-.04,.04]) box(spareSprue,[.17,.004,.004],[0,y,z],plastic);
    for (const x of [-.085,0,.085]) box(spareSprue,[.004,.004,.08],[x,y,0],plastic);
    box(spareSprue,[.045,.005,.02],[.025,y+.003,0],plastic);
  }
  const vise = item(1.15,.921,.32,0);
  box(vise,[.16,.022,.13],[0,.011,0],steel); box(vise,[.11,.06,.095],[0,.052,0],blue);
  for (const x of [-.037,.037]) box(vise,[.025,.035,.095],[x,.099,0],steel);
  const spindle=cyl(vise,.009,.10,[.095,.06,0],steel); spindle.rotation.z=Math.PI/2;
  const viseHandle=cyl(vise,.004,.075,[.145,.06,0],steel); viseHandle.rotation.x=Math.PI/2;

  const brushCup = item(1.69,.921,-1.75,0);
  cyl(brushCup,.037,.10,[0,.05,0],blue,.043);
  for (const [x,z,tilt] of [[-.017,-.01,-.15],[.005,.005,.1],[.018,-.012,.2],[-.005,.017,-.05]]) {
    const brush=cyl(brushCup,.003,.18,[x,.155,z],wood); brush.rotation.z=tilt;
    cyl(brushCup,.004,.025,[x-tilt*.08,.25,z],cream,.002);
  }
  const airbrush = item(1.86,.921,-1.78,.35);
  const airBody=cyl(airbrush,.009,.14,[0,.015,0],steel); airBody.rotation.z=Math.PI/2;
  cyl(airbrush,.014,.025,[.015,.034,0],steel); cyl(airbrush,.004,.02,[-.025,.028,0],dark);
  const hose = item(2.05,.921,-1.82,0);
  const coil=new THREE.Mesh(new THREE.TorusGeometry(.055,.005,8,32),dark); coil.rotation.x=Math.PI/2; coil.position.y=.006; hose.add(coil);

  const saw = item(-1.08,.921,.31,.25);
  box(saw,[.15,.012,.035],[.025,.014,0],steel); box(saw,[.055,.025,.04],[-.073,.015,0],wood);
  const dispenser=item(2.2,.921,-1.7,.15);
  box(dispenser,[.11,.035,.075],[0,.018,0],blue);
  const tapeRoll=new THREE.Mesh(new THREE.TorusGeometry(.027,.009,8,20),cream); tapeRoll.position.set(-.015,.047,0); dispenser.add(tapeRoll);
  box(dispenser,[.025,.026,.07],[.045,.046,0],steel);
  const cloth=item(2.48,.921,-1.86,.2); box(cloth,[.14,.014,.10],[0,.007,0],cream); box(cloth,[.11,.007,.075],[.005,.017,0],paper);
  const paperRoll=item(2.65,.921,-1.9,.12); const roll=cyl(paperRoll,.029,.16,[0,.03,0],paper); roll.rotation.z=Math.PI/2;
  const rulerCase=item(-2.68,1.951,-1.66,.08); box(rulerCase,[.24,.035,.10],[0,.018,0],dark);
  const sandBlock=item(-2.39,1.951,-1.66,-.2); box(sandBlock,[.12,.035,.075],[0,.018,0],cream); box(sandBlock,[.12,.004,.075],[0,.037,0],dark);
  const decalSheet=item(-2.19,1.951,-1.66,.09); box(decalSheet,[.18,.003,.12],[0,.002,0],paper); for (const x of [-.05,0,.05]) box(decalSheet,[.025,.002,.025],[x,.004,0],red);
  const instructions=item(.03,.921,.38,-.1); box(instructions,[.18,.006,.13],[0,.003,0],paper); for (const z of [-.035,0,.035]) box(instructions,[.12,.001,.002],[0,.007,z],dark);
  // Stored materials below the bench and on the storage rack. Each container
  // and its contents is one authored group, not an asserted count of parts.
  for (let i=0;i<3;i++) {
    const bin=item(-.75+i*.72,.278,0,(i-1)*.04);
    box(bin,[.59,.23,.43],[0,.115,0],[blue,green,cream][i]);
    box(bin,[.59,.025,.43],[0,.242,0],dark);
    box(bin,[.20,.055,.003],[0,.13,.217],paper);
    box(bin,[.075,.008,.005],[0,.15,.22],dark);
  }
  const stock=item(-2.72,.506,-1.68,.05);
  for(let i=0;i<5;i++) box(stock,[.24,.006,.12],[i*.006,.004+i*.008,0],i%2?paper:plastic);
  const rods=item(-2.38,.520,-1.68,-.1);
  for(let i=0;i<6;i++) {const rod=cyl(rods,.003,.26,[0,.006+i*.006,(i%2)*.015],plastic); rod.rotation.z=Math.PI/2;}
  restOn(rods,.520);
  const scraps=item(-2.04,.534,-1.68,.1);
  box(scraps,[.20,.10,.15],[0,.05,0],green);
  for(let i=0;i<4;i++){const piece=box(scraps,[.025,.09,.015],[-.06+i*.04,.12,0],plastic); piece.rotation.z=(i-2)*.16;}
  for(let i=0;i<3;i++) {
    const carton=item(-2.695+i*.34,[1.047,1.005,1.019][i],-1.68,(i-1)*.06);
    box(carton,[.27,.06,.13],[0,.03,0],cartons[(i+1)%cartons.length]);
    box(carton,[.22,.003,.10],[0,.062,0],paper);
    box(carton,[.12,.002,.03],[0,.064,0],colors[i+2]);
  }
  const organizer=item(1.88,1.113,-1.83,.04);
  box(organizer,[.29,.10,.18],[0,.05,0],cream);
  for (const x of [-.095,0,.095]) {box(organizer,[.082,.03,.003],[x,.033,.092],blue); box(organizer,[.025,.006,.004],[x,.034,.096],paper);}
  const jar=item(2.25,1.113,-1.83,0); cyl(jar,.04,.12,[0,.06,0],cream); cyl(jar,.042,.012,[0,.126,0],dark);
  const thinner=item(2.37,1.113,-1.83,0); cyl(thinner,.033,.12,[0,.06,0],red); cyl(thinner,.021,.02,[0,.13,0],dark);
  const extraBrushes=item(2.52,1.113,-1.83,0); cyl(extraBrushes,.035,.08,[0,.04,0],green); for(let i=-1;i<=1;i++){const b=cyl(extraBrushes,.003,.15,[i*.012,.12,0],wood); b.rotation.z=i*.12;}
  const spareKnife=item(-1.1,.921,.42,-.22); box(spareKnife,[.10,.012,.014],[0,.008,0],red); box(spareKnife,[.045,.004,.01],[.07,.008,0],steel);
  const sparePliers=item(-.9,.921,.35,.45); for(const s of [-1,1]) {const h=box(sparePliers,[.09,.012,.014],[-.03,.009,s*.018],blue);h.rotation.y=s*.24;const jaw=box(sparePliers,[.045,.006,.007],[.035,.009,s*.006],steel);jaw.rotation.y=-s*.2;} cyl(sparePliers,.006,.01,[0,.011,0],steel);
  const projectPlane=item(-2.72,1.589,-1.68,.2); box(projectPlane,[.17,.018,.035],[0,.02,0],plastic); box(projectPlane,[.045,.008,.14],[0,.024,0],plastic); restOn(projectPlane,1.589);
  const projectHull=item(-2.38,1.617,-1.68,-.1); box(projectHull,[.20,.045,.10],[0,.023,0],green); box(projectHull,[.09,.03,.07],[0,.06,0],green);
  const projectBase=item(-2.02,1.451,-1.68,.12); box(projectBase,[.20,.018,.13],[0,.009,0],wood); box(projectBase,[.08,.07,.06],[0,.052,0],plastic);
  const maskingSheet=item(2.75,1.113,-1.83,.08); box(maskingSheet,[.16,.009,.12],[0,.005,0],cream);
  // Counts refer to portable authored objects, not child meshes or furniture.
  const inventory = { paint:28, kitBoxes:10, drill:1, toolCase:1, cuttingMat:1, aircraft:1, sprue:1, handTools:11, glue:2, solvent:2, tape:2, sandingSticks:3, caliper:1, clips:2, mug:1, notebook:1, openKit:1, partsTray:1, modelCar:1, spareSprueBundle:1, vise:1, brushCup:1, airbrush:1, airbrushHose:1, hobbySaw:1, tapeDispenser:1, cloth:1, paperRoll:1, rulerCase:1, sandingBlock:1, decalSheet:1, instructions:1, storageBins:3, sheetStock:1, rodStock:1, scrapContainer:1, archivedCartons:3, organizer:1, supplyJar:1, thinnerCan:1, usedBrushCup:1, spareKnife:1, sparePliers:1, unfinishedProjects:3, maskingSheet:1 };
  const addedNames = ['open-kit','parts-tray','model-car','spare-sprue-bundle','vise','brush-cup','airbrush','airbrush-hose','hobby-saw','tape-dispenser','cloth','paper-roll','ruler-case','sanding-block','decal-sheet','instructions','storage-bin-a','storage-bin-b','storage-bin-c','sheet-stock','rod-stock','scrap-container','archive-carton-a','archive-carton-b','archive-carton-c','small-parts-organizer','supply-jar','thinner-can','used-brush-cup','spare-knife','spare-pliers','unfinished-plane','unfinished-hull','unfinished-diorama','masking-sheet'];
  addedNames.forEach((name,index) => { group.children[68+index].name = name; });
  return { group, drill, blueCase, inventory };
}
