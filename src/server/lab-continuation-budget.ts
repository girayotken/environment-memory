import {createHash} from 'node:crypto';
import {DemoBudget} from './demo-budget.ts';
import {ROOM_OBSERVER_LIMITS,roomObserverCost} from './room-observer-budget.ts';

/** Narrow append-only continuation of the November 3 lab, not a new allowance. */
export class LabContinuationBudget extends DemoBudget {
 constructor(directory:string){
  super(directory,{authorizationId:'meta_box_protocol_lab_20261103',capUsd:1,requestLimit:24,frameLimit:3,outputTokens:4096});
  this.db.exec(`CREATE TABLE IF NOT EXISTS lab_continuation (id INTEGER PRIMARY KEY CHECK(id=1), authorization TEXT NOT NULL, baseline_hash TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS lab_continuation_frames (source_hash TEXT PRIMARY KEY, frame_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS lab_continuation_requests (source_hash TEXT NOT NULL, ordinal INTEGER NOT NULL, request_id INTEGER NOT NULL UNIQUE, PRIMARY KEY(source_hash,ordinal));
   CREATE TABLE IF NOT EXISTS lab_encode_recovery (id INTEGER PRIMARY KEY CHECK(id=1), source_hash TEXT NOT NULL, frame_id TEXT NOT NULL, request_hash TEXT NOT NULL, compare_receipt_hash TEXT NOT NULL, failed_receipt_hash TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS lab_encode_recovery_requests (ordinal INTEGER PRIMARY KEY, request_id INTEGER NOT NULL UNIQUE);
   CREATE TABLE IF NOT EXISTS lab_encode_recovery_completion (id INTEGER PRIMARY KEY CHECK(id=1), completed_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS lab_encode_recovery_terminal_failure (id INTEGER PRIMARY KEY CHECK(id=1), failed_request_id INTEGER NOT NULL, receipt_hash TEXT NOT NULL, acknowledged_at TEXT NOT NULL);`);
  this.transaction(()=>{
   const original=this.db.prepare('SELECT * FROM requests WHERE id<=24 ORDER BY id').all();
   const hash=createHash('sha256').update(JSON.stringify(original)).digest('hex');
   const auth=JSON.stringify({purpose:'two-stage box continuation',requestLimit:32,frameLimit:2,capUsd:1,requestsPerFrame:4,outputTokens:4096});
   const prior=this.db.prepare('SELECT * FROM lab_continuation WHERE id=1').get();
   if(prior){if(prior.authorization!==auth||prior.baseline_hash!==hash||original.length!==24)throw new Error('Lab continuation baseline changed');}
   else {const snap=super.snapshot();if(original.length!==24||snap.requests!==24||original.some(r=>r.status!=='completed')||Math.abs(snap.reservedUsd-.700416)>1e-9||this.db.prepare('SELECT 1 FROM frames LIMIT 1').get())throw new Error('Unexpected original lab baseline');this.db.prepare('INSERT INTO lab_continuation VALUES(1,?,?,?)').run(auth,hash,new Date().toISOString());}
  });
 }
 override snapshot(){return {...super.snapshot(),requestLimit:this.db.prepare('SELECT 1 FROM lab_encode_recovery').get()?34:32};}
 override reason(){
  if(this.db.prepare("SELECT 1 FROM requests WHERE status!='completed' AND NOT ((id=28 AND (EXISTS (SELECT 1 FROM lab_encode_recovery_completion) OR EXISTS (SELECT 1 FROM lab_encode_recovery_terminal_failure))) OR (id=30 AND EXISTS (SELECT 1 FROM lab_encode_recovery_terminal_failure))) LIMIT 1").get())return 'Lab continuation paused after incomplete or failed request.';
  if(this.db.prepare("SELECT 1 FROM lab_continuation_frames WHERE status!='completed' AND NOT (status='failed' AND source_hash=(SELECT source_hash FROM lab_encode_recovery) AND (EXISTS (SELECT 1 FROM lab_encode_recovery_completion) OR EXISTS (SELECT 1 FROM lab_encode_recovery_terminal_failure))) LIMIT 1").get())return 'Lab continuation frame unfinished or failed.';
  if(Number(this.db.prepare('SELECT COUNT(*) n FROM lab_continuation_frames').get()!.n)>=2)return 'Lab continuation frame limit reached.';
  const s=this.snapshot(), reserve=2*(roomObserverCost(ROOM_OBSERVER_LIMITS.inputTokens,0)+roomObserverCost(ROOM_OBSERVER_LIMITS.inputTokens,this.limits.outputTokens));
  return s.requests+4>s.requestLimit||s.reservedUsd+reserve>1+1e-12?'Lab continuation cannot reserve four requests.':null;
 }
 override claim(frameId:string,sourceHash:string){this.transaction(()=>{if(!frameId||!/^[a-f0-9]{64}$/.test(sourceHash))throw new Error('Invalid continuation frame binding');const reason=this.reason();if(reason)throw new Error(reason);this.db.prepare("INSERT INTO lab_continuation_frames VALUES(?,?,'processing',?)").run(sourceHash,frameId,new Date().toISOString());});}
 override reserve(sourceHash:string,kind:'count'|'generate',amount:number,receipt:Record<string,unknown>){return this.transaction(()=>{
  const frame=this.db.prepare('SELECT * FROM lab_continuation_frames WHERE source_hash=?').get(sourceHash), rows=this.db.prepare('SELECT r.* FROM lab_continuation_requests x JOIN requests r ON r.id=x.request_id WHERE x.source_hash=? ORDER BY x.ordinal').all(sourceHash),s=this.snapshot();
  const expected=rows.length%2===0?'count':'generate', ceiling=roomObserverCost(ROOM_OBSERVER_LIMITS.inputTokens,kind==='count'?0:this.limits.outputTokens);
  if(!frame||frame.status!=='processing'||rows.length>=4||kind!==expected||receipt.stage!==(rows.length<2?'compare':'encode')||amount!==ceiling||receipt.sourceHash!==sourceHash||receipt.frameId!==frame.frame_id||typeof receipt.requestHash!=='string'||!/^[a-f0-9]{64}$/.test(receipt.requestHash)||rows.some(r=>r.status!=='completed')||s.requests>=s.requestLimit||s.reservedUsd+amount>1+1e-12)throw new Error('Invalid or exhausted lab continuation request');
  if(rows.length%2===1){const previous=JSON.parse(String(rows[rows.length-1].receipt));if(previous.requestHash!==receipt.requestHash)throw new Error('Generation request differs from its preflight');}
  const id=Number(this.db.prepare("INSERT INTO requests(source_hash,kind,status,reserved,receipt) VALUES(?,?,'reserved',?,?)").run(sourceHash,kind,amount,JSON.stringify(receipt)).lastInsertRowid);this.db.prepare('INSERT INTO lab_continuation_requests VALUES(?,?,?)').run(sourceHash,rows.length+1,id);return id;
 });}
 beginEncodeRecovery(input:{sourceHash:string;frameId:string;requestHash:string}){this.transaction(()=>{
  if(![input.sourceHash,input.requestHash].every(x=>/^[a-f0-9]{64}$/.test(x))||!input.frameId||this.db.prepare('SELECT 1 FROM lab_encode_recovery').get())throw new Error('Invalid or used encode recovery');
  const rows=this.db.prepare('SELECT * FROM requests WHERE id IN (25,26,27,28) ORDER BY id').all(),f=this.db.prepare('SELECT * FROM lab_continuation_frames WHERE source_hash=?').get(input.sourceHash),s=super.snapshot();
  if(rows.length!==4||s.requests!==28||!f||f.status!=='failed'||f.frame_id!==input.frameId||rows.some(r=>r.source_hash!==input.sourceHash)||rows.map(r=>`${r.kind}:${r.status}`).join('|')!=='count:completed|generate:completed|count:completed|generate:failed')throw new Error('Recovery requires exact failed two-stage frame');
  const compare=JSON.parse(String(rows[1].receipt)),failure=JSON.parse(String(rows[3].receipt));
  if(compare.stage!=='compare'||failure.stage!=='encode'||compare.frameId!==input.frameId||failure.frameId!==input.frameId||failure.error!=='Action request requires a specific question or view.'||compare.response?.status!=='completed'||typeof compare.response?.output_text!=='string'||failure.priorComparison!==compare.response.output_text||failure.response?.status!=='completed'||failure.requestHash===input.requestHash)throw new Error('Recovery comparison or failed encoding receipt mismatch');
  const pair=roomObserverCost(ROOM_OBSERVER_LIMITS.inputTokens,0)+roomObserverCost(ROOM_OBSERVER_LIMITS.inputTokens,this.limits.outputTokens);
  if(s.reservedUsd+3*pair>1+1e-12)throw new Error('Insufficient capacity for recovery and replacement');
  const hash=(v:unknown)=>createHash('sha256').update(String(v)).digest('hex');
  this.db.prepare('INSERT INTO lab_encode_recovery VALUES(1,?,?,?,?,?,?)').run(input.sourceHash,input.frameId,input.requestHash,hash(rows[1].receipt),hash(rows[3].receipt),new Date().toISOString());
 });}
 reserveEncodeRecovery(kind:'count'|'generate',amount:number,receipt:Record<string,unknown>){return this.transaction(()=>{
  const r=this.db.prepare('SELECT * FROM lab_encode_recovery WHERE id=1').get(),rows=this.db.prepare('SELECT q.* FROM lab_encode_recovery_requests x JOIN requests q ON q.id=x.request_id ORDER BY x.ordinal').all(),s=this.snapshot(),expected=rows.length===0?'count':'generate',ceiling=roomObserverCost(ROOM_OBSERVER_LIMITS.inputTokens,kind==='count'?0:this.limits.outputTokens);
  if(!r||this.db.prepare('SELECT 1 FROM lab_encode_recovery_completion').get()||rows.length>=2||kind!==expected||amount!==ceiling||receipt.stage!=='encode-recovery'||receipt.sourceHash!==r.source_hash||receipt.frameId!==r.frame_id||receipt.requestHash!==r.request_hash||rows.some(x=>x.status!=='completed')||s.requests>=34||s.reservedUsd+amount>1+1e-12)throw new Error('Invalid encode recovery request');
  const id=Number(this.db.prepare("INSERT INTO requests(source_hash,kind,status,reserved,receipt) VALUES(?,?,'reserved',?,?)").run(r.source_hash,kind,amount,JSON.stringify(receipt)).lastInsertRowid);this.db.prepare('INSERT INTO lab_encode_recovery_requests VALUES(?,?)').run(rows.length+1,id);return id;
 });}
 acknowledgeTerminalEncodeFailure(){this.transaction(()=>{
  const auth=this.db.prepare('SELECT * FROM lab_encode_recovery WHERE id=1').get(),rows=this.db.prepare('SELECT q.* FROM lab_encode_recovery_requests x JOIN requests q ON q.id=x.request_id ORDER BY x.ordinal').all(),snap=this.snapshot();
  if(!auth||this.db.prepare('SELECT 1 FROM lab_encode_recovery_completion').get()||this.db.prepare('SELECT 1 FROM lab_encode_recovery_terminal_failure').get()||snap.requests!==30||snap.requestLimit!==34||snap.reservedUsd+2*(roomObserverCost(16384,0)+roomObserverCost(16384,4096))>1+1e-12||rows.length!==2||rows[0].id!==29||rows[0].kind!=='count'||rows[0].status!=='completed'||rows[1].id!==30||rows[1].kind!=='generate'||rows[1].status!=='failed')throw new Error('Terminal failure acknowledgement requires exact failed recovery');
  const r=JSON.parse(String(rows[1].receipt)),u=r.response?.usage;if(r.stage!=='encode-recovery'||r.sourceHash!==auth.source_hash||r.frameId!==auth.frame_id||r.requestHash!==auth.request_hash||r.error!=='Invalid model response'||!r.finishedAt||r.response?.status!=='incomplete'||r.response?.incomplete_details?.reason!=='max_output_tokens'||r.response?.model!=='muse-spark-1.3'||!u||![u.input_tokens,u.output_tokens].every((v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0)||u.input_tokens>16384||u.output_tokens!==4096)throw new Error('Unaccounted recovery failure');
  if(this.db.prepare("SELECT 1 FROM requests WHERE status!='completed' AND id NOT IN (28,30) LIMIT 1").get())throw new Error('Additional unresolved request');
  this.db.prepare('INSERT INTO lab_encode_recovery_terminal_failure VALUES(1,?,?,?)').run(30,createHash('sha256').update(String(rows[1].receipt)).digest('hex'),new Date().toISOString());
 });}
 finishEncodeRecovery(){this.transaction(()=>{const rows=this.db.prepare('SELECT q.* FROM lab_encode_recovery_requests x JOIN requests q ON q.id=x.request_id ORDER BY x.ordinal').all();if(rows.length!==2||rows[0].kind!=='count'||rows[1].kind!=='generate'||rows.some(r=>r.status!=='completed'))throw new Error('Encode recovery incomplete');this.db.prepare('INSERT INTO lab_encode_recovery_completion VALUES(1,?)').run(new Date().toISOString());});}
 override finishFrame(sourceHash:string,status:'completed'|'failed'){this.transaction(()=>{const f=this.db.prepare('SELECT status FROM lab_continuation_frames WHERE source_hash=?').get(sourceHash);if(!f||f.status!=='processing')throw new Error('Invalid continuation frame');const rows=this.db.prepare('SELECT r.status FROM lab_continuation_requests x JOIN requests r ON r.id=x.request_id WHERE x.source_hash=?').all(sourceHash);if(status==='completed'&&(rows.length!==4||rows.some(r=>r.status!=='completed')))throw new Error('Continuation frame incomplete');this.db.prepare('UPDATE lab_continuation_frames SET status=? WHERE source_hash=?').run(status,sourceHash);});}
 private transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
