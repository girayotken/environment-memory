/** Pure trial contracts. Importing this file cannot call a provider. */
import {z} from 'zod';
export const LIMITS=Object.freeze({frames:3,museCalls:6,samCalls:18,totalCalls:24,capUsd:.30,inputTokens:16384,outputTokens:4096,maxConcepts:6,maxRegions:12,timeoutMs:60000});
export const discoverySchema=z.strictObject({concepts:z.array(z.string().min(1).max(80)).max(6),observations:z.array(z.strictObject({label:z.string(),appearance:z.string(),locationDescription:z.string(),uncertainty:z.string()})).max(12)});
export const namingSchema=z.strictObject({regions:z.array(z.strictObject({regionId:z.string(),label:z.string(),appearance:z.string(),uncertainty:z.string()})).max(12)});
export const DISCOVERY_PROMPT='Inspect this image. List up to 6 short concrete object-category phrases covering the visible portable tabletop objects for segmentation. No furniture, invented IDs, hidden contents or unseen events. Also describe up to 12 distinct visible portable objects with label, appearance, locationDescription and uncertainty. Keep each field under 16 words. Return JSON with concepts and observations.';
export const NAMING_PROMPT='The first image is source context. Subsequent images are anonymous regions cut from that exact source. For each supplied regionId describe only the cutout foreground: label, appearance and uncertainty. Do not borrow a neighbour attribute or infer hidden details. Use a broad name if subtype is unclear. Return JSON with regions; exactly one entry per supplied regionId. No identity or cross-visit claim.';
export const museMaximum=()=> (LIMITS.inputTokens*1.25+LIMITS.outputTokens*4.25)/1e6;
export interface Attempt{key:string;kind:'muse'|'sam';reservedUsd:number;actualUsd?:number;status:string;[key:string]:unknown}
export function reserve(attempts:Attempt[],key:string,kind:Attempt['kind']){
 if(attempts.some(a=>a.key===key))throw new Error('Duplicate attempt; no retry');
 if(attempts.some(a=>a.status!=='completed'||(a.actualUsd??0)>a.reservedUsd+1e-9))throw new Error('Prior incomplete/over-budget attempt; stop');
 if(attempts.length>=LIMITS.totalCalls||attempts.filter(a=>a.kind===kind).length>=(kind==='muse'?LIMITS.museCalls:LIMITS.samCalls))throw new Error('Call cap');
 const amount=kind==='muse'?museMaximum():.0025;
 if(attempts.reduce((n,a)=>n+Math.max(a.reservedUsd,a.actualUsd??0),0)+amount>LIMITS.capUsd+1e-9)throw new Error('Cost cap');
 return amount;
}
export function validateNames(data:unknown,ids:string[]){
 const result=namingSchema.parse(data),seen=result.regions.map(r=>r.regionId);
 if(seen.length!==ids.length||new Set(seen).size!==seen.length||seen.some(id=>!ids.includes(id)))throw new Error('Region/name association mismatch');
 return result;
}
