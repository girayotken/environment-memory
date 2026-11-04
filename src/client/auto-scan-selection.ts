/** Bounded rendered-pixel selection aid. It does not detect objects or infer identity. */
export type AutoScanPixels = {width:number;height:number;data:ArrayLike<number>};
export type AutoScanDecision = {accept:boolean;reason:'steady'|'moving'|'low-detail'|'duplicate'|'cooldown'|'limit'|'invalid';savedCount:number};
type Signature={values:number[];contrast:number;detail:number};
const distance=(a:Signature,b:Signature)=>a.values.reduce((sum,value,i)=>sum+Math.abs(value-b.values[i]),0)/a.values.length;

/** Fixed-size spatial colour cells retain local changes without simulator metadata. */
function signature(pixels:AutoScanPixels):Signature|null {
 const {width,height,data}=pixels;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||data.length!==width*height*4)return null;
 const values:number[]=[];const luminance:number[]=[];
 for(let cy=0;cy<12;cy++)for(let cx=0;cx<16;cx++){
  const sums=[0,0,0];let count=0;
  const x0=Math.floor(cx*width/16),x1=Math.floor((cx+1)*width/16),y0=Math.floor(cy*height/12),y1=Math.floor((cy+1)*height/12);
  for(let y=y0;y<y1;y+=Math.max(1,Math.floor((y1-y0)/4)))for(let x=x0;x<x1;x+=Math.max(1,Math.floor((x1-x0)/4))){
   const offset=(y*width+x)*4;
   for(let c=0;c<3;c++){const value=data[offset+c];if(!Number.isFinite(value)||value<0||value>255)return null;sums[c]+=value/255;}
   if(data[offset+3]!==255)return null;
   count++;
  }
  const rgb=sums.map(value=>value/count);values.push(...rgb);luminance.push(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722);
 }
 const mean=luminance.reduce((a,b)=>a+b,0)/luminance.length;
 const contrast=Math.sqrt(luminance.reduce((sum,value)=>sum+(value-mean)**2,0)/luminance.length);
 let detail=0,edges=0;
 for(let y=0;y<12;y++)for(let x=0;x<16;x++){const i=y*16+x;if(x){detail+=Math.abs(luminance[i]-luminance[i-1]);edges++;}if(y){detail+=Math.abs(luminance[i]-luminance[i-16]);edges++;}}
 return {values,contrast,detail:detail/edges};
}

export class AutoScanSelection {
 private previous:Signature|null=null;
 private anchor:Signature|null=null;
 private stableSince:number|null=null;
 private lastTime:number|null=null;
 private lastSavedAt=-Infinity;
 private pending:{signature:Signature;time:number}|null=null;
 private saved:Signature[]=[];
 readonly maxFrames:number;
 constructor(options:{maxFrames?:number}={}){this.maxFrames=Math.max(1,Math.min(12,Math.floor(options.maxFrames??12)||12));}
 get savedCount(){return this.saved.length;}
 reset(){this.previous=null;this.anchor=null;this.stableSince=null;this.lastTime=null;this.lastSavedAt=-Infinity;this.pending=null;this.saved=[];}
 evaluate(pixels:AutoScanPixels,nowMs:number):AutoScanDecision {
  this.pending=null;
  const result=(reason:AutoScanDecision['reason']):AutoScanDecision=>({accept:reason==='steady',reason,savedCount:this.savedCount});
  if(this.savedCount>=this.maxFrames)return result('limit');
  const current=signature(pixels);
  if(!current||!Number.isFinite(nowMs)||nowMs<0){this.previous=null;this.anchor=null;this.stableSince=null;this.lastTime=null;return result('invalid');}
  const gap=this.lastTime===null?Infinity:nowMs-this.lastTime;this.lastTime=nowMs;
  if(current.contrast<.035||current.detail<.009){this.previous=null;this.anchor=null;this.stableSince=null;return result('low-detail');}
  // The anchor also catches slow drift that adjacent-frame comparison alone misses.
  const stable=gap>=100&&gap<=1000&&this.previous&&this.anchor&&distance(current,this.previous)<.012&&distance(current,this.anchor)<.009;
  this.previous=current;
  if(!stable){this.anchor=current;this.stableSince=nowMs;return result('moving');}
  if(nowMs-(this.stableSince??nowMs)<700)return result('moving');
  if(this.saved.some(old=>distance(current,old)<.025))return result('duplicate');
  if(nowMs-this.lastSavedAt<1500)return result('cooldown');
  this.pending={signature:current,time:nowMs};return result('steady');
 }
 /** Commit only after the caller has successfully saved the selected frame. */
 markSaved(){if(!this.pending||this.savedCount>=this.maxFrames)return;this.saved.push(this.pending.signature);this.lastSavedAt=this.pending.time;this.pending=null;}
}
