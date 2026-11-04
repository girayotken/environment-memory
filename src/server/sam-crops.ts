import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {decodeMaskToRaster,recordsOfKind,type SegmentationResult} from '@meta-sam/parser';
import {VisualBundleSchema,type VisualBundle} from '../domain/visual-evidence.ts';
export const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');

/** Original source RGB is copied verbatim; only mask background alpha is removed. */
export function buildSamCrops(input:{placeId:string;result:SegmentationResult;sourceSha256:string;concept:string;recordedAt:string;width:number;height:number},frames:Map<number,Buffer>){
  const {result}=input;
  if(result.outcome.status!=='completed'||result.diagnostics.some(d=>d.severity==='error'))throw new Error('Completed valid SAM evidence required');
  const recordsSha256=digest(JSON.stringify(result.records));
  const id=digest(JSON.stringify({version:1,placeId:input.placeId,media:result.media,source:input.sourceSha256,recordsSha256,concept:input.concept}));
  const assets=new Map<string,Buffer>(),decoded=new Map<number,PNG>(),seen=new Set<string>();
  const add=(bytes:Buffer)=>{const hash=digest(bytes);assets.set(hash,bytes);return hash;};
  const masks=recordsOfKind(result.records,'mask');
  if(masks.length>512)throw new Error('Bounded crop import exceeded');
  const segments=masks.map(m=>{
    const index=m.frame?.frameIndex??0,key=`${index}:${m.objectId}`;
    if(!/^\d{1,8}$/.test(m.objectId)||!Number.isInteger(index)||index<0||seen.has(key))throw new Error('Invalid or duplicate local track/frame');
    seen.add(key);
    const bytes=frames.get(index);if(!bytes)throw new Error('Exact source frame required');
    if(result.media==='image'&&digest(bytes)!==input.sourceSha256)throw new Error('Source image hash mismatch');
    let png=decoded.get(index);if(!png){png=PNG.sync.read(bytes);decoded.set(index,png);}
    if(png.width!==input.width||png.height!==input.height||Math.max(png.width,png.height)>640)throw new Error('Source dimensions mismatch');
    const b=m.bounds,coordinates=[b.left,b.top,b.right,b.bottom];
    if(!coordinates.every(Number.isInteger)||b.left<0||b.top<0||b.right>png.width||b.bottom>png.height||b.right<=b.left||b.bottom<=b.top||b.right-b.left!==m.mask.width||b.bottom-b.top!==m.mask.height)throw new Error('Mask bounds mismatch');
    const raster=decodeMaskToRaster(m.mask),foregroundPixels=raster.reduce((n,v)=>n+v,0);
    if(!foregroundPixels)throw new Error('Empty mask cannot create object evidence');
    const cutout=new PNG({width:m.mask.width,height:m.mask.height});
    for(let y=0;y<cutout.height;y++)for(let x=0;x<cutout.width;x++){
      const target=(y*cutout.width+x)*4,source=((b.top+y)*png.width+b.left+x)*4;
      if(raster[y*cutout.width+x])png.data.copy(cutout.data,target,source,source+4);
      else cutout.data.fill(0,target,target+4);
    }
    const left=Math.max(0,b.left-8),top=Math.max(0,b.top-8),right=Math.min(png.width,b.right+8),bottom=Math.min(png.height,b.bottom+8);
    const context=new PNG({width:right-left,height:bottom-top});
    for(let y=0;y<context.height;y++)png.data.copy(context.data,y*context.width*4,((top+y)*png.width+left)*4,((top+y)*png.width+right)*4);
    return {id:digest(`${id}:${key}`),trackId:m.objectId,frameIndex:index,sourceAsset:add(bytes),cutoutAsset:add(PNG.sync.write(cutout)),contextAsset:add(PNG.sync.write(context)),bounds:b,width:cutout.width,height:cutout.height,foregroundPixels};
  });
  const bundle:VisualBundle=VisualBundleSchema.parse({id,placeId:input.placeId,media:result.media,model:'sam-3.1',concept:input.concept,sourceSha256:input.sourceSha256,recordsSha256,recordedAt:input.recordedAt,width:input.width,height:input.height,pixelSource:result.media==='image'?'exact-saved-still':'decoded-uploaded-video',placeAssociation:'operator-declared',segments});
  return {bundle,assets};
}
