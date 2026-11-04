import {PNG} from 'pngjs';
import {decodeMaskToRaster,type SegmentationMaskRecord} from '@meta-sam/parser';

/** SAM raster coordinates are local to its source-pixel box, not necessarily 1:1. */
export function cropRegion(source:PNG,m:SegmentationMaskRecord){
 const b=m.bounds,coords=[b.left,b.top,b.right,b.bottom],width=b.right-b.left,height=b.bottom-b.top;
 if(!coords.every(Number.isInteger)||b.left<0||b.top<0||b.right>source.width||b.bottom>source.height||width<=0||height<=0||!Number.isInteger(m.mask.width)||!Number.isInteger(m.mask.height)||m.mask.width<=0||m.mask.height<=0)throw new Error('Invalid source-bound region');
 return cropRaster(source,b,decodeMaskToRaster(m.mask),m.mask.width,m.mask.height);
}
export function cropRaster(source:PNG,b:{left:number;top:number;right:number;bottom:number},raster:Uint8Array,rw:number,rh:number){
 const width=b.right-b.left,height=b.bottom-b.top;
 if(![rw,rh,width,height,b.left,b.top].every(Number.isInteger)||Math.min(rw,rh,width,height)<=0||b.left<0||b.top<0||b.right>source.width||b.bottom>source.height||raster.length!==rw*rh||raster.some(v=>v!==0&&v!==1))throw new Error('Invalid raster mapping');
 const crop=new PNG({width,height}),pixels=new Set<number>();
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sx=Math.min(rw-1,Math.floor((x+.5)*rw/width)),sy=Math.min(rh-1,Math.floor((y+.5)*rh/height));
  if(raster[sy*rw+sx]){const index=(b.top+y)*source.width+b.left+x;pixels.add(index);source.data.copy(crop.data,(y*width+x)*4,index*4,index*4+4);}
 }
 return {crop,pixels};
}
