import {z} from 'zod';

const id=z.string().min(1).max(200).refine(value=>value.trim().length>0,'ID must not be blank');
const text=z.string().min(1).max(200).refine(value=>value.trim().length>0,'Text must not be blank');
const candidates=z.array(id).max(1000).refine(ids=>new Set(ids).size===ids.length,'Candidate IDs must be unique');
const targets=candidates.refine(ids=>ids.length>0,'Explicit candidate selection required');

export const ScanSessionSchema=z.strictObject({
 id,placeId:id,provenance:z.enum(['cached-model','live-model','authored-scenario']),createdAt:z.iso.datetime(),label:text,
});
export const ScanCommandSchema=z.strictObject({
 id,placeId:id,createdAt:z.iso.datetime(),actor:z.strictObject({id,kind:z.literal('user')}),
 utterance:z.string().max(4000).optional(),
 action:z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('create-group'),groupId:id,name:text,candidateIds:candidates}),
  z.strictObject({type:z.literal('rename-group'),groupId:id,name:text}),
  z.strictObject({type:z.literal('add-to-group'),groupId:id,candidateIds:targets}),
  z.strictObject({type:z.literal('remove-from-group'),groupId:id,candidateIds:targets}),
  z.strictObject({type:z.literal('set-label'),candidateIds:targets,label:text}),
  z.strictObject({type:z.literal('add-tag'),candidateIds:targets,tag:text}),
  z.strictObject({type:z.literal('remove-tag'),candidateIds:targets,tag:text}),
  z.strictObject({type:z.literal('undo'),targetCommandId:id}),
 ]),
});
export type ScanSession=z.infer<typeof ScanSessionSchema>;
export type ScanCommand=z.infer<typeof ScanCommandSchema>;
