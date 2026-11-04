import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {BeliefEventSchema,type BeliefEvent} from '../domain/belief-contracts.ts';
import {replayBeliefs} from '../domain/belief-memory.ts';
import {ScanSessionSchema,ScanCommandSchema,type ScanSession,type ScanCommand} from '../domain/scan-contracts.ts';
import {projectScanClaims,validateScanCommand} from '../domain/scan-claims.ts';

export type ScanRevision =
 | {revision:number;kind:'session';placeId:string;sessionId:string;event:ScanSession}
 | {revision:number;kind:'evidence';placeId:string;sessionId:string;event:BeliefEvent}
 | {revision:number;kind:'command';placeId:string;sessionId:null;event:ScanCommand};

// Object key ordering is not part of an immutable command's identity. Array order is.
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>
 item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);

/** Isolated append-only workspace. Revision order includes session creation. */
export class ScanStore {
 private db:DatabaseSync;
 constructor(directory:string){
  mkdirSync(directory,{recursive:true});
  this.db=new DatabaseSync(join(directory,'scan-workspace.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS scan_events(
    revision INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('session','evidence','command')),
    place_id TEXT NOT NULL,
    session_id TEXT,
    record TEXT NOT NULL,
    CHECK((kind='command' AND session_id IS NULL) OR (kind!='command' AND session_id IS NOT NULL))
   );
   CREATE INDEX IF NOT EXISTS scan_events_place_revision ON scan_events(place_id,revision);`);
 }
 close(){this.db.close();}
 latestRevision(placeId?:string):number{
  const row=placeId===undefined
   ?this.db.prepare('SELECT COALESCE(MAX(revision),0) n FROM scan_events').get()
   :this.db.prepare('SELECT COALESCE(MAX(revision),0) n FROM scan_events WHERE place_id=?').get(placeId);
  return Number(row!.n);
 }
 sessions(placeId?:string):ScanSession[]{
  const rows=placeId===undefined
   ?this.db.prepare("SELECT record FROM scan_events WHERE kind='session' ORDER BY revision").all()
   :this.db.prepare("SELECT record FROM scan_events WHERE kind='session' AND place_id=? ORDER BY revision").all(placeId);
  return rows.map(row=>ScanSessionSchema.parse(JSON.parse(String(row.record))));
 }
 events(placeId:string,throughRevision?:number):ScanRevision[]{
  const cutoff=this.cutoff(throughRevision);
  return this.db.prepare('SELECT revision,kind,place_id,session_id,record FROM scan_events WHERE place_id=? AND revision<=? ORDER BY revision')
   .all(placeId,cutoff).map(row=>{
    const base={revision:Number(row.revision),placeId:String(row.place_id)};
    const raw:unknown=JSON.parse(String(row.record));
    if(row.kind==='session'){
     const event=ScanSessionSchema.parse(raw);
     if(event.placeId!==base.placeId||event.id!==row.session_id)throw new Error('Invalid session ledger metadata');
     return {...base,kind:'session',sessionId:event.id,event};
    }
    if(row.kind==='evidence'){
     const event=BeliefEventSchema.parse(raw);
     if(event.kind==='observe'&&event.placeId!==base.placeId)throw new Error('Invalid evidence ledger metadata');
     return {...base,kind:'evidence',sessionId:String(row.session_id),event};
    }
    if(row.kind!=='command')throw new Error('Invalid scan ledger kind');
    const event=ScanCommandSchema.parse(raw);
    if(event.placeId!==base.placeId)throw new Error('Invalid command ledger metadata');
    return {...base,kind:'command',sessionId:null,event};
   });
 }
 view(placeId:string,throughRevision?:number){
  const rows=this.events(placeId,throughRevision);
  const sessions=rows.filter(row=>row.kind==='session').map(row=>row.event);
  const belief=replayBeliefs(rows.filter(row=>row.kind==='evidence').map(row=>row.event));
  const claims=projectScanClaims(belief,rows.filter(row=>row.kind==='command').map(row=>row.event));
  return {revision:rows.at(-1)?.revision??0,sessions,belief,claims};
 }
 createSession(input:unknown):ScanSession{
  const session=ScanSessionSchema.parse(input);
  this.transaction(()=>{
   if(this.existing(session.id,'session',session.placeId,session.id,session)!==null)return;
   if(this.sessions(session.placeId).some(old=>old.provenance!==session.provenance))
    throw new Error('Cached model and authored scenarios require separate places');
   this.insert('session',session.placeId,session.id,session);
  });
  return session;
 }
 /** A detection publishes its session and observation episode together, or neither. */
 importDetection(sessionInput:unknown,eventInput:unknown):number{
  const session=ScanSessionSchema.parse(sessionInput),event=BeliefEventSchema.parse(eventInput);
  if(event.kind!=='observe'||event.placeId!==session.placeId||event.provenance!==session.provenance)throw new Error('Detection must match session');
  return this.transaction(()=>{
   const oldSession=this.existing(session.id,'session',session.placeId,session.id,session);
   const oldEvent=this.existing(event.id,'evidence',session.placeId,session.id,event);
   if(oldSession!==null&&oldEvent!==null)return oldEvent;
   if(oldSession!==null||oldEvent!==null||this.sessions(session.placeId).length)throw new Error('Detection publication collision');
   replayBeliefs([event]);
   this.insert('session',session.placeId,session.id,session);
   return this.insert('evidence',session.placeId,session.id,event);
  });
 }
 appendEvidence(sessionId:string,input:unknown):number{
  const event=BeliefEventSchema.parse(input);
  return this.transaction(()=>{
   const session=this.sessions().find(item=>item.id===sessionId);
   if(!session)throw new Error('Evidence requires an existing scan session');
   const existing=this.existing(event.id,'evidence',session.placeId,session.id,event);
   if(existing!==null)return existing;
   if(event.kind==='observe'&&(event.placeId!==session.placeId||event.provenance!==session.provenance))
    throw new Error('Observation must match session place and provenance');
   // Replay enforces prior, same-place retraction and observation references,
   // duplicate observation IDs, and provenance before any row is committed.
   const prior=this.events(session.placeId).filter(row=>row.kind==='evidence').map(row=>row.event);
   replayBeliefs([...prior,event]);
   return this.insert('evidence',session.placeId,session.id,event);
  });
 }
 appendCommand(input:unknown):number{
  const command=ScanCommandSchema.parse(input);
  return this.transaction(()=>{
   const existing=this.existing(command.id,'command',command.placeId,null,command);
   if(existing!==null)return existing;
   if(!this.sessions(command.placeId).length)throw new Error('Command requires an existing place and scan session');
   const rows=this.events(command.placeId);
   const belief=replayBeliefs(rows.filter(row=>row.kind==='evidence').map(row=>row.event));
   const prior=rows.filter(row=>row.kind==='command').map(row=>row.event);
   validateScanCommand(command,prior,belief);
   return this.insert('command',command.placeId,null,command);
  });
 }
 /** One conversational turn commits entirely, or leaves no command rows. */
 appendCommands(input:unknown[],expectedRevision:number):number[]{
  if(!Array.isArray(input)||input.length<1||input.length>4)throw new Error('Command batch requires one to four commands');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('Invalid expected scan revision');
  const commands=input.map(raw=>ScanCommandSchema.parse(raw)),placeId=commands[0].placeId;
  if(commands.some(c=>c.placeId!==placeId))throw new Error('Command batch requires one place');
  if(new Set(commands.map(c=>c.id)).size!==commands.length)throw new Error('Command batch IDs must be unique');
  return this.transaction(()=>{
   const existing=commands.map(c=>this.existing(c.id,'command',placeId,null,c));
   if(existing.every(revision=>revision!==null))return existing as number[];
   if(existing.some(revision=>revision!==null))throw new Error('Mixed existing and new command batch');
   if(this.latestRevision(placeId)!==expectedRevision)throw new Error('Stale scan revision');
   if(!this.sessions(placeId).length)throw new Error('Command requires an existing place and scan session');
   const rows=this.events(placeId);
   const belief=replayBeliefs(rows.filter(row=>row.kind==='evidence').map(row=>row.event));
   const prior=rows.filter(row=>row.kind==='command').map(row=>row.event);
   const revisions:number[]=[];
   for(const command of commands){
    validateScanCommand(command,prior,belief);
    revisions.push(this.insert('command',placeId,null,command));prior.push(command);
   }
   return revisions;
  });
 }
 /** Withdraw exactly a saved turn's original commands, preserving later edits.
  * Stale claims still need withdrawal so changed evidence cannot revive them. */
 undoTurn(turnId:string,input:ScanCommand[],expectedRevision:number):number[]{
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('Invalid expected scan revision');
  if(input.length<1||input.length>4)throw new Error('Invalid turn command batch');
  const commands=input.map(raw=>ScanCommandSchema.parse(raw)),placeId=commands[0].placeId;
  if(commands.some((c,index)=>c.placeId!==placeId||c.id!==`agent:${turnId}:${index}`||c.action.type==='undo'))
   throw new Error('Invalid original turn commands');
  return this.transaction(()=>{
   const rows=this.events(placeId),belief=replayBeliefs(rows.filter(r=>r.kind==='evidence').map(r=>r.event));
   const prior=rows.filter(r=>r.kind==='command').map(r=>r.event);
   for(const command of commands)if(!prior.some(c=>canonical(c)===canonical(command)))throw new Error('Original turn command is absent or changed');
   const projection=projectScanClaims(belief,prior);
   const remaining=commands.map((command,index)=>({command,index})).filter(({command})=>
    projection.commands.find(c=>c.commandId===command.id)!.status!=='undone').reverse();
   // Exact retries, including manual withdrawals, precede optimistic concurrency.
   if(remaining.length===0)return [];
   if(this.latestRevision(placeId)!==expectedRevision)throw new Error('Stale scan revision');
   const revisions:number[]=[],createdAt=new Date().toISOString();
   const key=createHash('sha256').update(turnId).digest('hex');
   for(const {command,index} of remaining){
    const withdrawal=ScanCommandSchema.parse({id:`agent-undo:${key}:${index}`,placeId,createdAt,
     actor:{id:'local-review-user',kind:'user'},utterance:'Withdraw text turn',action:{type:'undo',targetCommandId:command.id}});
    validateScanCommand(withdrawal,prior,belief);
    revisions.push(this.insert('command',placeId,null,withdrawal));prior.push(withdrawal);
   }
   return revisions;
  });
 }
 private cutoff(value:number|undefined):number{
  const latest=this.latestRevision();
  if(value===undefined)return latest;
  if(!Number.isSafeInteger(value)||value<0||value>latest)throw new Error('Invalid scan revision cutoff');
  return value;
 }
 private existing(id:string,kind:ScanRevision['kind'],placeId:string,sessionId:string|null,event:ScanSession|BeliefEvent|ScanCommand):number|null{
  const old=this.db.prepare('SELECT revision,kind,place_id,session_id,record FROM scan_events WHERE id=?').get(id);
  if(!old)return null;
  if(old.kind!==kind||old.place_id!==placeId||old.session_id!==sessionId||canonical(JSON.parse(String(old.record)))!==canonical(event))
   throw new Error('Immutable scan event ID collision');
  return Number(old.revision);
 }
 private insert(kind:ScanRevision['kind'],placeId:string,sessionId:string|null,event:ScanSession|BeliefEvent|ScanCommand):number{
  const result=this.db.prepare('INSERT INTO scan_events(id,kind,place_id,session_id,record) VALUES(?,?,?,?,?)')
   .run(event.id,kind,placeId,sessionId,canonical(event));
  return Number(result.lastInsertRowid);
 }
 private transaction<T>(operation:()=>T):T{
  this.db.exec('BEGIN IMMEDIATE');
  try{const result=operation();this.db.exec('COMMIT');return result;}
  catch(error){this.db.exec('ROLLBACK');throw error;}
 }
}
