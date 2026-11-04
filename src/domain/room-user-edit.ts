import {z} from 'zod';
const id=z.string().min(1).max(200);
const value=z.string().min(1).max(200).refine(s=>s.trim().length>0);
export const RoomEditMessageSchema=z.strictObject({operationId:id,roomId:id,nodeId:id,expectedRevision:z.number().int().nonnegative(),text:z.string().min(1).max(2000).refine(s=>s.trim().length>0)});
export const RoomEditUndoSchema=z.strictObject({operationId:id,roomId:id,nodeId:id,expectedRevision:z.number().int().nonnegative(),revisionId:id});
export const RoomEditDecisionSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('clarify'),reply:z.string().min(1).max(500)}),
 z.strictObject({status:z.literal('apply'),reply:z.string().min(1).max(500),changes:z.array(z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('name'),value}),z.strictObject({kind:z.literal('addGroup'),value}),z.strictObject({kind:z.literal('removeGroup'),value}),z.strictObject({kind:z.literal('addTag'),value}),z.strictObject({kind:z.literal('removeTag'),value})
 ])).min(1).max(10)})
]);
export type RoomEditDecision=z.infer<typeof RoomEditDecisionSchema>;
export type RoomUserEdit={nodeId:string;revision:number;name:string|null;groups:string[];tags:string[];lastRevisionId:string|null};
