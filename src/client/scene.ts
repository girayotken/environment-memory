import * as THREE from 'three';
import { createStorageRoom } from './models/storage-room.ts';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Zone, FrameEnvelope } from '../domain/contracts.ts';
import { createHeroTools } from './models/hero-tools.ts';
import { createHobbyStudioRoom } from './models/hobby-studio-room.ts';
import { createHobbyStudioProps } from './models/hobby-studio-props.ts';
import { createBenchDemo } from './models/bench-demo.ts';
import { createWeekendWorkshop } from './models/weekend-workshop.ts';
import type { WeekendStorageScenario } from './models/weekend-storage-scenario.ts';
import { createWorkshopRoom } from './models/workshop-room.ts';
import { createStorageProps } from './models/storage-props.ts';
import { createInspectionMeter } from './models/inspection-meter.ts';
import { createLookalikeCases } from './models/lookalike-cases.ts';
import { createCaseChallenges, type CaseChallenge } from './models/case-challenges.ts';
import { createNaturalMemoryChallenge } from './models/natural-memory-challenge.ts';
import { createToolFamilyChallenge } from './models/tool-family-challenge.ts';
import type { VisitScenario } from './visit-scenarios.ts';
import { capturePhoneFrame, applyPhoneProjection } from './phone-capture.ts';

/** Simulator-owned geometry. Only rendered capture pixels cross the observer boundary. */
export function cameraHeightLimit(environmentKind: 'workshop'|'model-maker-studio'|'storage-room') { return environmentKind === 'storage-room' ? 6 : 2.95; }

