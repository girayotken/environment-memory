import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoScanSelection,type AutoScanPixels} from '../src/client/auto-scan-selection.ts';
function scene(change=0):AutoScanPixels {
 const width=64,height=48,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,v=((Math.floor(x/4)+Math.floor(y/4))%2)?190:55;
  data[i]=x<width/3?Math.min(255,v+change):v;data[i+1]=v;data[i+2]=v;data[i+3]=255;
 }
 return {width,height,data};
}
function hold(policy:AutoScanSelection,pixels:AutoScanPixels,start:number){let result=policy.evaluate(pixels,start);for(let t=start+250;t<=start+1000;t+=250)result=policy.evaluate(pixels,t);return result;}
test('initial stable scene is selected; only a successful save commits deduplication',()=>{
 const policy=new AutoScanSelection();assert.equal(policy.evaluate(scene(),0).accept,false);
 assert.equal(hold(policy,scene(),250).accept,true);assert.equal(policy.savedCount,0);
 policy.markSaved();assert.equal(policy.savedCount,1);policy.markSaved();assert.equal(policy.savedCount,1);
 assert.equal(policy.evaluate(scene(),1500).reason,'duplicate');
});
test('continued movement, blank and invalid samples are never selected',()=>{
 const policy=new AutoScanSelection();
 for(let t=0;t<4000;t+=250)assert.equal(policy.evaluate(scene(t%500?100:0),t).accept,false);
 const blank=scene();(blank.data as Uint8ClampedArray).fill(255);
 assert.equal(policy.evaluate(blank,4000).reason,'low-detail');
 assert.equal(policy.evaluate({...scene(),data:[]},4250).reason,'invalid');
 assert.equal(policy.evaluate(scene(),4500).accept,false,'invalid input restarts stability');
});
test('modest local stable changes are accepted, revisits deduplicated, cap enforced',()=>{
 const policy=new AutoScanSelection({maxFrames:2});assert.equal(hold(policy,scene(),0).accept,true);policy.markSaved();
 assert.equal(hold(policy,scene(90),2000).accept,true);policy.markSaved();
 assert.equal(policy.savedCount,2);assert.equal(hold(policy,scene(150),4000).reason,'limit');
 const revisit=new AutoScanSelection();hold(revisit,scene(),0);revisit.markSaved();hold(revisit,scene(90),2000);revisit.markSaved();
 assert.equal(hold(revisit,scene(),4000).reason,'duplicate');revisit.reset();assert.equal(hold(revisit,scene(),0).accept,true);
});
test('long interruptions and reversed clocks restart stability',()=>{
 const policy=new AutoScanSelection();hold(policy,scene(),0);
 assert.equal(policy.evaluate(scene(),5000).accept,false);assert.equal(policy.evaluate(scene(),4900).accept,false);
 assert.equal(hold(policy,scene(),5150).accept,true);
});
test('slow drift cannot accumulate indefinitely within adjacent stability threshold',()=>{
 const policy=new AutoScanSelection();
 for(let t=0;t<4000;t+=250){const pixels=scene();for(let i=1;i<pixels.data.length;i+=4)(pixels.data as Uint8ClampedArray)[i]=30+t/250*10;assert.equal(policy.evaluate(pixels,t).accept,false);}
});
