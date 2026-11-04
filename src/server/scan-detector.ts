import {CAPTURE_MAX_DIMENSION, CAPTURE_MAX_PNG_BYTES} from '../domain/capture-contracts.ts';
/** Real source-pixel detector. No authored or whole-frame fallback. */
import OpenAI from 'openai';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {z} from 'zod';
import {parseImageStream,recordsOfKind,type SegmentationResult,type ResponsesEvent} from '@meta-sam/parser';
import {cropRegion} from '../../scripts/qualification-regions.ts';
import {DetectionBudget} from './scan-detection-budget.ts';
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export interface DetectionInput {frame:{id:string;sourceHash:string;width:number;height:number;capturedAt:string};bytes:Buffer}
export interface DetectionResult {model:string;sourceHash:string;regions:{bounds:{left:number;top:number;right:number;bottom:number};crop:Buffer;label:string|null}[];receipt:Record<string,unknown>}
export type DetectionProvider=(input:DetectionInput)=>Promise<DetectionResult>;
export interface DetectionTransport {
 count(request:ReturnType<typeof discoveryRequest>):Promise<number>;
 discover(request:ReturnType<typeof discoveryRequest>):Promise<{id:string;status?:string|null;output_text:string;usage?:{input_tokens:number;output_tokens:number}|null}>;
 segment(bytes:Buffer,concept:string,record?:(receipt:Record<string,unknown>)=>void):Promise<{result:SegmentationResult;imagesProcessed:number;responseId?:string;events?:unknown[]}>;
}
export interface DetectionStatus {enabled:boolean;reason:string|null;budget:{requests:number;requestLimit:number;capUsd:number;reservedUsd:number;estimatedUsd:number}}
const conceptsSchema=z.strictObject({concepts:z.array(z.string().trim().min(1).max(80)).max(3)});
export function discoveryRequest(bytes:Buffer){return {model:'muse-spark-1.3',store:false,max_output_tokens:512,reasoning:{effort:'minimal' as const},input:[{role:'user' as const,content:[{type:'input_text' as const,text:'Inspect these pixels. Return JSON {"concepts":[...]} with at most three short concrete object-category phrases covering visible portable objects for segmentation. Omit room and furniture. No hidden contents, object IDs, identities, or unseen events. Broad categories are appropriate when subtype is unclear. Return an empty list if no portable objects are visible.'},{type:'input_image' as const,image_url:`data:image/png;base64,${bytes.toString('base64')}`,detail:'auto' as const}]}],text:{format:{type:'json_object' as const}}};}
function liveTransport():DetectionTransport {
 const client=new OpenAI({apiKey:process.env.MODEL_API_KEY,baseURL:'https://api.meta.ai/v1',maxRetries:0,timeout:60_000});
 return {count:async request=>(await client.responses.inputTokens.count({model:request.model,input:request.input,text:request.text,reasoning:request.reasoning})).input_tokens,discover:request=>client.responses.create(request),segment:async(bytes,concept,record)=>{
  const stream=await client.responses.create({model:'sam-3.1',stream:true,input:[{role:'user',content:[{type:'input_text',text:concept},{type:'input_image',image_url:`data:image/png;base64,${bytes.toString('base64')}`,detail:'auto'}]}]});
  let imagesProcessed=0,responseId:string|undefined,completed=0;const rawEvents:unknown[]=[];
  async function* events():AsyncIterable<ResponsesEvent>{const finished=new Set<string>();for await(const raw of stream){const event=raw as unknown as Record<string,any>;rawEvents.push(event);record?.({events:rawEvents});if(event.type==='response.completed'){completed++;imagesProcessed=event.response?.usage?.images_processed;responseId=event.response?.id;}const lane=[event.item_id,event.output_index,event.content_index].join(':');if(event.type==='response.output_text.done'){if(finished.has(lane))continue;finished.add(lane);}yield event as ResponsesEvent;if(event.type==='response.content_part.done'&&event.part?.type==='output_text'&&!finished.has(lane)){finished.add(lane);yield {...event,type:'response.output_text.done',text:event.part.text} as ResponsesEvent;}}}
  const result=await parseImageStream(events()).finalResult;if(completed!==1)throw new Error('Exactly one completed SAM response required.');return {result,imagesProcessed,responseId,events:rawEvents};
 }};
}
export function createDetectionProvider(options:{testOnly?:boolean;transport?:DetectionTransport;budgetDirectory?:string}={}){
 if(options.transport&&!options.testOnly)throw new Error('Injected detection transport is test-only.');
 const directory=options.testOnly?options.budgetDirectory:process.env.SCAN_DETECTION_BUDGET_DIR;
 const budget=directory?new DetectionBudget(directory):null;
 const authorized=()=>options.testOnly===true?Boolean(options.transport):(process.env.ENABLE_SCAN_DETECTION==='true'&&Boolean(process.env.MODEL_API_KEY)&&process.env.META_CREDITS_CONFIRMED==='true');
 const status=():DetectionStatus=>{const reason=!authorized()?'Detection is off: explicit enablement, server key and confirmed credits are required.':!budget?'A separate shared detection budget directory is required.':budget.reason();return {enabled:reason===null,reason,budget:budget?.snapshot()??{requests:0,requestLimit:10,capUsd:.10,reservedUsd:0,estimatedUsd:0}};};
 const detect:DetectionProvider=async({frame,bytes})=>{
  const state=status();if(!state.enabled||!budget)throw new Error(state.reason??'Detection unavailable');
  if(bytes.length>CAPTURE_MAX_PNG_BYTES||bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||hash(bytes)!==frame.sourceHash||!Number.isInteger(frame.width)||!Number.isInteger(frame.height)||Math.min(frame.width,frame.height)<1||Math.max(frame.width,frame.height)>CAPTURE_MAX_DIMENSION||bytes.readUInt32BE(16)!==frame.width||bytes.readUInt32BE(20)!==frame.height)throw new Error('Exact bounded saved PNG source required.');
  const source=PNG.sync.read(bytes);budget.claim(frame.sourceHash);const transport=options.transport??liveTransport(),calls:Record<string,unknown>[]=[];
  async function call<T>(kind:string,reserved:number,run:(record:(receipt:Record<string,unknown>)=>void)=>Promise<{value:T;cost:number;receipt:Record<string,unknown>}>):Promise<T>{const id=budget!.reserve(reserved);let receipt:Record<string,unknown>={kind,sourceHash:frame.sourceHash,frameId:frame.id};const record=(next:Record<string,unknown>)=>{receipt={...receipt,...next};budget!.record(id,receipt);};record({});try{const result=await run(record);record(result.receipt);budget!.finish(id,result.cost);calls.push({request:id,kind,reservedUsd:reserved,estimatedUsd:result.cost,...result.receipt});return result.value;}catch(error){record({error:error instanceof Error?error.message:'Detection request failed'});budget!.fail(id);throw error;}}
  try{
   const request=discoveryRequest(bytes),tokens=await call('count',0,async(record)=>{const value=await transport.count(request);record({inputTokens:value});if(!Number.isSafeInteger(value)||value<0||value>8192)throw new Error('Discovery input exceeds token ceiling.');return {value,cost:0,receipt:{inputTokens:value}};});
   const concepts=await call('discovery',(8192*1.25+512*4.25)/1e6,async(record)=>{const r=await transport.discover(request);record({response:r});if(r.status!=='completed'||!r.usage||![r.usage.input_tokens,r.usage.output_tokens].every(v=>Number.isSafeInteger(v)&&v>=0)||r.usage.input_tokens>8192||r.usage.output_tokens>512)throw new Error('Incomplete discovery or invalid usage.');return {value:[...new Set(conceptsSchema.parse(JSON.parse(r.output_text)).concepts)],cost:(r.usage.input_tokens*1.25+r.usage.output_tokens*4.25)/1e6,receipt:{responseId:r.id,usage:r.usage,inputTokensPreflight:tokens,output:r.output_text}};});
   const regions:DetectionResult['regions']=[],pixelSets:Set<number>[]=[];
   for(const concept of concepts){
    await call('sam',.0025,async(record)=>{record({concept});const r=await transport.segment(bytes,concept,record);record({response:r});if(r.imagesProcessed!==1||r.result.media!=='image'||r.result.outcome.status!=='completed'||r.result.diagnostics.some(d=>d.severity==='error'))throw new Error('Invalid completed source-image segmentation.');const masks=recordsOfKind(r.result.records,'mask');if(masks.length>64)throw new Error('Too many segmentation regions.');for(const mask of masks){if(!Number.isInteger(mask.mask.width)||!Number.isInteger(mask.mask.height)||mask.mask.width<1||mask.mask.height<1||mask.mask.width>CAPTURE_MAX_DIMENSION||mask.mask.height>CAPTURE_MAX_DIMENSION||mask.mask.width*mask.mask.height>CAPTURE_MAX_DIMENSION*CAPTURE_MAX_DIMENSION)throw new Error('Segmentation raster dimensions exceed limits.');const {crop,pixels}=cropRegion(source,mask);if(!pixels.size)continue;const duplicate=pixelSets.some(prior=>{let overlap=0;for(const p of pixels)if(prior.has(p))overlap++;return overlap/(prior.size+pixels.size-overlap)>=.8;});if(duplicate)continue;if(regions.length>=24)throw new Error('Detection region limit exceeded.');pixelSets.push(pixels);regions.push({bounds:{...mask.bounds},crop:PNG.sync.write(crop),label:concept});}return {value:null,cost:.0025,receipt:{concept,responseId:r.responseId,imagesProcessed:r.imagesProcessed,segmentation:r.result,events:r.events??[]}};});
   }
   budget.finishFrame(frame.sourceHash,'completed');return {model:'muse-spark-1.3+sam-3.1',sourceHash:frame.sourceHash,regions,receipt:{version:1,frameId:frame.id,sourceHash:frame.sourceHash,capturedAt:frame.capturedAt,width:frame.width,height:frame.height,concepts,labelBasis:'discovery-category-suggestion',scope:'unknown',calls}};
  }catch(error){budget.finishFrame(frame.sourceHash,'failed');throw error;}
 };
 return {status,detect,close:()=>budget?.close()};
}
