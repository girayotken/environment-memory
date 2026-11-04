/** Short-lived, user-seeded image tracking. It is a capture aid, not object identity. */
export type CapturePixels = { width: number; height: number; data: Uint8ClampedArray };
export type NormalizedCaptureBox = { x: number; y: number; width: number; height: number };
export type GuidedCaptureTracking = {
  status: 'idle' | 'tracking' | 'approach' | 'hold' | 'ready' | 'recovering' | 'lost' | 'ambiguous' | 'clipped' | 'tiny' | 'low-detail' | 'captured';
  box: NormalizedCaptureBox | null;
  confidence: number;
  stableMs: number;
  ready: boolean;
  reason: string;
};
type Plane = { width: number; height: number; gray: Float32Array; rgb: Float32Array };
type Patch = { values: Float64Array; colors: Float64Array | null; mean: number; energy: number; rgb: number[]; deviation: number };
type Match = { sample: Patch; anchorCorrelation: number; reference: number; box: NormalizedCaptureBox; score: number; correlation: number; colorDistance: number; deviation: number; dx: number; dy: number };
type Recovery =
  | { phase: 'missing'; anchor: Patch; deadline: number; episodeDeadline: number }
  | { phase: 'confirming'; anchor: Patch; deadline: number; matches: number; box: NormalizedCaptureBox | null };
const GRID = 12;
const HOLD_MS = 650;
const MISSING_EVIDENCE_MS = 350;
const CONFIRMATION_MS = 350;
const RECOVERY_MS = 600;
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const edge = (b: NormalizedCaptureBox) => b.x <= .025 || b.y <= .025 || b.x + b.width >= .975 || b.y + b.height >= .975;
function validFrame(f: CapturePixels) {
  return Number.isInteger(f.width) && Number.isInteger(f.height) && f.width > 0 && f.height > 0 && f.data.length === f.width * f.height * 4;
}
function validBox(b: NormalizedCaptureBox) {
  return [b.x,b.y,b.width,b.height].every(Number.isFinite) && b.width > 0 && b.height > 0 && b.x >= 0 && b.y >= 0 && b.x + b.width <= 1 && b.y + b.height <= 1;
}
function plane(f: CapturePixels): Plane {
  // Bound search work independently of the renderer's resolution.
  const ratio = Math.min(1, 256 / Math.max(f.width, f.height));
  const width = Math.max(1, Math.round(f.width * ratio)), height = Math.max(1, Math.round(f.height * ratio));
  const gray = new Float32Array(width * height), rgb = new Float32Array(width * height * 3);
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=y*width+x, source=(Math.min(f.height-1, Math.floor((y+.5)*f.height/height))*f.width+Math.min(f.width-1, Math.floor((x+.5)*f.width/width)))*4;
    const r=f.data[source],g=f.data[source+1],b=f.data[source+2];
    gray[i]=.299*r+.587*g+.114*b; rgb[i*3]=r;rgb[i*3+1]=g;rgb[i*3+2]=b;
  }
  return {width,height,gray,rgb};
}
function patch(p: Plane, b: NormalizedCaptureBox,spatialColor=false): Patch {
  const values=new Float64Array(GRID*GRID),colors=spatialColor?new Float64Array(GRID*GRID*3):null,rgb=[0,0,0]; let sum=0,sum2=0;
  for(let y=0;y<GRID;y++) for(let x=0;x<GRID;x++) {
    const px=clamp((b.x+(x+.5)*b.width/GRID)*p.width-.5,0,p.width-1), py=clamp((b.y+(y+.5)*b.height/GRID)*p.height-.5,0,p.height-1);
    const x0=Math.floor(px),y0=Math.floor(py), x1=Math.min(x0+1,p.width-1), y1=Math.min(y0+1,p.height-1), fx=px-x0,fy=py-y0;
    const indices=[y0*p.width+x0,y0*p.width+x1,y1*p.width+x0,y1*p.width+x1], weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
    let value=0;
    for(let k=0;k<4;k++) {const i=indices[k],w=weights[k]; value+=p.gray[i]*w;for(let c=0;c<3;c++){const color=p.rgb[i*3+c]*w;rgb[c]+=color;if(colors)colors[(y*GRID+x)*3+c]+=color;}}
    values[y*GRID+x]=value;sum+=value;sum2+=value*value;
  }
  const n=values.length, mean=sum/n, energy=Math.max(0,sum2-sum*sum/n);
  return {values,colors,mean,energy,rgb:rgb.map(c=>c/n),deviation:Math.sqrt(energy/n)};
}
function similarity(a: Patch,b: Patch) {
  let product=0;
  for(let i=0;i<a.values.length;i++)product+=(a.values[i]-a.mean)*(b.values[i]-b.mean);
  const correlation=a.energy>1&&b.energy>1 ? product/Math.sqrt(a.energy*b.energy) : 0;
  const colorDistance=Math.hypot(...a.rgb.map((c,i)=>c-b.rgb[i]));
  return {correlation,colorDistance,score:correlation*.88+Math.max(0,1-colorDistance/180)*.12};
}
function recoveryAppearance(a: Patch,b: Patch) {
  // A broad silhouette and mean colour can hide a changed body or detail.
  // Reacquisition must also agree with the last trusted spatial pattern. Chroma
  // differences cancel neutral brightness shifts; the strongest quarter prevents
  // unchanged background cells from averaging away a local colour change.
  if(!a.colors||!b.colors||similarity(a,b).correlation<.95)return false;
  const changes:number[]=[];
  for(let i=0;i<a.values.length;i++) {
    const dr=a.colors[i*3]-b.colors[i*3],dg=a.colors[i*3+1]-b.colors[i*3+1],db=a.colors[i*3+2]-b.colors[i*3+2];
    changes.push(Math.hypot(dr-dg,db-dg));
  }
  changes.sort((x,y)=>y-x);
  const count=Math.ceil(changes.length/4);
  return changes.slice(0,count).reduce((sum,n)=>sum+n,0)/count<=24;
}
function overlap(a: NormalizedCaptureBox,b: NormalizedCaptureBox) {
  const area=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return area/(a.width*a.height+b.width*b.height-area);
}
/** Call update at roughly 6–12 Hz. The original anchor never changes. Recent
 * views are bounded capture aids, admitted only by repeated, reversible evidence. */
