import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {buildPlaceMemory,type Place} from '../domain/place-memory.ts';
import {activeRelationReviews} from '../domain/relation-contracts.ts';
import {buildRelationGraph,answerRelations} from '../domain/relation-graph.ts';
import {RelationStore} from './relation-store.ts';
import type {Store} from './store.ts';
import type {PlaceStore} from './place-store.ts';
export function registerRelations(app:FastifyInstance,directory:string,frames:Store,places:PlaceStore){
  const relations=new RelationStore(directory);app.addHook('onClose',async()=>relations.close());
  app.get<{Params:{id:string}}>('/api/places/:id/relations',async(request,reply)=>{
    const place:Place|null=places.get(request.params.id);if(!place)return reply.code(404).send({error:'Place not found'});
    const query=z.strictObject({q:z.string().max(200).default('Where was the drill last seen, and what was nearby?'),through:z.coerce.number().int().min(1).max(3).optional(),matching:z.enum(['natural-v2','natural-v3']).default('natural-v3'),revision:z.coerce.number().int().min(0).optional(),candidate:z.string().min(1).max(220).optional()}).safeParse(request.query);
    if(!query.success)return reply.code(400).send({error:'Invalid relation question or historical view'});
    const latest=relations.latestRevision(place.id),revision=query.data.revision??latest;
    if(revision>latest)return reply.code(400).send({error:'Unknown relation revision'});
    const memory=buildPlaceMemory(place,places.frames(place.id).slice(0,query.data.through).map(frame=>{
      const found=frames.findRun(frame.id,place.source==='live'?'live':'replay');
      return {frame,run:place.source==='authored_fixture'&&found?.provenance!=='authored_fixture'?null:found};
    }),query.data.matching);
    const graph=buildRelationGraph(memory,activeRelationReviews(relations.events(place.id,revision)));
    try{return answerRelations(memory,graph,query.data.q,revision,query.data.candidate);}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'Relation question failed'});}
  });
}
