import test from 'node:test';
import assert from 'node:assert/strict';
import {GuidedCaptureTracker,type CapturePixels,type NormalizedCaptureBox} from '../src/client/guided-capture-tracker.ts';

const initial={x:.35,y:.3,width:.18,height:.18};
const close={x:.29,y:.24,width:.3,height:.3};
function frame(boxes:NormalizedCaptureBox[]=[],variant=0,angle=0):CapturePixels {
  const width=240,height=160,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;let rgb=[48+x*.04,54+y*.02,61];
    for(const box of boxes)if(x/width>=box.x&&x/width<box.x+box.width&&y/height>=box.y&&y/height<box.y+box.height){
      const v=(y/height-box.y)/box.height,u=(x/width-box.x)/box.width+angle*(v-.5);
      // An asymmetric, textured shape; independent of any workshop object or colour.
      const shape=(u>.15&&u<.82&&v>.2&&v<.7)||(u>.48&&u<.7&&v>.65&&v<.92);
      const tone=shape ? 120+42*Math.sin(u*23)*Math.cos(v*17)+25*u : 30+20*v;
      rgb=variant ? [tone*.2,tone*.3,tone+70] : [tone+60,tone*.8,tone*.42];
    }
    data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];data[i+3]=255;
  }
  return {width,height,data};
}
function near(actual:NormalizedCaptureBox|null,expected:NormalizedCaptureBox,tolerance=.025){
  assert.ok(actual);for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(actual[key]-expected[key])<tolerance,`${key}: ${actual[key]} vs ${expected[key]}`);
}
function changedDetails(kind:'colour'|'pattern'):CapturePixels {
  const pixels=frame([close]);
  for(let y=0;y<pixels.height;y++)for(let x=0;x<pixels.width;x++) {
    const u=(x/pixels.width-close.x)/close.width,v=(y/pixels.height-close.y)/close.height;
    if(u<.2||u>.8||v<.25||v>.65)continue;
    const i=(y*pixels.width+x)*4;
    if(kind==='colour') {
      // Change a local body colour while nearly preserving its luminance.
      pixels.data[i]-=40;pixels.data[i+1]+=20;pixels.data[i+2]+=2;
    } else {
      // Add neutral alternating detail, retaining the same local colour family.
      const delta=Math.floor(u*18)%2===0?40:-40;
      for(let c=0;c<3;c++)pixels.data[i+c]+=delta;
    }
  }
  return pixels;
}

test('a user-seeded pixel target follows gradual translation and approach, then requires a steady hold',()=>{
  const tracker=new GuidedCaptureTracker();
  assert.equal(tracker.initialize(frame([initial]),initial,0).status,'approach');
  assert.equal(tracker.consumeCapture(),false);
  for(let step=1;step<=8;step++){
    const t=step/8,box={x:initial.x+(close.x-initial.x)*t,y:initial.y+(close.y-initial.y)*t,width:initial.width+(close.width-initial.width)*t,height:initial.height+(close.height-initial.height)*t};
    const result=tracker.update(frame([box]),step*100);
    assert.ok(['approach','hold'].includes(result.status),JSON.stringify(result));near(result.box,box);
    assert.equal(result.ready,false);
  }
  let result=tracker.update(frame([close]),900);
  for(let t=1000;t<=1600;t+=100)result=tracker.update(frame([close]),t);
  assert.equal(result.status,'ready');assert.ok(result.stableMs>=650);near(result.box,close);
  assert.equal(tracker.consumeCapture(),true);assert.equal(tracker.consumeCapture(),false);
  assert.equal(tracker.update(frame([close]),1700).status,'captured');
  tracker.reset();tracker.initialize(frame([close]),close,2000);
  for(let t=2100;t<=2800;t+=100)tracker.update(frame([close]),t);
  assert.equal(tracker.consumeCapture(),true,'explicit reset starts a new one-shot target capture');
});

test('disappearance and a similarly shaped wrong-colour frame cannot consume a capture',()=>{
  for(const missing of [frame(),frame([close],1)]){
    const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
    const result=tracker.update(missing,100);
    assert.ok(['recovering','lost'].includes(result.status),JSON.stringify(result));assert.equal(tracker.consumeCapture(),false);
    assert.equal(tracker.update(missing,500).status,'lost','uncertainty expires within a bounded grace period');
    assert.equal(tracker.update(frame([close]),1000).status,'lost','expired loss needs explicit reselection');
  }
});

test('a second matching region rejects ambiguous tracking',()=>{
  const tracker=new GuidedCaptureTracker(),box={x:.12,y:.2,width:.25,height:.3},second={...box,x:.6};
  tracker.initialize(frame([box]),box,0);
  const result=tracker.update(frame([box,second]),100);
  assert.equal(result.status,'ambiguous',JSON.stringify(result));assert.equal(result.ready,false);
});

