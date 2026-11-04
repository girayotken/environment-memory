import {mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

/** New, isolated authorization. Never imports, resets or borrows a previous model ledger. */
export const ROOM_OBSERVER_LIMITS=Object.freeze({requestLimit:10,frameLimit:1,capUsd:.10,inputTokens:16384,outputTokens:4096,referenceImages:2,observations:16});
// Official standard rates checked 2026-10-29: https://dev.meta.ai/docs/pricing-rate-limits
// Counting has no explicit published price; retain a full input-ceiling reserve for it.
export const ROOM_OBSERVER_PRICING=Object.freeze({model:'muse-spark-1.3',inputPerMillion:1.25,outputPerMillion:4.25,verifiedOn:'2026-10-29',source:'https://dev.meta.ai/docs/pricing-rate-limits',countPrice:'unknown; full input ceiling conservatively reserved'});
export const roomObserverCost=(input:number,output:number)=>(input*ROOM_OBSERVER_PRICING.inputPerMillion+output*ROOM_OBSERVER_PRICING.outputPerMillion)/1e6;
const ledgerName='room-observer-budget.sqlite';
export class RoomObserverBudget {
 readonly db:DatabaseSync;
 readonly limits;
 constructor(directory:string,frameLimit:1|2=1){
  if(frameLimit!==1&&frameLimit!==2)throw new Error('Room observer permits only one or two authorized frames.');
  this.limits=Object.freeze({...ROOM_OBSERVER_LIMITS,frameLimit,outputTokens:frameLimit===2?2048:ROOM_OBSERVER_LIMITS.outputTokens});
  mkdirSync(directory,{recursive:true});
  if(readdirSync(directory).some(name=>/\.sqlite(?:-|$)/.test(name)&&!name.startsWith(ledgerName)))throw new Error('A new separate room-observer budget directory is required.');
  this.db=new DatabaseSync(join(directory,ledgerName));
  this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS authorization(id INTEGER PRIMARY KEY CHECK(id=1),policy TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS frames(source_hash TEXT PRIMARY KEY,frame_id TEXT NOT NULL,status TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY,source_hash TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,reserved REAL NOT NULL,estimated REAL NOT NULL DEFAULT 0,receipt TEXT NOT NULL);`);
  const policy=JSON.stringify({limits:this.limits,pricing:ROOM_OBSERVER_PRICING});
  this.db.prepare('INSERT OR IGNORE INTO authorization VALUES(1,?)').run(policy);
  if(this.db.prepare('SELECT policy FROM authorization WHERE id=1').get()?.policy!==policy){this.db.close();throw new Error('Room-observer budget authorization differs from this policy.');}
 }
 snapshot(){const row=this.db.prepare('SELECT COUNT(*) AS requests,COALESCE(SUM(reserved),0) AS reserved,COALESCE(SUM(estimated),0) AS estimated FROM requests').get()!;return {requests:Number(row.requests),requestLimit:ROOM_OBSERVER_LIMITS.requestLimit,capUsd:ROOM_OBSERVER_LIMITS.capUsd,reservedUsd:Number(row.reserved),estimatedUsd:Number(row.estimated)};}
 reason(){if(this.db.prepare("SELECT 1 FROM requests WHERE status NOT IN ('completed','reserved') LIMIT 1").get())return 'Room observer paused after an incomplete or failed HTTP request; no automatic retry.';if(this.db.prepare("SELECT 1 FROM requests WHERE status='reserved' LIMIT 1").get())return 'A room memory check is in progress or awaiting completion; no new check can start.';if(this.db.prepare("SELECT 1 FROM frames WHERE status!='completed' LIMIT 1").get())return 'A frame is unfinished or failed; no new frame can start.';if(Number(this.db.prepare('SELECT COUNT(*) AS n FROM frames').get()!.n)>=this.limits.frameLimit)return this.limits.frameLimit===1?'The authorized one-frame room-observer allowance has been used.':'The authorized two-frame room-observer allowance has been used.';return null;}
 preflight(requestCount:number){const s=this.snapshot(),amount=(requestCount/2)*(roomObserverCost(ROOM_OBSERVER_LIMITS.inputTokens,0)+roomObserverCost(ROOM_OBSERVER_LIMITS.inputTokens,this.limits.outputTokens));if(!Number.isSafeInteger(requestCount)||requestCount<2||requestCount%2||s.requests+requestCount>s.requestLimit||s.reservedUsd+amount>s.capUsd+1e-12)throw new Error('Insufficient capacity for all frame requests');}
 claim(frameId:string,sourceHash:string){this.transaction(()=>{const reason=this.reason();if(reason)throw new Error(reason);this.db.prepare("INSERT INTO frames VALUES(?,?,'processing')").run(sourceHash,frameId);});}
 reserve(sourceHash:string,kind:'count'|'generate',amount:number,receipt:Record<string,unknown>){
  if(!Number.isFinite(amount)||amount<0)throw new Error('Invalid room-observer reservation.');
  return this.transaction(()=>{const state=this.snapshot();if(!this.db.prepare("SELECT 1 FROM frames WHERE source_hash=? AND status='processing'").get(sourceHash)||this.db.prepare("SELECT 1 FROM requests WHERE status!='completed'").get()||state.requests>=ROOM_OBSERVER_LIMITS.requestLimit||state.reservedUsd+amount>ROOM_OBSERVER_LIMITS.capUsd+1e-12)throw new Error('Room-observer request or cost limit reached; no HTTP request started.');return Number(this.db.prepare("INSERT INTO requests(source_hash,kind,status,reserved,receipt) VALUES(?,?,'reserved',?,?)").run(sourceHash,kind,amount,JSON.stringify(receipt)).lastInsertRowid);});
 }
 record(id:number,receipt:Record<string,unknown>){this.db.prepare('UPDATE requests SET receipt=? WHERE id=?').run(JSON.stringify(receipt),id);}
 finish(id:number,cost:number){
  if(!Number.isFinite(cost)||cost<0)throw new Error('Invalid room-observer usage.');
  const row=this.db.prepare("SELECT reserved,status FROM requests WHERE id=?").get(id);
  if(!row||row.status!=='reserved')throw new Error('Invalid room-observer request completion.');
  if(cost>Number(row.reserved)+1e-12){this.db.prepare("UPDATE requests SET status='failed',estimated=? WHERE id=?").run(cost,id);throw new Error('Room-observer usage exceeded reservation; allowance paused.');}
  this.db.prepare("UPDATE requests SET status='completed',estimated=? WHERE id=?").run(cost,id);
 }
 fail(id:number){this.db.prepare("UPDATE requests SET status='failed' WHERE id=?").run(id);}
 finishFrame(sourceHash:string,status:'completed'|'failed'){this.db.prepare('UPDATE frames SET status=? WHERE source_hash=?').run(status,sourceHash);}
 receipts(){return this.db.prepare('SELECT * FROM requests ORDER BY id').all().map(row=>({id:Number(row.id),sourceHash:String(row.source_hash),kind:String(row.kind),status:String(row.status),reservedUsd:Number(row.reserved),estimatedUsd:Number(row.estimated),receipt:JSON.parse(String(row.receipt)) as Record<string,unknown>}));}
 private transaction<T>(run:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=run();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 close(){this.db.close();}
}
