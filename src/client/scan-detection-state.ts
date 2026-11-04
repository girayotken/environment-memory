import {z} from 'zod';
export type FrameAnalysis={frameId:string;status:'processing'|'completed'|'empty'|'error';placeId:string|null;candidateCount:number;error:string|null};
export type DetectionState={enabled:boolean;reason:string|null;budget:{requests:number;requestLimit:number;capUsd:number;reservedUsd:number;estimatedUsd:number};analyses:FrameAnalysis[]};
export function detectionLabel(analysis?:FrameAnalysis){
 if(!analysis)return 'Not analyzed';
 if(analysis.status==='processing')return 'Detecting objects…';
 if(analysis.status==='completed')return `${analysis.candidateCount} provisional candidate${analysis.candidateCount===1?'':'s'}`;
 if(analysis.status==='empty')return 'No objects detected';
 return 'Detection failed';
}
const analysisSchema=z.object({frameId:z.string().min(1),status:z.enum(['processing','completed','empty','error']),placeId:z.string().min(1).nullable(),candidateCount:z.number().int().nonnegative(),error:z.string().nullable()}).superRefine((value,ctx)=>{if(value.status==='completed'&&(!value.placeId||value.candidateCount===0))ctx.addIssue({code:'custom',message:'Completed detection must identify its source place and candidates'});});
const amount=z.number().finite().nonnegative();
const stateSchema=z.object({enabled:z.boolean(),reason:z.string().nullable(),budget:z.object({requests:amount.int(),requestLimit:amount.int(),capUsd:amount,reservedUsd:amount,estimatedUsd:amount}),analyses:z.array(analysisSchema)});
export const parseDetectionState=(value:unknown):DetectionState=>stateSchema.parse(value);
export function parseAnalysisResponse(value:unknown,frameId:string):{analysis:FrameAnalysis}{const data=z.object({analysis:analysisSchema}).parse(value);if(data.analysis.frameId!==frameId)throw new Error('Detection response belongs to a different saved frame');return data;}
export class DetectionHttpError extends Error{constructor(message:string,readonly status:number){super(message);this.name='DetectionHttpError';}}
export function definiteDetectionRejection(error:unknown){return error instanceof DetectionHttpError&&error.status>=400&&error.status<500;}
export async function detectionResponse<T>(res:Response,parse:(value:unknown)=>T):Promise<T>{
 if(!res.ok){let message=`Request failed (${res.status})`;try{const data=await res.json();if(typeof data?.error==='string')message=data.error;}catch{/* Status remains a definite HTTP rejection. */}throw new DetectionHttpError(message,res.status);}
 return parse(await res.json());
}

/** Eligibility is evaluated only by the explicit saved-frame action. Reads never invoke it. */
export function canStartDetection(input:{saved:boolean;enabled:boolean;recording:boolean;locked:boolean;existing?:FrameAnalysis;uncertain:boolean}){
 return input.saved&&input.enabled&&!input.recording&&!input.locked&&!input.existing&&!input.uncertain;
}

export function canCheckSameDetection(input:{saved:boolean;recording:boolean;locked:boolean;existing?:FrameAnalysis;uncertain:boolean}){return input.saved&&!input.recording&&!input.locked&&!input.existing&&input.uncertain;}