test('clipped, tiny and featureless selections reject readiness',()=>{
  const tracker=new GuidedCaptureTracker();
  assert.equal(tracker.initialize(frame([close]),{...close,x:0},0).status,'clipped');
  assert.equal(tracker.initialize(frame([close]),{...close,width:.01},0).status,'tiny');
  assert.equal(tracker.initialize(frame(),close,0).status,'low-detail');
  assert.equal(tracker.consumeCapture(),false);
});

test('tracking near the image boundary blocks a shot and resets the hold',()=>{
  const tracker=new GuidedCaptureTracker(),box={x:.06,y:.26,width:.3,height:.3};
  tracker.initialize(frame([box]),box,0);
  let result=tracker.update(frame([{...box,x:.01}]),100);
  assert.equal(result.status,'clipped',JSON.stringify(result));assert.equal(result.ready,false);
  result=tracker.update(frame([box]),200);
  assert.equal(result.status,'hold');assert.equal(result.ready,false);
});

test('large timestamp gaps, movement and reset revoke one-shot readiness',()=>{
  const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
  let result=tracker.update(frame([close]),100);
  for(let t=200;t<=800;t+=100)result=tracker.update(frame([close]),t);
  assert.equal(result.ready,true);
  assert.equal(tracker.update(frame([close]),2000).ready,false);
  assert.equal(tracker.consumeCapture(),false);
  result=tracker.update(frame([{...close,x:close.x+.04}]),2100);
  assert.equal(result.ready,false);assert.equal(result.stableMs,0);
  tracker.reset();assert.equal(tracker.update(frame([close]),3000).status,'idle');assert.equal(tracker.consumeCapture(),false);
  assert.equal(tracker.initialize(frame([close]),close,4000).status,'hold');
});

test('frame shape changes and invalid pixels require reselection',()=>{
  for(const invalid of [{width:1,height:1,data:new Uint8ClampedArray(0)},{width:240,height:80,data:new Uint8ClampedArray(240*80*4)}]){
    const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
    assert.equal(tracker.update(invalid,100).status,'lost');assert.equal(tracker.consumeCapture(),false);
  }
});

test('a distant identical-looking region does not silently reacquire the user target',()=>{
  const tracker=new GuidedCaptureTracker(),box={x:.08,y:.25,width:.22,height:.3};
  tracker.initialize(frame([box]),box,0);
  const result=tracker.update(frame([{...box,x:.65}]),150);
  assert.equal(result.status,'lost',JSON.stringify(result));assert.equal(tracker.consumeCapture(),false);
});


test('a brief missing frame cannot capture and recovery restarts the full hold',()=>{
  const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
  for(let t=100;t<=800;t+=100)tracker.update(frame([close]),t);
  const missing=tracker.update(frame(),900);
  assert.equal(missing.status,'recovering');assert.equal(missing.ready,false);assert.equal(tracker.consumeCapture(),false);near(missing.box,close);
  assert.equal(tracker.update(frame([close]),1000).status,'recovering','one good frame cannot establish recovery');
  const recovered=tracker.update(frame([close]),1100);
  assert.equal(recovered.status,'hold');assert.equal(recovered.stableMs,0);
  for(let t=1200;t<=1700;t+=100)assert.equal(tracker.update(frame([close]),t).ready,false);
  assert.equal(tracker.update(frame([close]),1800).ready,true);
});

test('two missing 150 ms samples during approach allow two confirmations and then a fresh full hold',()=>{
  const tracker=new GuidedCaptureTracker();tracker.initialize(frame([initial]),initial,0);
  for(let step=1;step<=8;step++) {
    const t=step/8,box={x:initial.x+(close.x-initial.x)*t,y:initial.y+(close.y-initial.y)*t,width:initial.width+(close.width-initial.width)*t,height:initial.height+(close.height-initial.height)*t};
    const result=tracker.update(frame([box]),step*150);
    assert.ok(['approach','hold'].includes(result.status),JSON.stringify({step,result}));near(result.box,box);
  }
  for(const now of [1350,1500]) {
    const result=tracker.update(frame(),now);
    assert.equal(result.status,'recovering');assert.equal(result.stableMs,0);near(result.box,close);
    assert.equal(tracker.consumeCapture(),false);
  }
  const first=tracker.update(frame([close]),1650);
  assert.equal(first.status,'recovering');assert.equal(first.ready,false);assert.equal(tracker.consumeCapture(),false);
  const resumed=tracker.update(frame([close]),1800);
  assert.equal(resumed.status,'hold');assert.equal(resumed.stableMs,0);near(resumed.box,close);
  for(const now of [1950,2100,2250,2400]) {
    assert.equal(tracker.update(frame([close]),now).ready,false);
    assert.equal(tracker.consumeCapture(),false);
  }
  const ready=tracker.update(frame([close]),2450);
  assert.equal(ready.ready,true);assert.equal(ready.stableMs,650);
  assert.equal(tracker.consumeCapture(),true);assert.equal(tracker.consumeCapture(),false);
});

