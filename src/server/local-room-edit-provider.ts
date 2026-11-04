import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,lstatSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {RoomEditDecisionSchema,type RoomUserEdit} from '../domain/room-user-edit.ts';
/** Operator-mediated local relay. No network or paid model is invoked. */
export function createLocalRoomEditProvider(directory:string,timeoutMs=180_000){
 const root=resolve(directory);mkdirSync(root,{recursive:true});if(lstatSync(root).isSymbolicLink())throw new Error('Relay directory cannot be a symlink');
 const priorDecisions=()=>readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&/^[a-f0-9]{64}$/.test(entry.name)&&existsSync(join(root,entry.name,'ready.json'))).length;
 return async(input:{roomId:string;nodeId:string;expectedRevision:number;text:string;state:RoomUserEdit;observedLabel:string;clarification:{operationId:string;text:string;reply:string}|null})=>{
  if(priorDecisions()>=3)throw new Error('Local text decision allowance is exhausted');
  const token=randomUUID(),requestHash=createHash('sha256').update(JSON.stringify({...input,token})).digest('hex'),folder=join(root,requestHash),deadline=Date.now()+timeoutMs;mkdirSync(folder);
  const prompt='Interpret the user message for the already selected object only. Write response.json as the complete envelope in ready.json responseContract, placing the decision matching schema.json in result. Write every reply in English, while preserving requested names, groups, tags and original user text exactly in their original language. Supported edits: name, addGroup, removeGroup, addTag, removeTag. Values must appear verbatim in the current user message or the linked previous request. If a clarification is supplied, interpret the current message as its answer. Do not infer a group or tag, change any other object, or guess ambiguous intent. For unsupported or ambiguous requests return clarify with a short English question. Multiple clear changes must be one atomic decision. Existing state and user message follow:\n'+JSON.stringify(input,null,2);
  writeFileSync(join(folder,'prompt.txt'),prompt,{flag:'wx'});writeFileSync(join(folder,'schema.json'),JSON.stringify({oneOf:[{status:'clarify',reply:'string'},{status:'apply',reply:'string',changes:[{kind:'name | addGroup | removeGroup | addTag | removeTag',value:'exact substring of user message'}]}]},null,2),{flag:'wx'});
  writeFileSync(join(folder,'ready.json'),JSON.stringify({provider:'Terra 6.1 subagent',requestHash,responseToken:token,prompt:'prompt.txt',response:'response.json',responseContract:{requestHash,responseToken:token,provider:'Terra 6.1 subagent',result:'decision matching schema.json'},expiresAt:new Date(deadline).toISOString()},null,2),{flag:'wx'});
  while(Date.now()<deadline){const path=join(folder,'response.json');if(existsSync(path)){const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32000)throw new Error('Invalid relay response file');const response=JSON.parse(readFileSync(path,'utf8'));if(response.requestHash!==requestHash||response.responseToken!==token||response.provider!=='Terra 6.1 subagent')throw new Error('Relay response binding mismatch');return RoomEditDecisionSchema.parse(response.result);}await delay(200);}
  throw new Error('Local interpreter timed out');
 };
}
