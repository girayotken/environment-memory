import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.ts';
import { PlaceStore } from './place-store.ts';
import { buildPlaceMemory, searchPlaceMemory, type Place,type PlaceMatcherRevision } from '../domain/place-memory.ts';

export function registerPlaces(app:FastifyInstance,directory:string,frames:Store){
  const places=new PlaceStore(directory);app.addHook('onClose',async()=>places.close());
  const memory=(place:Place,through?:number,revision?:PlaceMatcherRevision)=>buildPlaceMemory(place,places.frames(place.id).slice(0,through).map(frame=>{
    const found=frames.findRun(frame.id,place.source==='live'?'live':'replay');
    const run=place.source==='authored_fixture'&&found?.provenance!=='authored_fixture'?null:found;
    return {frame,run};
  }),revision);
  app.get('/api/places',async()=>places.list());
  app.post('/api/places',async(request,reply)=>{
    const parsed=z.strictObject({name:z.string().trim().min(1).max(80),source:z.enum(['live','authored_fixture'])}).safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:'Choose a named place and explicit observation source.'});
    return places.create(parsed.data.name,parsed.data.source);
  });
  app.get<{Params:{id:string}}>('/api/places/:id/memory',async(request,reply)=>{
    const place=places.get(request.params.id);if(!place)return reply.code(404).send({error:'Place not found'});
    const query=z.strictObject({through:z.coerce.number().int().min(1).max(3).optional(),q:z.string().max(160).optional(),matching:z.enum(['natural-v2','natural-v3']).optional()}).safeParse(request.query);
    if(!query.success)return reply.code(400).send({error:'Invalid memory view'});
    const result=memory(place,query.data.through,query.data.matching);return {...result,results:searchPlaceMemory(result,query.data.q??'')};
  });
  app.post<{Params:{id:string}}>('/api/places/:id/visits',async(request,reply)=>{
    const parsed=z.strictObject({frameId:z.uuid()}).safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'Choose a saved frame.'});
    const frame=frames.getFrame(parsed.data.frameId);if(!frame)return reply.code(404).send({error:'Frame not found'});
    const {run:_run,...snapshot}=frame;
    try{return places.append(request.params.id,snapshot);}catch(error){return reply.code(422).send({error:error instanceof Error?error.message:'Visit not saved'});}
  });
  return places;
}