test('three missing 150 ms samples cannot acquire a fresh confirmation window',()=>{
  for(const returning of [frame(),frame([close])]) {
    const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
    for(const now of [150,300,450]) {
      assert.equal(tracker.update(frame(),now).status,'recovering');
      assert.equal(tracker.consumeCapture(),false);
    }
    assert.equal(tracker.update(returning,600).status,'lost');
    assert.equal(tracker.update(frame([close]),750).status,'lost');assert.equal(tracker.consumeCapture(),false);
  }
});

test('weak evidence breaks consecutive confirmation without renewing its fixed deadline',()=>{
  const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
  for(const now of [150,300])assert.equal(tracker.update(frame(),now).status,'recovering');
  for(const [now,pixels] of [[450,frame([close])],[550,frame()],[650,frame([close])]] as const) {
    assert.equal(tracker.update(pixels,now).status,'recovering');
    assert.equal(tracker.consumeCapture(),false);
  }
  assert.equal(tracker.update(frame([close]),750).status,'lost','the 600 ms episode cap wins even with two final good samples');
  assert.equal(tracker.update(frame([close]),900).status,'lost');assert.equal(tracker.consumeCapture(),false);
});

test('disagreeing local confirmations expire without capture or a sliding deadline',()=>{
  const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
  assert.equal(tracker.update(frame(),150).status,'recovering');
  for(const [now,box] of [[300,close],[450,{...close,x:close.x+.08}],[600,close]] as const) {
    const result=tracker.update(frame([box]),now);
    assert.equal(result.status,'recovering',JSON.stringify({now,result}));
    assert.equal(tracker.consumeCapture(),false);
  }
  assert.equal(tracker.update(frame([close]),650).status,'lost','the first confirmation owns its 350 ms deadline');
  assert.equal(tracker.consumeCapture(),false);
});

test('two missing samples preserve wrong-colour, distant and duplicate rejection',()=>{
  for(const pixels of [frame([close],1),frame([{...close,x:.65}]),frame([close,{...close,x:.65}])]) {
    const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
    for(const now of [150,300])assert.equal(tracker.update(frame(),now).status,'recovering');
    const result=tracker.update(pixels,450);
    assert.ok(['lost','ambiguous'].includes(result.status),JSON.stringify(result));
    assert.equal(result.ready,false);assert.equal(tracker.consumeCapture(),false);
    assert.ok(['lost','ambiguous'].includes(tracker.update(frame([close]),600).status),'rejected evidence needs explicit reselection');
  }
});

for(const kind of ['colour','pattern'] as const)test(`a same-position replacement with changed local ${kind} cannot recover from a shared silhouette`,()=>{
  const replacement=changedDetails(kind),ordinary=new GuidedCaptureTracker();
  ordinary.initialize(frame([close]),close,0);
  assert.equal(ordinary.update(replacement,150).status,'hold','the broad ordinary match alone does not establish unchanged details');
  const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
  for(const now of [150,300])assert.equal(tracker.update(frame(),now).status,'recovering');
  const result=tracker.update(replacement,450);
  assert.equal(result.status,'lost',JSON.stringify(result));assert.equal(tracker.consumeCapture(),false);
  for(let now=600;now<=1500;now+=150) {
    assert.equal(tracker.update(replacement,now).status,'lost');assert.equal(tracker.consumeCapture(),false);
  }
});

test('both recovery confirmations must agree with the pre-interruption appearance',()=>{
  const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
  for(const now of [150,300])assert.equal(tracker.update(frame(),now).status,'recovering');
  assert.equal(tracker.update(frame([close]),450).status,'recovering');
  assert.equal(tracker.update(changedDetails('colour'),600).status,'lost');assert.equal(tracker.consumeCapture(),false);
});

test('a gap or backwards clock during confirmation terminates recovery',()=>{
  for(const now of [250,701]) {
    const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
    assert.equal(tracker.update(frame(),150).status,'recovering');
    assert.equal(tracker.update(frame([close]),300).status,'recovering');
    assert.equal(tracker.update(frame([close]),now).status,'lost');assert.equal(tracker.consumeCapture(),false);
  }
});

