import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {IdentityCommandSchema,validateIdentityCommand,type IdentityCommand,type IdentityAnchor} from '../domain/scan-identity.ts';

const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export class IdentityConflict extends Error {}
/** A separate append-only ledger; personal scan commands and source records are untouched. */
export class ScanIdentityStore {
 private db:DatabaseSync;
 constructor(directory:string){
  this.db=new DatabaseSync(join(directory,'scan-identity.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS identity_commands(revision INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,record TEXT NOT NULL);`);
 }
 close(){this.db.close();}
 revision(){return Number(this.db.prepare('SELECT COALESCE(MAX(revision),0) n FROM identity_commands').get()!.n);}
 commands():IdentityCommand[]{return this.db.prepare('SELECT record FROM identity_commands ORDER BY revision').all().map(row=>IdentityCommandSchema.parse(JSON.parse(String(row.record))));}
 /** Immutable retries precede concurrency checks, including after evidence withdrawal. */
 existing(command:IdentityCommand):number|null {
  const row=this.db.prepare('SELECT revision,record FROM identity_commands WHERE id=?').get(command.id);
  if(!row)return null;
  try{validateIdentityCommand(command,[IdentityCommandSchema.parse(JSON.parse(String(row.record)))],[]);}
  catch{throw new IdentityConflict('Immutable identity command ID collision');}
  return Number(row.revision);
 }
 append(command:IdentityCommand,expectedRevision:number,anchors:IdentityAnchor[],checkWorkspace:()=>void):number {
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const prior=this.existing(command);
   if(prior!==null){this.db.exec('COMMIT');return prior;}
   if(expectedRevision!==this.revision())throw new IdentityConflict('Stale identity revision');
   checkWorkspace();
   validateIdentityCommand(command,this.commands(),anchors);
   const row=this.db.prepare('INSERT INTO identity_commands(id,record) VALUES(?,?)').run(command.id,canonical(command));
   this.db.exec('COMMIT');return Number(row.lastInsertRowid);
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
}