export class GuidedCaptureTracker {
  private template: Patch | null=null;
  private current: GuidedCaptureTracking={status:'idle',box:null,confidence:0,stableMs:0,ready:false,reason:'Select the target in the camera view.'};
  private lastTime=0;
  private stableSince=0;
  private aspect=0;
  private consumed=false;
  private recent:Patch[]=[];
  private lastPlane:Plane|null=null;
  private lastSample:Patch|null=null;
  private trustedRun=0;
  private recovery:Recovery|null=null;

  reset() {
    this.template=null;this.consumed=false;this.lastTime=0;this.stableSince=0;this.aspect=0;
    this.recent=[];this.lastPlane=null;this.lastSample=null;this.trustedRun=0;
    this.recovery=null;
    this.current={status:'idle',box:null,confidence:0,stableMs:0,ready:false,reason:'Select the target in the camera view.'};
  }
  private result(status: GuidedCaptureTracking['status'],box: NormalizedCaptureBox|null,confidence:number,reason:string,stableMs=0) {
    this.current={status,box:box ? {...box} : null,confidence:clamp(confidence),stableMs,ready:status==='ready',reason};
    // Returned boxes are detached so UI consumers cannot mutate the search state.
    return {...this.current,box:this.current.box ? {...this.current.box} : null};
  }
  initialize(frame: CapturePixels,box: NormalizedCaptureBox,nowMs: number): GuidedCaptureTracking {
    this.reset();
    if(!validFrame(frame)||!Number.isFinite(nowMs))return this.result('lost',null,0,'Camera pixels are unavailable. Select again when the view returns.');
    if(!validBox(box))return this.result('clipped',null,0,'Keep the whole target inside the camera view, then select again.');
    if(edge(box))return this.result('clipped',box,0,'Keep the whole target inside the camera view, then select again.');
    if(box.width*frame.width<9||box.height*frame.height<9)return this.result('tiny',box,0,'Move closer and select a larger target region.');
    const p=plane(frame),sample=patch(p,box,true);
    if(sample.deviation<8)return this.result('low-detail',box,0,'Include a distinctive edge or detail, then select again.');
    this.template=sample;this.lastPlane=p;this.lastSample=sample;this.aspect=frame.width/frame.height;this.lastTime=nowMs;this.stableSince=nowMs;
    return this.quality(box,1,0);
  }
  private quality(box: NormalizedCaptureBox,confidence:number,stableMs:number) {
    if(edge(box))return this.result('clipped',box,confidence,'Keep the whole target away from the edge of the view.');
    if(box.width*box.height<.035||Math.max(box.width,box.height)<.24)return this.result('approach',box,confidence,'Move closer while keeping the target in view.');
    if(stableMs<HOLD_MS)return this.result('hold',box,confidence,'Hold steady while the target stays clear.',stableMs);
    return this.result('ready',box,confidence,'Target view is steady and ready to capture.',stableMs);
  }
  update(frame: CapturePixels,nowMs: number): GuidedCaptureTracking {
    if(this.consumed)return this.result('captured',this.current.box,this.current.confidence,'This target view has already been captured.');
    if(!this.template||!this.current.box)return {...this.current,box:this.current.box ? {...this.current.box} : null};
    if(!validFrame(frame)||!Number.isFinite(nowMs)||Math.abs(frame.width/frame.height-this.aspect)>.025) {
      this.template=null;this.recent=[];return this.result('lost',this.current.box,0,'Camera view changed or pixels are unavailable. Select the target again.');
    }
    const p=plane(frame),previous=this.current.box,template=this.template;
    // Keep at most four unchanged views through one continuously observed episode.
    // Age alone does not erase them during a slow, confidently tracked approach.
    if(nowMs<this.lastTime||nowMs-this.lastTime>400)this.recent=[];
    const seeds:Match[]=[];
    let bestOriginal:Match|null=null;
    const evaluate=(box:NormalizedCaptureBox,dx:number,dy:number):Match|null=>{
      if(!validBox(box))return null;
      const sample=patch(p,box),anchor=similarity(template,sample);
      const original:Match={box,...anchor,anchorCorrelation:anchor.correlation,reference:0,sample,deviation:sample.deviation,dx,dy};
      if(!bestOriginal||original.score>bestOriginal.score)bestOriginal=original;
      let match=anchor,reference=0;
      // Search every reference globally so adapted lookalikes remain competitors.
      if(anchor.correlation>=.62&&anchor.colorDistance<=60) {
        for(let i=0;i<this.recent.length;i++) {
          const recent=similarity(this.recent[i],sample);
          if(recent.score-.01>match.score){match={...recent,score:recent.score-.01};reference=i+1;}
        }
      }
      return {box,...match,anchorCorrelation:anchor.correlation,reference,sample,deviation:sample.deviation,dx,dy};
    };
    const offer=(candidate:Match|null)=>{
      if(!candidate)return;
      const same=seeds.findIndex(s=>overlap(s.box,candidate.box)>.4);
      if(same>=0){if(seeds[same].score>=candidate.score)return;seeds.splice(same,1);}
      seeds.push(candidate);seeds.sort((a,b)=>b.score-a.score);if(seeds.length>10)seeds.length=10;
    };
    const scales=[.82,.91,1,1.12,1.26,1.42];
    for(const scale of scales) {
      const width=previous.width*scale,height=previous.height*scale;
      if(width>1||height>1)continue;
      const dx=Math.max(width*.36,1/26),dy=Math.max(height*.36,1/20);
      // Global competitors catch repeated appearances; local samples retain smooth motion.
      for(let y=0;y<=1-height+1e-6;y+=dy)for(let x=0;x<=1-width+1e-6;x+=dx)offer(evaluate({x,y,width,height},dx,dy));
      const rx=Math.max(previous.width*.5,.055),ry=Math.max(previous.height*.5,.055);
      for(let iy=-4;iy<=4;iy++)for(let ix=-4;ix<=4;ix++)offer(evaluate({x:previous.x+previous.width/2-width/2+ix*rx/4,y:previous.y+previous.height/2-height/2+iy*ry/4,width,height},rx/4,ry/4));
    }
    const refined:Match[]=[];
    const originalSeed=bestOriginal as Match|null;
    for(const seed of [...seeds,...(originalSeed?[originalSeed]:[])]) {
      let best=seed;
      for(const [divisor,scaleStep] of [[2,.1],[2,.06],[4,.03],[8,.02]]) {
        const origin=best;
        for(const scale of [1-scaleStep,1,1+scaleStep])for(let iy=-1;iy<=1;iy++)for(let ix=-1;ix<=1;ix++) {
          const width=origin.box.width*scale,height=origin.box.height*scale;
          const candidate=evaluate({x:origin.box.x+(origin.box.width-width)/2+ix*seed.dx/divisor,y:origin.box.y+(origin.box.height-height)/2+iy*seed.dy/divisor,width,height},seed.dx,seed.dy);
          if(candidate&&candidate.score>best.score)best=candidate;
        }
      }
      refined.push(best);
    }
    refined.sort((a,b)=>b.score-a.score);
    // A clear original match wins across the whole search, rather than allowing
    // another box's recent-view score to displace an adequate immutable anchor.
    const original=bestOriginal as Match|null;
    const best=original&&original.correlation>=.84&&original.colorDistance<=85&&original.deviation>=7 ? original : refined[0];
    if(!best||best.correlation<.84||best.colorDistance>85||best.deviation<7) {
      // A short interruption may be a sampling glitch. Freeze the last trusted box,
      // forbid capture, and require repeated evidence before continuing.
      this.stableSince=nowMs;this.trustedRun=0;
      this.recovery??={phase:'missing',anchor:this.lastSample??template,deadline:nowMs+MISSING_EVIDENCE_MS,episodeDeadline:nowMs+RECOVERY_MS};
      // Weak pixels cannot restart either deadline. Once confirmation has begun,
      // they also break its consecutive agreeing samples without extending it.
      if(this.recovery.phase==='confirming'){this.recovery.matches=0;this.recovery.box=null;}
      if(nowMs<this.lastTime||nowMs-this.lastTime>400||nowMs>=this.recovery.deadline||best&&best.correlation>=.84&&best.colorDistance>85) {
        this.template=null;this.recent=[];return this.result('lost',previous,best?.score??0,'Target appearance was lost. Select it again to continue.');
      }
      this.lastTime=nowMs;
      return this.result('recovering',previous,best?.score??0,'Target is uncertain. Keep the camera steady while tracking recovers.');
    }
    const competitor=refined.find(candidate=>overlap(candidate.box,best.box)<.25&&candidate.correlation>.72&&candidate.colorDistance<=85);
    if(competitor&&best.score-competitor.score<.14) {
      this.template=null;this.recent=[];return this.result('ambiguous',best.box,best.score,'More than one region looks similar. Select a more distinctive target view.');
    }
    const displacement=Math.hypot(best.box.x+best.box.width/2-previous.x-previous.width/2,best.box.y+best.box.height/2-previous.y-previous.height/2);
    // Search globally for competitors, but never silently reacquire a distant lookalike.
    if(displacement>Math.max(.12,previous.width*.85,previous.height*.85)||best.reference>0&&(displacement>Math.max(.07,Math.min(previous.width,previous.height)*.35)||Math.abs(Math.log(best.box.width/previous.width))>=.2)) {
      this.template=null;this.recent=[];return this.result('lost',previous,best.score,'Target moved too far to follow reliably. Select it again.');
    }
    if(this.recovery!==null) {
      this.stableSince=nowMs;
      if(nowMs<this.lastTime||nowMs-this.lastTime>400||nowMs>=this.recovery.deadline) {
        this.template=null;this.recent=[];return this.result('lost',previous,best.score,'Tracking could not recover promptly. Select the target again.');
      }
      if(!recoveryAppearance(this.recovery.anchor,patch(p,best.box,true))) {
        this.template=null;this.recent=[];return this.result('lost',previous,best.score,'Target details changed during the interruption. Select the target again.');
      }
      // The first adequate sample ends missing evidence. Confirmation has its own
      // fixed window, so two absent 150 ms samples do not consume its allowance.
      if(this.recovery.phase==='missing')this.recovery={phase:'confirming',anchor:this.recovery.anchor,deadline:Math.min(nowMs+CONFIRMATION_MS,this.recovery.episodeDeadline),matches:0,box:null};
      this.recovery.matches=this.recovery.box&&overlap(this.recovery.box,best.box)>.65 ? this.recovery.matches+1 : 1;
      this.recovery.box=best.box;this.lastTime=nowMs;
      if(this.recovery.matches<2)return this.result('recovering',previous,best.score,'Confirming the target view. Hold steady before capture.');
      this.recovery=null;
      this.lastSample=null;this.trustedRun=0;
    }
    // Admit a new view only after consecutive strong local matches. Matching the
    // new patch back into the previous pixels must return the previous location.
    const temporal=this.lastSample?similarity(this.lastSample,best.sample):null;
    // Upsampling a tiny target supplies no new independent appearance evidence.
    const canLearn=best.box.width*p.width>=GRID&&best.box.height*p.height>=GRID&&nowMs>=this.lastTime&&nowMs-this.lastTime<=400&&best.correlation>=.9&&best.anchorCorrelation>=.68&&best.colorDistance<50&&temporal&&temporal.correlation>=.9&&!edge(best.box)&&displacement<=.05;
    this.trustedRun=canLearn?this.trustedRun+1:0;
    if(this.trustedRun>=2&&this.lastPlane) {
      let reverseScore=-Infinity,reverseOffset=Infinity;
      for(let iy=-1;iy<=1;iy++)for(let ix=-1;ix<=1;ix++) {
        const box={...previous,x:previous.x+ix*previous.width*.1,y:previous.y+iy*previous.height*.1};
        if(!validBox(box))continue;
        const score=similarity(best.sample,patch(this.lastPlane,box)).score;
        if(score>reverseScore){reverseScore=score;reverseOffset=Math.hypot(ix,iy);}
      }
      if(reverseOffset===0&&reverseScore>=.9) {
        // Four actual views at most, with the immutable original always retained.
        this.recent.push(best.sample);if(this.recent.length>4)this.recent.shift();
      }
    }
    // Spatial colour is needed only for accepted history and recovery, not every
    // search candidate. Its sampling arithmetic is identical in both paths.
    this.lastPlane=p;this.lastSample=patch(p,best.box,true);
    const scaleChange=Math.abs(Math.log(best.box.width/previous.width));
    if(nowMs<this.lastTime||nowMs-this.lastTime>400||displacement>.012||scaleChange>.045||edge(best.box))this.stableSince=nowMs;
    this.lastTime=nowMs;
    const stableMs=Math.max(0,nowMs-this.stableSince);
    return this.quality(best.box,best.score,stableMs);
  }
  /** The UI consumes readiness immediately before its one-shot capture dispatch. */
  consumeCapture(): boolean {
    if(this.consumed||!this.current.ready)return false;
    this.consumed=true;this.recent=[];this.result('captured',this.current.box,this.current.confidence,'This target view has already been captured.');return true;
  }
}