export class Workshop {
  private scene = new THREE.Scene();
  storageRoom?: ReturnType<typeof createStorageRoom>;
  weekendScenario?: WeekendStorageScenario;
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 35);
  private renderer: THREE.WebGLRenderer;
  private environment: THREE.WebGLRenderTarget;
  private resize: ResizeObserver;
  private blueCase!: THREE.Group;
  private parcel!: THREE.Group;
  private newParts!: THREE.Group;
  private flaps!: THREE.Group[];
  private flapRest!: THREE.Quaternion[];
  private caseRest!: THREE.Vector3;
  private drill!: THREE.Group;
  private robot!: THREE.Group;
  private drillRest!: THREE.Vector3;
  private drillRotation!: THREE.Euler;
  private heroTools!: THREE.Group;
  private lookalikes!: ReturnType<typeof createLookalikeCases>;
  private challenges!: ReturnType<typeof createCaseChallenges>;
  private naturalChallenge!: ReturnType<typeof createNaturalMemoryChallenge>;
  private toolChallenge!: ReturnType<typeof createToolFamilyChallenge>;
  private inspectionMeter = createInspectionMeter();
  private unpacked = false;
  private moved = false;
  private zone: Zone = 'bench';
  private width = 960;
  private height = 640;
  private freeCamera = false;

  constructor(private host: HTMLElement, private environmentKind: 'workshop'|'model-maker-studio'|'storage-room' = 'workshop') {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0xbfc8c9);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.domElement.setAttribute('aria-label', environmentKind === 'storage-room' ? 'Virtual storage room camera' : environmentKind === 'model-maker-studio' ? 'Virtual model maker studio camera' : 'Virtual shared robotics workshop camera');
    this.renderer.domElement.setAttribute('role', 'img');
    host.append(this.renderer.domElement);
    // Local procedural reflections; no external HDRI or asset download.
    const generator = new THREE.PMREMGenerator(this.renderer);
    const environmentRoom = new RoomEnvironment();
    this.environment = generator.fromScene(environmentRoom, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.38;
    environmentRoom.dispose(); generator.dispose();
    if (environmentKind === 'storage-room') {
      this.storageRoom=createStorageRoom(); this.scene.add(this.storageRoom.group); this.lightRoom();
      this.resize=new ResizeObserver(()=>this.fit()); this.resize.observe(host); this.fit(); this.setView('bench'); return;
    }
    if (environmentKind === 'model-maker-studio') {
      this.renderer.toneMappingExposure = 0.82;
      this.scene.environmentIntensity = 0.28;
      const props = import.meta.env?.VITE_STUDIO_LAYOUT === 'weekend'
        ? createWeekendWorkshop() : import.meta.env?.VITE_STUDIO_LAYOUT === 'bench-demo'
          ? createBenchDemo() : {...createHobbyStudioProps(),room:createHobbyStudioRoom()};
      if ('scenario' in props) this.weekendScenario = props.scenario;
      this.scene.add(props.room, props.group);
      this.drill = props.drill; this.blueCase = props.blueCase;
      this.lightRoom();
      this.resize = new ResizeObserver(() => this.fit());
      this.resize.observe(host); this.fit(); this.setView('bench');
      return;
    }
    this.scene.add(createWorkshopRoom());
    const tools = createHeroTools(), props = createStorageProps();
    this.scene.add(tools.group, props.group);
    this.blueCase = props.blueCase; this.parcel=props.parcel; this.newParts = tools.incomingParts;
    this.naturalChallenge=createNaturalMemoryChallenge(this.blueCase,tools.drill);this.scene.add(this.naturalChallenge.group);
    this.toolChallenge=createToolFamilyChallenge(tools.drill);this.scene.add(this.toolChallenge.group);
    this.heroTools = tools.group; this.lookalikes = createLookalikeCases(this.blueCase);
    this.scene.add(this.lookalikes.second, this.lookalikes.third);
    this.challenges = createCaseChallenges(this.blueCase); this.scene.add(this.challenges.group);
    this.drill = tools.drill; this.robot = tools.robot; this.drillRest=this.drill.position.clone(); this.drillRotation=this.drill.rotation.clone(); this.inspectionMeter.visible = false; this.scene.add(this.inspectionMeter);
    this.flaps = props.flaps; this.flapRest = this.flaps.map(flap => flap.quaternion.clone());
    this.caseRest = this.blueCase.position.clone();
    this.scene.add(this.newParts); this.positionIncomingParts();
    this.lightRoom();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host); this.fit(); this.setView('bench');
  }

  private lightRoom() {
    const studio = this.environmentKind === 'model-maker-studio';
    const weekend = studio && import.meta.env?.VITE_STUDIO_LAYOUT === 'weekend';
    this.scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x777268, studio ? 0.65 : 0.75));
    const daylight = new THREE.DirectionalLight(0xfff4df, weekend ? 1.8 : studio ? 2.25 : 3.1);
    daylight.position.set(-2.2, 5.2, 1.4); daylight.target.position.set(0, 0.6, -0.4);
    daylight.castShadow = true; daylight.shadow.mapSize.set(2048, 2048);
    Object.assign(daylight.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 0.1, far: 13 });
    daylight.shadow.normalBias = weekend ? 0.002 : 0.012; daylight.shadow.bias = -0.00015;
    daylight.shadow.radius = 3; this.scene.add(daylight, daylight.target);
    const windowFill = new THREE.DirectionalLight(0xd5e6ff, studio ? 0.7 : 1.05);
    windowFill.position.set(2, 3.1, -2.7); windowFill.target.position.set(0, 0.9, 0);
    this.scene.add(windowFill, windowFill.target);
    const task = new THREE.PointLight(0xffe6be, weekend ? 0.8 : studio ? 7 : 9, 4, 2);
    if (weekend) task.position.set(0.75, 1.54, -0.32);
    else task.position.set(-0.5, 2.1, -1.35);
    this.scene.add(task);
  }

  private fit() {
    this.width = Math.max(64, this.host.clientWidth); this.height = Math.max(64, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    if (this.freeCamera) {
      applyPhoneProjection(this.camera);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.camera.aspect = this.width / this.height;
    this.camera.fov = 40;
    // Fit the same horizontal workspace on a portrait phone instead of cropping it.
    const portrait = Math.min(1, this.camera.aspect / 1.6);
    this.camera.zoom = ({ bench: 1.5, storage: 0.78, parts: 1.1 }[this.zone]) * portrait;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
  setView(zone: Zone) {
    this.freeCamera = false;
    const views: Record<Zone, number[]> = {
      bench: [2.9, 2.35, 3.6, -0.03, 0.94, -0.15],
      storage: [-0.28, 1.85, 0.05, -2.5, 1.2, -2.1],
      parts: [3.75, 1.9, 0.25, 2.35, 0.76, -2.1],
    };
    this.zone = zone; this.fit();
    const v = this.environmentKind === 'storage-room' ? [0,4.2,1.0,0,1.12,-.48]
      : this.environmentKind === 'model-maker-studio' && import.meta.env?.VITE_STUDIO_LAYOUT === 'weekend' && zone === 'bench'
        ? [.65,1.72,1.52,-.10,.92,-.06]
        : this.environmentKind === 'model-maker-studio' && import.meta.env?.VITE_STUDIO_LAYOUT === 'bench-demo' && zone === 'bench'
          ? [.43,1.77,1.08,0,.91,-.09] : views[zone]; this.camera.position.set(v[0], v[1], v[2]);
    this.camera.lookAt(v[3], v[4], v[5]); this.renderer.render(this.scene, this.camera);
  }
  setStorageView(view: 'packing'|'shelf') {
    if (this.environmentKind !== 'storage-room') return;
    const v = view === 'packing' ? [0,4.2,1.0,0,1.12,-.48] : [0,2.05,2.55,0,1,-.46];
    this.camera.position.set(v[0],v[1],v[2]); this.camera.lookAt(v[3],v[4],v[5]);
    this.renderer.render(this.scene,this.camera);
  }
  setWeekendView(view: 'packing'|'shelf') {
    if (!this.weekendScenario) return;
    const v = view === 'packing' ? [2.26,2.10,-.58,2.26,.94,-1.32] : [-1.4,1.65,-.18,-2.355,1.08,-1.68];
    this.camera.position.set(v[0],v[1],v[2]); this.camera.lookAt(v[3],v[4],v[5]);
    this.renderer.render(this.scene,this.camera);
  }
  private positionIncomingParts() {
    this.newParts.position.set(this.unpacked ? -0.6 : -1.03, this.unpacked ? 0.945 : 0.978, this.unpacked ? 0.32 : -0.13);
  }
  unpack() {
    this.unpacked = !this.unpacked; this.positionIncomingParts();
    this.flaps.forEach((flap, index) => {
      flap.quaternion.copy(this.flapRest[index]);
      if (this.unpacked) flap.rotation.set(0, 0, 0);
    });
    this.renderer.render(this.scene, this.camera);
  }
  moveCase() {
    this.moved = !this.moved;
    if (this.moved) this.blueCase.position.set(0.75, 0.27, -0.12);
    else this.blueCase.position.copy(this.caseRest);
    this.renderer.render(this.scene, this.camera);
  }
  reset() {
    if (this.unpacked) this.unpack(); if (this.moved) this.moveCase();
    this.challenges.group.visible = false;
    this.naturalChallenge.group.visible=false;this.parcel.visible=true;
    this.toolChallenge.group.visible=false;
    this.blueCase.visible = true; this.blueCase.position.copy(this.caseRest);
    this.lookalikes.second.visible = this.lookalikes.third.visible = false;
    this.heroTools.visible = this.newParts.visible = true;
    this.robot.visible = true; this.drill.position.copy(this.drillRest); this.drill.rotation.copy(this.drillRotation);
    this.drill.visible = true; this.inspectionMeter.visible = false; this.renderer.render(this.scene, this.camera);
  }
  prepareMemoryVisit(visit: 1|2|3) {
    this.reset(); this.setView('bench'); this.robot.visible = this.newParts.visible = false;
    if(visit===2){this.moveCase();this.drill.visible=false;this.inspectionMeter.visible=true;}
    if(visit===3){this.blueCase.position.set(.45,.94,.2);this.drill.position.set(-.1,.94,.43);this.drill.rotation.y=-.5;this.inspectionMeter.visible=true;}
    this.renderer.render(this.scene,this.camera);
  }
  prepareNaturalVisit(visit:1|2|3,kind:'cases'|'tools'='cases'){
    this.reset();this.setView('bench');
    this.heroTools.visible=this.newParts.visible=this.blueCase.visible=this.parcel.visible=false;
    (kind==='tools'?this.toolChallenge:this.naturalChallenge).prepare(visit);this.renderer.render(this.scene,this.camera);
  }
  prepareVisit(which: 'first' | 'return', scenario: VisitScenario = 'basic') {
    this.reset(); this.setView('bench');
    if (scenario.startsWith('challenge-')) {
      this.blueCase.visible = this.heroTools.visible = this.newParts.visible = false;
      this.challenges.prepare(scenario as CaseChallenge, which === 'return');
    } else if (scenario === 'basic') {
      if (which === 'return') { this.moveCase(); this.drill.visible = false; this.inspectionMeter.visible = true; }
    } else {
      this.heroTools.visible = this.newParts.visible = false;
      const { second, third, yellowTape, whiteTape } = this.lookalikes;
      yellowTape.visible = whiteTape.visible = scenario === 'marked';
      this.blueCase.position.set(-0.15, 0.94, 0.27);
      second.visible = true; second.position.set(0.65, 0.94, -0.1);
      if (which === 'return') {
        third.visible = true;
        if (scenario === 'marked') {
          this.blueCase.position.set(0.65, 0.27, -0.12);
          second.position.set(-0.15, 0.94, 0.27);
          third.position.set(0.65, 0.94, -0.1);
        } else {
          this.blueCase.visible = false;
          second.position.set(0.65, 0.27, -0.12);
          third.position.set(-0.15, 0.94, 0.27);
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
  capture(maxEdge = 1280) {
    this.renderer.render(this.scene, this.camera);
    const canvas = document.createElement('canvas'), scale = Math.min(1, maxEdge / this.width, maxEdge / this.height);
    canvas.width = Math.round(this.width * scale); canvas.height = Math.round(this.height * scale);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image capture is unavailable');
    context.drawImage(this.renderer.domElement, 0, 0, canvas.width, canvas.height);
    return { imageDataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height,
      referenceView: `workshop-v2-${this.zone}` as FrameEnvelope['referenceView'] };
  }
  /** Free-camera controls remain simulator-side; captures expose pixels only. */
  resetFreeCamera() {
    this.setView('bench');
    this.freeCamera = true;
    this.fit();
  }
  lookFreeCamera(yaw: number, pitch: number) {
    const orientation = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    orientation.y += yaw;
    orientation.x = THREE.MathUtils.clamp(orientation.x + pitch, -Math.PI * .47, Math.PI * .47);
    orientation.z = 0;
    this.camera.quaternion.setFromEuler(orientation);
  }
  moveFreeCamera(right: number, up: number, forward: number, delta: number, fast = false) {
    const input = new THREE.Vector3(right, up, forward);
    if (input.lengthSq() > 1) input.normalize();
    const orientation = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const distance = Math.min(.05, Math.max(0, delta)) * (fast ? 3 : 1.2);
    const yaw = orientation.y;
    this.camera.position.x += (input.x * Math.cos(yaw) - input.z * Math.sin(yaw)) * distance;
    this.camera.position.z += (-input.x * Math.sin(yaw) - input.z * Math.cos(yaw)) * distance;
    this.camera.position.y += input.y * distance;
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -3.3, 3.3);
    this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, .25, cameraHeightLimit(this.environmentKind));
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -2.5, 3.9);
  }
  renderFreeCamera() { this.renderer.render(this.scene, this.camera); }
  captureFreeCamera() {
    // Resume can capture before ResizeObserver delivers the newly visible size.
    this.fit();
    return capturePhoneFrame(this.renderer, this.width, this.height, () => this.renderer.render(this.scene, this.camera));
  }
  /** Offline experimental sweep; no transforms or simulator IDs leave this method. */
  captureSweepFrame(index: number) {
    if (!Number.isInteger(index) || index < 0 || index > 15) throw new Error('Sweep frame must be 0–15');
    const position = this.camera.position.clone(), orientation = this.camera.quaternion.clone();
    try {
      this.camera.position.x += (index / 15 - .5) * .8;
      this.camera.lookAt(-.03,.94,-.15);
      return this.capture(640);
    } finally {
      this.camera.position.copy(position); this.camera.quaternion.copy(orientation);
      this.renderer.render(this.scene,this.camera);
    }
  }
  dispose() {
    this.resize.disconnect();
    const textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    textures.forEach(texture => texture.dispose()); geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.environment.dispose(); this.scene.clear();
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
