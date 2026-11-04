import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PNG} from 'pngjs';
import {inflateSync} from 'node:zlib';
import {CaptureImportSchema,CAPTURE_MAX_DIMENSION,CAPTURE_MAX_PNG_BYTES,CAPTURE_BODY_LIMIT,type CapturedFrame} from '../domain/capture-contracts.ts';

export class CaptureValidationError extends Error {}
export class CaptureCollisionError extends Error {}
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function decodePng(dataUrl:string){
 const prefix='data:image/png;base64,';
 if(!dataUrl.startsWith(prefix))throw new CaptureValidationError('PNG data URL required');
 const encoded=dataUrl.slice(prefix.length);
 if(!encoded.length||encoded.length>4*Math.ceil(CAPTURE_MAX_PNG_BYTES/3)||encoded.length%4!==0||/[^A-Za-z0-9+/=]/.test(encoded))throw new CaptureValidationError('Invalid PNG encoding');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.length>CAPTURE_MAX_PNG_BYTES||bytes.toString('base64')!==encoded)throw new CaptureValidationError('Invalid PNG size or encoding');
 // Bound the decoder's allocation before pngjs sees untrusted IHDR dimensions.
 if(bytes.length<33||!bytes.subarray(0,8).equals(signature)||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw new CaptureValidationError('Invalid PNG header');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(width<1||height<1||width>CAPTURE_MAX_DIMENSION||height>CAPTURE_MAX_DIMENSION)throw new CaptureValidationError('PNG dimensions exceed capture limits');
 try{
  const compressed:Buffer[]=[];let ended=false;
  for(let offset=8;offset<bytes.length;){
   if(offset+12>bytes.length)throw new Error('Truncated PNG chunk');
   const length=bytes.readUInt32BE(offset),end=offset+12+length,type=bytes.toString('ascii',offset+4,offset+8);
   if(end>bytes.length||(type==='IHDR'&&offset!==8))throw new Error('Invalid PNG chunk');
   if(type==='IDAT')compressed.push(bytes.subarray(offset+8,end-4));
   if(type==='IEND'){if(length!==0||end!==bytes.length)throw new Error('Invalid PNG end');ended=true;}
   offset=end;
  }
  if(!ended||!compressed.length)throw new Error('Incomplete PNG');
  // pngjs uses unbounded inflate for interlaced inputs. Preflight every stream
  // with a bounded inflater before allowing that decoder path to execute.
  inflateSync(Buffer.concat(compressed),{maxOutputLength:width*height*8+height*8+1024});
  const decoded=PNG.sync.read(bytes,{checkCRC:true});
  if(decoded.width!==width||decoded.height!==height||decoded.data.length!==width*height*4)throw new Error('Invalid pixels');
 }catch{throw new CaptureValidationError('Invalid PNG pixels');}
 return {bytes,width,height,sourceHash:hash(bytes)};
}

/** Separate append-only capture ledger; blobs and imports commit in one transaction. */
export class CaptureStore {
 private db:DatabaseSync;
 constructor(directory:string){
  mkdirSync(directory,{recursive:true});
  this.db=new DatabaseSync(join(directory,'scan-captures.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS capture_assets(hash TEXT PRIMARY KEY,bytes BLOB NOT NULL);
   CREATE TABLE IF NOT EXISTS capture_frames(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,record TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS capture_imports(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL);`);
 }
 close(){this.db.close();}
 frames():CapturedFrame[]{return this.db.prepare('SELECT record FROM capture_frames ORDER BY sequence').all().map(row=>JSON.parse(String(row.record)) as CapturedFrame);}
 asset(sourceHash:string):Buffer|null{
  if(!/^[a-f0-9]{64}$/.test(sourceHash))return null;
  const row=this.db.prepare('SELECT bytes FROM capture_assets WHERE hash=?').get(sourceHash);
  return row?Buffer.from(row.bytes as Uint8Array):null;
 }
 import(input:unknown):CapturedFrame[]{
  const parsed=CaptureImportSchema.safeParse(input);
  if(!parsed.success)throw new CaptureValidationError('Invalid capture import');
  const request=parsed.data,ids=new Set(request.frames.map(frame=>frame.id));
  if(ids.size!==request.frames.length)throw new CaptureValidationError('Duplicate capture frame IDs');
  const payload=canonical(request);
  if(Buffer.byteLength(payload)>CAPTURE_BODY_LIMIT)throw new CaptureValidationError('Capture import exceeds body limit');
  const payloadHash=hash(payload);
  const prepared=request.frames.map(frame=>{
   const {bytes,width,height,sourceHash}=decodePng(frame.imageDataUrl);
   const record:CapturedFrame={id:frame.id,sessionId:frame.sessionId,capturedAt:frame.capturedAt,sourceHash,width,height,imageUrl:`/api/scan/captures/assets/${sourceHash}`,analysisStatus:'not-analyzed',...(frame.sourceKind?{sourceKind:frame.sourceKind}:{}),...(frame.roomFollowup?{roomFollowup:frame.roomFollowup}:{})};
   return {bytes,record};
  });
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const existing=this.db.prepare('SELECT payload_hash FROM capture_imports WHERE id=?').get(request.importId);
   if(existing){
    if(existing.payload_hash!==payloadHash)throw new CaptureCollisionError('Immutable import ID collision');
   }else{
    for(const {bytes,record} of prepared){
     const prior=this.db.prepare('SELECT record FROM capture_frames WHERE id=?').get(record.id);
     if(prior){if(canonical(JSON.parse(String(prior.record)))!==canonical(record))throw new CaptureCollisionError('Immutable frame ID collision');continue;}
     this.db.prepare('INSERT OR IGNORE INTO capture_assets(hash,bytes) VALUES(?,?)').run(record.sourceHash,bytes);
     this.db.prepare('INSERT INTO capture_frames(id,record) VALUES(?,?)').run(record.id,JSON.stringify(record));
    }
    this.db.prepare('INSERT INTO capture_imports(id,payload_hash) VALUES(?,?)').run(request.importId,payloadHash);
   }
   const frames=this.frames();this.db.exec('COMMIT');return frames;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
}
