import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {AgentReadSchema,AgentEditSchema,AgentUndoSchema} from './agent-memory-api.ts';
import {CAPTURE_MAX_PNG_BYTES} from '../domain/capture-contracts.ts';

/** A local bridge, not a second memory store or a model provider. */
export function localMemoryOrigin(value:string){
 const url=new URL(value);
 if(url.protocol!=='http:'||!['127.0.0.1','[::1]','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use a loopback HTTP origin without a path or credentials.');
 return url.origin;
}
async function boundedBody(response:Response,max:number){
 if(Number(response.headers.get('content-length'))>max)throw new Error('Response exceeds size limit.');
 const reader=response.body?.getReader();if(!reader)throw new Error('Empty response.');
 let length=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max)throw new Error('Response exceeds size limit.');chunks.push(value);}}finally{await reader.cancel();}
 return Buffer.concat(chunks);
}
const skillUri='memory://guide';
export function createMemoryMcpServer(baseUrl:string){
 const origin=localMemoryOrigin(baseUrl);
 const server=new McpServer({name:'environment-memory',version:'1.0.0'},{instructions:'Read memory://guide for workflow. Start with memory_read search or rooms; request object details/images only when needed. Edits require the original user instruction and current personal revision. Tools call the local app, never a paid model.'});
 const failure=(message:string)=>({isError:true,content:[{type:'text' as const,text:message}]});
 async function post(path:string,input:unknown){
  try{
   const response=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(input),redirect:'error',signal:AbortSignal.timeout(10000)});
   const raw=await boundedBody(response,128*1024),data=JSON.parse(raw.toString('utf8'));
   if(!response.ok)return failure(`HTTP ${response.status}: ${typeof data.error==='string'?data.error.slice(0,500):'Request rejected'}`);
   // One compact representation: do not duplicate the entire payload in structuredContent.
   return {content:[{type:'text' as const,text:JSON.stringify(data)}]};
  }catch{return failure('Local memory request failed. Check the app URL; do not replay edits with a new operationId.');}
 }
 server.registerTool('memory_read',{description:'Read small pages of rooms/objects, search names/groups/tags with a literal term, or inspect one object. Follow nextCursor only as needed.',inputSchema:AgentReadSchema,annotations:{readOnlyHint:true,openWorldHint:false}},input=>post('/api/agent/v1/read',input));
 server.registerTool('memory_edit',{description:'Apply explicit user name/group/tag changes atomically. Copy original text and current revision. Reuse operationId only for an identical retry.',inputSchema:AgentEditSchema,annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},input=>post('/api/agent/v1/edit',input));
 server.registerTool('memory_undo',{description:'Undo one personal-edit message using its revisionId and current personal revision. Does not undo visual identity links.',inputSchema:AgentUndoSchema,annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},input=>post('/api/agent/v1/undo',input));
 server.registerTool('memory_image',{description:'Fetch one saved source image by sourceHash returned by memory_read. Use only when visual evidence is needed; images cost context.',inputSchema:z.strictObject({sourceHash:z.string().regex(/^[a-f0-9]{64}$/)}),annotations:{readOnlyHint:true,openWorldHint:false}},async({sourceHash})=>{
  try{const response=await fetch(`${origin}/api/scan/room-memory/assets/${sourceHash}`,{headers:{origin},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))return failure('Saved image unavailable.');
   const bytes=await boundedBody(response,CAPTURE_MAX_PNG_BYTES);
   if(createHash('sha256').update(bytes).digest('hex')!==sourceHash||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return failure('Saved image source verification failed.');
   return {content:[{type:'image' as const,mimeType:'image/png',data:bytes.toString('base64')}]};
  }catch{return failure('Local source image request failed.');}
 });
 server.registerResource('memory-guide',skillUri,{description:'Short Environment Memory agent workflow',mimeType:'text/markdown'},async()=>({contents:[{uri:skillUri,mimeType:'text/markdown',text:readFileSync(new URL('../../.agents/skills/environment-memory/SKILL.md',import.meta.url),'utf8')}]}));
 return server;
}
