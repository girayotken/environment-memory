import {execFile} from 'node:child_process';
import {accessSync,constants,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {VoiceBusyError,VoiceInputError,type LocalVoiceProvider} from './room-voice-routes.ts';
const run=promisify(execFile);
/** Explicit local paths only; no user-supplied commands or network model identifiers. */
export function createLocalVoiceProvider(config:{python:string;model:string;ffmpeg:string;bridge:string}):LocalVoiceProvider{
 const paths=Object.values(config);let reason:string|null=null;
 try{if(paths.some(p=>!p||!p.startsWith('/')))throw Error();accessSync(config.python,constants.X_OK);accessSync(config.ffmpeg,constants.X_OK);accessSync(config.model,constants.R_OK);accessSync(config.bridge,constants.R_OK);}catch{reason='Local transcription runtime or model is missing';}
 let busy=false;
 return {status:()=>({enabled:reason===null,reason}),async transcribe(audio,_contentType,signal){
  if(reason)throw Error('Local transcription unavailable');if(busy)throw new VoiceBusyError('Transcription busy');busy=true;
  const dir=mkdtempSync(join(tmpdir(),'room-voice-'));
  try{const input=join(dir,'recording');writeFileSync(input,audio,{mode:0o600});
   const {stdout}=await run(config.python,[resolve(config.bridge),input],{timeout:90_000,signal,maxBuffer:128*1024,env:{...process.env,LOCAL_VOICE_MODEL:resolve(config.model),LOCAL_VOICE_FFMPEG:resolve(config.ffmpeg),HF_HUB_OFFLINE:'1'}});
   const lines=stdout.trim().split('\n');const result=JSON.parse(lines.at(-1)??'');if(typeof result.transcript!=='string')throw Error('Invalid transcription result');return result.transcript;
  }catch(error){if((error as {code?:unknown}).code===2)throw new VoiceInputError('Invalid recording');throw error;}finally{rmSync(dir,{recursive:true,force:true});busy=false;}
 }};
}
