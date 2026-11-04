import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Store} from './store.ts';
import type {PlaceStore} from './place-store.ts';
import {VisualStore} from './visual-store.ts';
export function registerVisualEvidence(app:FastifyInstance,directory:string,frames:Store,places:PlaceStore){
  const visual=new VisualStore(directory);app.addHook('onClose',async()=>visual.close());
  app.get<{Params:{id:string}}>('/api/places/:id/visual-evidence',async(request,reply)=>{
    const place=places.get(request.params.id);if(!place)return reply.code(404).send({error:'Place not found'});
    const parsed=z.strictObject({through:z.coerce.number().int().min(1).max(3).optional()}).safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:'Invalid evidence view'});
    const visits=places.frames(place.id).slice(0,parsed.data.through);
    const links=visual.links(place.id).filter(link=>visits.some(v=>v.id===link.frameId)&&frames.findRun(link.frameId,place.source==='live'?'live':'replay')?.id===link.runId);
    // Independent clips have no visit binding: never show them inside a historical visit.
    const bundles=visual.bundles(place.id).filter(b=>b.media==='image'?links.some(l=>l.bundleId===b.id):parsed.data.through===undefined&&place.source==='live');
    return {bundles,links};
  });
  app.get<{Params:{hash:string}}>('/api/visual-assets/:hash',async(request,reply)=>{
    const image=visual.asset(request.params.hash);if(!image)return reply.code(404).send({error:'Visual evidence not found'});
    return reply.type('image/png').send(image);
  });
}
