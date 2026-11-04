import {PNG} from 'pngjs';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {VisualStore} from './visual-store.ts';
import type {Store} from './store.ts';
import type {PlaceStore} from './place-store.ts';
import {buildPlaceMemory} from '../domain/place-memory.ts';
import {answerAutomaticRelations,extractAutomaticRelations,type SamMask} from '../domain/automatic-relations.ts';
import {foregroundColor,nameSameImageMasks,type MaskColorProfile} from '../domain/mask-naming.ts';
/** All pixels are read from hash-verified local SAM cutouts; no inference client. */
export function loadSamMasks(visual:VisualStore,placeId:string):SamMask[]{
 const masks:SamMask[]=[];
 for(const bundle of visual.bundles(placeId))for(const segment of bundle.segments){
  const bytes=visual.asset(segment.cutoutAsset);if(!bytes)throw new Error('Missing cached SAM mask');
  const image=PNG.sync.read(bytes),pixels:number[]=[],boundary:[number,number][]=[];
  if(image.width!==segment.width||image.height!==segment.height)throw new Error('SAM mask dimensions disagree');
  const foreground=(x:number,y:number)=>x>=0&&y>=0&&x<image.width&&y<image.height&&image.data[(y*image.width+x)*4+3]>0;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(foreground(x,y)){
   pixels.push((y+segment.bounds.top)*bundle.width+x+segment.bounds.left);
   if(!foreground(x-1,y)||!foreground(x+1,y)||!foreground(x,y-1)||!foreground(x,y+1))boundary.push([x+segment.bounds.left,y+segment.bounds.top]);
  }
  if(pixels.length!==segment.foregroundPixels)throw new Error('SAM foreground count disagrees');
  masks.push({bundle,segment,pixels,boundary});
 }
 return masks;
}
export function loadMaskColorProfiles(visual:VisualStore,masks:SamMask[]):Record<string,MaskColorProfile>{
 return Object.fromEntries(masks.filter(m=>m.bundle.media==='image').map(m=>{
  const bytes=visual.asset(m.segment.cutoutAsset);if(!bytes)throw new Error('Missing cached SAM color pixels');
  const image=PNG.sync.read(bytes);if(image.width!==m.segment.width||image.height!==m.segment.height)throw new Error('SAM color dimensions disagree');
  return [m.segment.id,foregroundColor(image.data)];
 }));
}
export function registerAutomaticRelations(app:FastifyInstance,directory:string,frames:Store,places:PlaceStore){
 const visual=new VisualStore(directory);app.addHook('onClose',async()=>visual.close());
 app.get<{Params:{id:string}}>('/api/places/:id/automatic-relations',async(request,reply)=>{
  const place=places.get(request.params.id);if(!place)return reply.code(404).send({error:'Place not found'});
  const query=z.strictObject({q:z.string().max(200).default('Where was the drill last seen, and what was nearby?'),through:z.coerce.number().int().min(1).max(3).optional(),matching:z.enum(['natural-v2','natural-v3']).default('natural-v3'),candidate:z.string().min(1).max(220).optional(),naming:z.literal('automatic-v1').optional()}).safeParse(request.query);
  if(!query.success)return reply.code(400).send({error:'Invalid automatic relation question'});
  const memory=buildPlaceMemory(place,places.frames(place.id).slice(0,query.data.through).map(frame=>{
   const run=frames.findRun(frame.id,place.source==='live'?'live':'replay');return {frame,run:place.source==='authored_fixture'&&run?.provenance!=='authored_fixture'?null:run};
  }),query.data.matching);
  try{
   // Independent clips have no visit assignment. Exclude them from every explicit historical view.
   const masks=loadSamMasks(visual,place.id).filter(m=>query.data.through===undefined||m.bundle.media==='image');
   if(query.data.naming){
    const naming=nameSameImageMasks(memory,masks,loadMaskColorProfiles(visual,masks));
    const view=answerAutomaticRelations(memory,extractAutomaticRelations(memory,masks,naming.links),query.data.q,query.data.candidate);
    return {...view,maskNaming:naming};
   }
   return answerAutomaticRelations(memory,extractAutomaticRelations(memory,masks,visual.links(place.id)),query.data.q,query.data.candidate);
  }catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'Automatic relation extraction failed'});}
 });
}
