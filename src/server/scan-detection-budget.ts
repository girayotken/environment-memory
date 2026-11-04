import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
export const DETECTION_LIMITS=Object.freeze({requestLimit:10,capUsd:.10,frameLimit:1,inputTokens:8192,outputTokens:512,samUsd:.0025});
export class DetectionBudget {
 readonly db:DatabaseSync;
 constructor(directory:string){mkdirSync(directory,{recursive:true});this.db=new DatabaseSync(join(directory,'scan-detection-budget.sqlite'));this.db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS frames(source_hash TEXT PRIMARY KEY,status TEXT NOT NULL);CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY,status TEXT NOT NULL,reserved REAL NOT NULL,estimated REAL NOT NULL DEFAULT 0,receipt TEXT);`);if(!this.db.prepare('PRAGMA table_info(requests)').all().some(row=>row.name==='receipt'))this.db.exec('ALTER TABLE requests ADD COLUMN receipt TEXT');}
 snapshot(){const row=this.db.prepare('SELECT COUNT(*) AS requests,COALESCE(SUM(reserved),0) AS reserved,COALESCE(SUM(estimated),0) AS estimated FROM requests').get()!;return {requests:Number(row.requests),requestLimit:10,capUsd:.10,reservedUsd:Number(row.reserved),estimatedUsd:Number(row.estimated)};}
 reason(){if(this.db.prepare("SELECT 1 FROM requests WHERE status!='completed' LIMIT 1").get())return 'Detection budget paused after an incomplete or failed request.';if(this.db.prepare('SELECT 1 FROM frames LIMIT 1').get())return 'The authorized one-frame detection allowance has been used.';return null;}
 claim(sourceHash:string){this.db.exec('BEGIN IMMEDIATE');try{const reason=this.reason();if(reason)throw new Error(reason);this.db.prepare("INSERT INTO frames VALUES(?,'processing')").run(sourceHash);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
 record(id:number,receipt:Record<string,unknown>){this.db.prepare('UPDATE requests SET receipt=? WHERE id=?').run(JSON.stringify(receipt),id);}
 receipts(){return this.db.prepare('SELECT id,status,reserved,estimated,receipt FROM requests ORDER BY id').all().map(row=>({id:Number(row.id),status:String(row.status),reserved:Number(row.reserved),estimated:Number(row.estimated),receipt:row.receipt?JSON.parse(String(row.receipt)):null}));}
 reserve(amount:number){if(!Number.isFinite(amount)||amount<0)throw new Error('Invalid detection reservation');this.db.exec('BEGIN IMMEDIATE');try{const s=this.snapshot();if(this.db.prepare("SELECT 1 FROM requests WHERE status!='completed' LIMIT 1").get()||s.requests>=10||s.reservedUsd+amount>.10+1e-12)throw new Error('Detection request or cost limit reached; no request started.');const result=this.db.prepare("INSERT INTO requests(status,reserved) VALUES('reserved',?)").run(amount);this.db.exec('COMMIT');return Number(result.lastInsertRowid);}catch(error){this.db.exec('ROLLBACK');throw error;}}
 finish(id:number,cost:number){if(!Number.isFinite(cost)||cost<0)throw new Error('Invalid detection usage');const row=this.db.prepare('SELECT reserved FROM requests WHERE id=?').get(id);if(!row||cost>Number(row.reserved)+1e-12){this.db.prepare("UPDATE requests SET status='failed',estimated=? WHERE id=?").run(cost,id);throw new Error('Detection usage exceeded reservation.');}this.db.prepare("UPDATE requests SET status='completed',estimated=? WHERE id=?").run(cost,id);}
 fail(id:number){this.db.prepare("UPDATE requests SET status='failed' WHERE id=?").run(id);}
 finishFrame(hash:string,status:'completed'|'failed'){this.db.prepare('UPDATE frames SET status=? WHERE source_hash=?').run(status,hash);}
 close(){this.db.close();}
}
