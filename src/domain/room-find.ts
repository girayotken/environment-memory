import {roomContainmentRemoval,roomContainmentOutsideEvidence} from './room-containment.ts';
import {z} from 'zod';
import type {RoomMemory} from './room-memory-contracts.ts';
import {roomLastObservation,roomNodeLabel,roomUserEdit} from '../client/room-memory-index.ts';

export const RoomFindDecisionSchema=z.strictObject({terms:z.array(z.string().min(1).max(4000)).max(8)});
export type RoomFindDecision=z.infer<typeof RoomFindDecisionSchema>;
const norm=(value:string)=>value.trim().toLocaleLowerCase('tr-TR').normalize('NFC');
/** Vocabulary contains user meaning and observed labels only, never location or source. */
export function roomFindVocabulary(rooms:RoomMemory[]){
 const values=[...new Set(rooms.flatMap(room=>room.graph.nodes.filter(node=>node.kind!=='place').flatMap(node=>{const edit=roomUserEdit(room,node.id);return [roomNodeLabel(room,node),node.label,...node.attributes,...(edit?.groups??[]),...(edit?.tags??[])];})).filter(Boolean))];
 if(values.length>1000||new TextEncoder().encode(JSON.stringify(values)).length>256_000)throw new Error('Search vocabulary exceeds the local interpreter limit');
 return values;
}
export function findRoomMemory(rooms:RoomMemory[],decision:RoomFindDecision){
 const vocabulary=new Set(roomFindVocabulary(rooms).map(norm));
 // Reject invented terms, rather than letting a model invent an answer or widen a search.
 const terms=decision.terms.map(norm);if(terms.some(term=>!vocabulary.has(term)))throw new Error('Interpreter returned a term outside the supplied vocabulary');
 const matches=terms.length?rooms.flatMap(room=>room.graph.nodes.filter(node=>node.kind!=='place').flatMap(node=>{
  const edit=roomUserEdit(room,node.id),values=[roomNodeLabel(room,node),node.label,...node.attributes,...(edit?.groups??[]),...(edit?.tags??[])].map(norm);
  if(!terms.every(term=>values.includes(term)))return [];
  const last=roomLastObservation(room,node);
  return [{roomId:room.roomId,nodeId:node.id,label:roomNodeLabel(room,node),location:last?.evidence.location??null,source:last?.source??null,containment:room.containment?.active.find(e=>e.itemId===node.id)??null,removal:roomContainmentRemoval(room,node),outsideEvidence:roomContainmentOutsideEvidence(room,node),identityMatch:last&&(last.proposal||last.continuityLink)?'probable':null}];
 })):[];
 return {status:matches.length===0?'not_found':matches.length===1?'found':'choices',matches} as const;
}


/** Only exact saved names/labels and narrow question wrappers bypass interpretation. */
export function resolveExactRoomFind(rooms:RoomMemory[],text:string):RoomFindDecision|null{
 const query=norm(text),forms=new Set([query]);
 for(const pattern of [/^where is (.+)\?$/,/^where did [iı] last see (.+)\?$/,/^(.+) nerede\?$/]){const match=query.match(pattern);if(match){forms.add(match[1]);if(match[1].startsWith('my '))forms.add(match[1].slice(3));if(match[1].startsWith('the '))forms.add(match[1].slice(4));}}
 const names=rooms.flatMap(room=>room.graph.nodes.filter(node=>node.kind!=='place').map(node=>({room,node,values:[roomNodeLabel(room,node),node.label]})));
 const matched=names.filter(entry=>entry.values.some(value=>forms.has(norm(value))));
 if(matched.length!==1)return null;
 const term=matched[0].values.find(value=>forms.has(norm(value)))!;
 // A name colliding with another object's tag/group must not widen the local answer.
 const answer=findRoomMemory(rooms,{terms:[term]});return answer.status==='found'&&answer.matches[0].roomId===matched[0].room.roomId&&answer.matches[0].nodeId===matched[0].node.id?{terms:[term]}:null;
}
