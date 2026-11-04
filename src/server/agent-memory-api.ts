import {roomContainmentRemoval,roomContainmentOutsideEvidence} from '../domain/room-containment.ts';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import {RoomEditDecisionSchema,RoomEditMessageSchema,RoomEditUndoSchema} from '../domain/room-user-edit.ts';
import {roomLastObservation,roomNodeLabel,roomUserEdit} from '../client/room-memory-index.ts';
import {RoomMemoryStore,RoomMemoryValidationError,RoomMemoryConflictError} from './room-memory-store.ts';
import type {RoomMemory,RoomGraph} from '../domain/room-memory-contracts.ts';

const ifRevision=z.string().regex(/^[a-f0-9]{64}$/).optional();
const id=z.string().min(1).max(200), page={limit:z.number().int().min(1).max(20).optional(),cursor:z.string().max(1000).optional()};
export const AgentReadSchema=z.discriminatedUnion('op',[
 z.strictObject({op:z.literal('rooms'),ifRevision,...page}),
 z.strictObject({op:z.literal('objects'),ifRevision,roomId:id,term:z.string().trim().min(1).max(200).optional(),...page}),
 z.strictObject({op:z.literal('find'),ifRevision,roomId:id.optional(),term:z.string().trim().min(1).max(200),...page}),
 z.strictObject({op:z.literal('object'),ifRevision,roomId:id,nodeId:id})
]);
export const AgentEditSchema=RoomEditMessageSchema.extend({changes:RoomEditDecisionSchema.options[1].shape.changes});
export const AgentUndoSchema=RoomEditUndoSchema;
const norm=(s:string)=>s.trim().toLowerCase().normalize('NFC');
const short=(s:string)=>s.slice(0,500);
type Node=RoomGraph['nodes'][number];
function summary(room:RoomMemory,node:Node){
 const personal=roomUserEdit(room,node.id),last=roomLastObservation(room,node);
 return {roomId:room.roomId,nodeId:node.id,label:short(roomNodeLabel(room,node)),observedLabel:short(node.label),kind:node.kind,status:node.status,
  personal:{revision:personal?.revision??0,name:personal?.name??null,groups:(personal?.groups??[]).slice(0,20),tags:(personal?.tags??[]).slice(0,20),groupsOmitted:Math.max(0,(personal?.groups.length??0)-20),tagsOmitted:Math.max(0,(personal?.tags.length??0)-20),lastRevisionId:personal?.lastRevisionId??null},
  supportEvidence:(room.supportEvidence??[]).filter(e=>e.itemId===node.id).slice(-10),
  containment:room.containment?.active.find(e=>e.itemId===node.id)??null,removal:roomContainmentRemoval(room,node),outsideEvidence:roomContainmentOutsideEvidence(room,node),
  lastSeen:last?{identityMatch:last.proposal||last.continuityLink?'probable':null,location:last.evidence.location?short(last.evidence.location):null,capturedAt:last.source.capturedAt,source:{viewId:last.source.viewId,sourceHash:last.source.sourceHash,imageUrl:last.source.imageUrl}}:null};
}
function matches(room:RoomMemory,node:Node,term:string){const p=roomUserEdit(room,node.id);return [roomNodeLabel(room,node),node.label,...node.attributes,...(p?.groups??[]),...(p?.tags??[])].some(v=>norm(v).includes(norm(term)));}
function paginate<T>(items:T[],q:{limit?:number;cursor?:string},binding:unknown){
 const digest=createHash('sha256').update(JSON.stringify(binding)).digest('hex');let offset=0;
 if(q.cursor){let cursor:unknown;try{cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString('utf8'));}catch{throw new RoomMemoryValidationError('Invalid cursor');}const c=z.strictObject({digest:z.string().length(64),offset:z.number().int().nonnegative()}).safeParse(cursor);if(!c.success)throw new RoomMemoryValidationError('Invalid cursor');if(c.data.digest!==digest)throw new RoomMemoryConflictError('Memory or query changed; restart pagination');offset=c.data.offset;if(offset>items.length)throw new RoomMemoryValidationError('Invalid cursor');}
 const limit=q.limit??10,selected:T[]=[];let end=offset,bytes=0;while(end<items.length&&selected.length<limit){const size=Buffer.byteLength(JSON.stringify(items[end]));if(selected.length&&bytes+size>32_000)break;selected.push(items[end]);bytes+=size;end++;}return {items:selected,nextCursor:end<items.length?Buffer.from(JSON.stringify({digest,offset:end})).toString('base64url'):null};
}
export function registerAgentMemoryApi(app:FastifyInstance,store:RoomMemoryStore){
 const guard=(request:{headers:{origin?:string;host?:string;'sec-fetch-site'?:string}})=>{const host=request.headers.host??'';if(!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host))return false;return !((request.headers.origin&&request.headers.origin!==`http://${host}`)||request.headers['sec-fetch-site']==='cross-site');};
 const route=(path:string,handler:(body:unknown)=>unknown)=>app.post(path,{bodyLimit:16_384},async(request,reply)=>{if(!guard(request))return reply.code(403).send({error:'Same-origin access required'});try{return handler(request.body);}catch(error){if(error instanceof z.ZodError||error instanceof RoomMemoryValidationError)return reply.code(400).send({error:error instanceof z.ZodError?'Invalid request':error.message});if(error instanceof RoomMemoryConflictError)return reply.code(409).send({error:error.message});throw error;}});
 route('/api/agent/v1/read',body=>{const q=AgentReadSchema.parse(body),rooms=store.read().rooms;const {ifRevision:conditional,...query}=q;
  const read=()=>{if(q.op==='object'){const room=rooms.find(r=>r.roomId===q.roomId),node=room?.graph.nodes.find(n=>n.id===q.nodeId&&n.kind!=='place');if(!room||!node)throw new RoomMemoryValidationError('Unknown room or object');const result=summary(room,node);return {...result,attributes:node.attributes.slice(0,20).map(short),attributesOmitted:Math.max(0,node.attributes.length-20),evidenceOmitted:Math.max(0,node.evidence.length-10),evidence:node.evidence.slice(0,10).map(e=>({viewId:e.viewId,basis:short(e.basis),location:e.location?short(e.location):null}))};}
  const binding={query:{...query,cursor:undefined},rooms};
  if(q.op==='rooms')return paginate(rooms.map(room=>({roomId:room.roomId,label:short(room.label),objectCount:room.graph.nodes.filter(n=>n.kind!=='place').length})),q,binding);
  if(q.roomId&&!rooms.some(r=>r.roomId===q.roomId))throw new RoomMemoryValidationError('Unknown room');
  const items=rooms.filter(r=>!q.roomId||r.roomId===q.roomId).flatMap(room=>room.graph.nodes.filter(n=>n.kind!=='place'&&(!q.term||matches(room,n,q.term))).map(n=>summary(room,n)));
  return paginate(items,q,binding);};
  const result=read(),revision=createHash('sha256').update(JSON.stringify({query,result})).digest('hex');return conditional===revision?{revision,unchanged:true}:{revision,...result};
 });
 route('/api/agent/v1/edit',body=>{const p=AgentEditSchema.parse(body),{changes,...message}=p;if(changes.some(change=>!p.text.includes(change.value)))throw new RoomMemoryValidationError('Edit values must occur exactly in the original message');const decision={status:'apply' as const,reply:'Personal memory updated.',changes};store.applyUserEdit(message,decision);return {status:'applied',roomId:p.roomId,nodeId:p.nodeId,revisionId:p.operationId,revision:p.expectedRevision+1};});
 route('/api/agent/v1/undo',body=>{const p=AgentUndoSchema.parse(body);store.undoUserEdit(p);return {status:'undone',roomId:p.roomId,nodeId:p.nodeId,revisionId:p.operationId,revision:p.expectedRevision+1};});
}
