/** Independent durable detection results, pixel assets and immutable frame jobs. */
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import type {ScanReviewManifest} from './scan-review.ts';
import type {ScanSession} from '../domain/scan-contracts.ts';
import type {BeliefEpisode} from '../domain/belief-contracts.ts';
export interface DetectionAnalysis {frameId:string;status:'processing'|'completed'|'empty'|'error';placeId:string|null;candidateCount:number;error:string|null}
export interface DetectionBundle {session:ScanSession;event:BeliefEpisode;cards:ScanReviewManifest['cards'];model:string;receipt:Record<string,unknown>}
export class DetectionStore {
 private db:DatabaseSync;
 constructor(root:string){this.db=new DatabaseSync(join(root,'scan-detections.sqlite'));this.db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS detection_jobs(frame_id TEXT PRIMARY KEY,analysis TEXT NOT NULL,bundle TEXT);
 CREATE TABLE IF NOT EXISTS detection_assets(hash TEXT PRIMARY KEY,bytes BLOB NOT NULL);`);}
 close(){this.db.close();}
 analyses():DetectionAnalysis[]{return this.db.prepare('SELECT analysis FROM detection_jobs ORDER BY rowid').all().map(r=>JSON.parse(String(r.analysis)));}
 get(frameId:string):DetectionAnalysis|null{const row=this.db.prepare('SELECT analysis FROM detection_jobs WHERE frame_id=?').get(frameId);return row?JSON.parse(String(row.analysis)):null;}
 bundle(frameId:string):DetectionBundle|null{const r=this.db.prepare('SELECT bundle FROM detection_jobs WHERE frame_id=?').get(frameId);return r?.bundle?JSON.parse(String(r.bundle)):null;}
 asset(hash:string):Buffer|null{const r=this.db.prepare('SELECT bytes FROM detection_assets WHERE hash=?').get(hash);return r?Buffer.from(r.bytes as Uint8Array):null;}
 begin(frameId:string):boolean{const a:DetectionAnalysis={frameId,status:'processing',placeId:null,candidateCount:0,error:null};return this.db.prepare('INSERT OR IGNORE INTO detection_jobs(frame_id,analysis) VALUES(?,?)').run(frameId,JSON.stringify(a)).changes>0;}
 save(analysis:DetectionAnalysis){this.db.prepare('UPDATE detection_jobs SET analysis=? WHERE frame_id=?').run(JSON.stringify(analysis),analysis.frameId);}
 stage(frameId:string,bundle:DetectionBundle,assets:Map<string,Buffer>){this.db.exec('BEGIN IMMEDIATE');try{
  for(const [hash,bytes] of assets){const old=this.asset(hash);if(old&&!old.equals(bytes))throw new Error('Immutable detection asset collision');this.db.prepare('INSERT OR IGNORE INTO detection_assets(hash,bytes) VALUES(?,?)').run(hash,bytes);}
  this.db.prepare('UPDATE detection_jobs SET bundle=? WHERE frame_id=? AND bundle IS NULL').run(JSON.stringify(bundle),frameId);
  this.db.exec('COMMIT');
 }catch(e){this.db.exec('ROLLBACK');throw e;}}
}
