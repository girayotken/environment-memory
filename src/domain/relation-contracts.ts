import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const common={id:hash,placeId:z.uuid(),reviewer:z.literal('agent'),createdAt:z.iso.datetime(),note:z.string().min(1).max(600)};
const bounds=z.strictObject({left:z.number().int().min(0),top:z.number().int().min(0),right:z.number().int().positive(),bottom:z.number().int().positive()}).refine(b=>b.right>b.left&&b.bottom>b.top,'Invalid region');
export const RelationReviewSchema=z.discriminatedUnion('action',[
  z.strictObject({...common,action:z.literal('assert'),frameId:z.uuid(),runId:z.uuid(),index:z.number().int().min(0).max(29),imageHash:hash,
    surfaceKey:z.string().regex(/^[a-z0-9-]{1,80}$/),surfaceLabel:z.string().min(1).max(100),bounds,
    regionMethod:z.enum(['existing-sam-mask','agent-reviewed-box']),bundleId:hash.optional(),segmentId:hash.optional(),supersedes:hash.optional()}),
  z.strictObject({...common,action:z.literal('retract'),targetId:hash}),
]);
export type RelationReview=z.infer<typeof RelationReviewSchema>;
export type RegionReview=Extract<RelationReview,{action:'assert'}>;
export interface ReviewRevision{revision:number;event:RelationReview}
export function activeRelationReviews(events:ReviewRevision[]):RegionReview[]{
  const active=new Map<string,RegionReview>();
  for(const {event} of events){if(event.action==='retract')active.delete(event.targetId);else{if(event.supersedes)active.delete(event.supersedes);active.set(event.id,event);}}
  return [...active.values()];
}