test('recovery cannot jump to a distant lookalike or overlook a duplicate',()=>{
  for(const boxes of [[{...close,x:.65}], [close,{...close,x:.65}]]) {
    const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
    assert.equal(tracker.update(frame(),100).status,'recovering');
    const result=tracker.update(frame(boxes),200);
    assert.ok(['lost','ambiguous'].includes(result.status),JSON.stringify(result));assert.equal(tracker.consumeCapture(),false);
  }
});

test('guarded recent views follow gradual shear beyond the initial appearance',()=>{
  const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
  let result=tracker.update(frame([close]),100);
  for(let i=1;i<=20;i++) {
    result=tracker.update(frame([close],0,i*.025),100+i*100);
    assert.ok(['hold','ready'].includes(result.status),JSON.stringify({i,result}));near(result.box,close,.035);
  }
  for(let t=2200;t<=3000;t+=100)result=tracker.update(frame([close],0,.5),t);
  assert.equal(result.ready,true);near(result.box,close,.035);
  const unprepared=new GuidedCaptureTracker();unprepared.initialize(frame([close]),close,0);
  assert.ok(['recovering','lost'].includes(unprepared.update(frame([close],0,.5),100).status),'the final appearance is beyond a fresh original-only match');
});

test('adapted appearances still reject global duplicates and cannot drift without an original anchor',()=>{
  const prepared=()=>{
    const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
    tracker.update(frame([close]),100);
    for(let i=1;i<=20;i++)tracker.update(frame([close],0,i*.025),100+i*100);
    return tracker;
  };
  const duplicate=prepared(),result=duplicate.update(frame([close,{...close,x:.65}],0,.5),2200);
  assert.equal(result.status,'ambiguous',JSON.stringify(result));assert.equal(duplicate.consumeCapture(),false);
  const drifting=prepared();let stopped=false;
  for(let i=21;i<=80;i++) {
    const result=drifting.update(frame([close],0,i*.025),100+i*100);
    if(['recovering','lost','ambiguous'].includes(result.status)){stopped=true;assert.equal(result.ready,false);}
    if(stopped)assert.equal(drifting.consumeCapture(),false);
  }
  assert.equal(stopped,true,'the immutable original eventually stops the adapting chain');
});


test('an unchanged trusted fallback survives a prolonged hold without further appearance adaptation',()=>{
  const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
  tracker.update(frame([close]),100);
  for(let i=1;i<=28;i++) {
    const result=tracker.update(frame([close],0,i*.025),100+i*100);
    assert.ok(['hold','ready'].includes(result.status),JSON.stringify({i,result}));
  }
  for(let t=3000;t<=10000;t+=100) {
    const result=tracker.update(frame([close],0,.7),t);
    assert.ok(['hold','ready'].includes(result.status),JSON.stringify({t,result}));near(result.box,close,.035);
    if(t>=4000)assert.equal(result.ready,true);
  }
  assert.equal(tracker.update(frame(),10100).ready,false,'continued confirmation stops when appearance disappears');
  assert.equal(tracker.consumeCapture(),false);
});

test('a sampling gap or backwards clock clears prior fallback views before any capture',()=>{
  for(const nextTime of [3401,2500]) {
    const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
    tracker.update(frame([close]),100);
    for(let i=1;i<=28;i++)tracker.update(frame([close],0,i*.025),100+i*100);
    const result=tracker.update(frame([close],0,.7),nextTime);
    assert.equal(result.status,'lost',JSON.stringify({nextTime,result}));assert.equal(result.ready,false);
    assert.equal(tracker.consumeCapture(),false);
    assert.equal(tracker.update(frame([close]),4000).status,'lost','expired continuity needs a fresh selection');
  }
});

test('a slow approach retains earlier trusted views while the original remains adequate',()=>{
  const tracker=new GuidedCaptureTracker();tracker.initialize(frame([close]),close,0);
  tracker.update(frame([close]),100);
  for(let i=1;i<=14;i++)tracker.update(frame([close],0,i*.025),100+i*100);
  for(let t=1600;t<=5000;t+=100)assert.ok(['hold','ready'].includes(tracker.update(frame([close],0,.35),t).status));
  for(let i=15;i<=28;i++) {
    const result=tracker.update(frame([close],0,i*.025),5100+(i-15)*100);
    assert.ok(['hold','ready'].includes(result.status),JSON.stringify({i,result}));near(result.box,close,.035);
  }
  for(let t=6500;t<=7500;t+=100)assert.ok(['hold','ready'].includes(tracker.update(frame([close],0,.7),t).status));
});
