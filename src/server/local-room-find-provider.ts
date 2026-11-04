import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {RoomFindDecisionSchema} from '../domain/room-find.ts';
/** Operator-mediated local Terra relay: only the question and search vocabulary leave the server. */
export function createLocalRoomFindProvider(directory:string,timeoutMs=180_000){
 const root=resolve(directory);mkdirSync(root,{recursive:true});if(lstatSync(root).isSymbolicLink())throw new Error('Relay directory cannot be a symlink');
 return async(input:{text:string;vocabulary:string[]})=>{
  const token=randomUUID(),requestHash=createHash('sha256').update(JSON.stringify({...input,token})).digest('hex'),folder=join(root,requestHash),deadline=Date.now()+timeoutMs;mkdirSync(folder);
  const prompt='Interpret the user’s question to find remembered objects. Write response.json as the complete envelope in ready.json responseContract, placing {"terms": ["..."]} in result. Select only exact strings from vocabulary that express the object name, group or tag requested. Turkish suffixes and English possessives may refer to a vocabulary entry. Select multiple terms only when all are required. For no supported match return an empty array. Do not provide or infer a location. Data follows:\n'+JSON.stringify(input,null,2);
  writeFileSync(join(folder,'prompt.txt'),prompt,{flag:'wx'});writeFileSync(join(folder,'ready.json'),JSON.stringify({provider:'Terra 6.1 subagent',requestHash,responseToken:token,prompt:'prompt.txt',response:'response.json',responseContract:{requestHash,responseToken:token,provider:'Terra 6.1 subagent',result:{terms:['exact vocabulary value']}},expiresAt:new Date(deadline).toISOString()},null,2),{flag:'wx'});
  while(Date.now()<deadline){const path=join(folder,'response.json');if(existsSync(path)){const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>40000)throw new Error('Invalid relay response file');const response=JSON.parse(readFileSync(path,'utf8'));if(response.requestHash!==requestHash||response.responseToken!==token||response.provider!=='Terra 6.1 subagent')throw new Error('Relay response binding mismatch');return RoomFindDecisionSchema.parse(response.result);}await delay(200);}
  throw new Error('Local interpreter timed out');
 };
}
