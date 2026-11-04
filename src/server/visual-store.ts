import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {VisualBundleSchema,VisualLinkSchema,type VisualBundle,type VisualLink} from '../domain/visual-evidence.ts';
import {digest} from './sam-crops.ts';
import type {Store} from './store.ts';
import type {PlaceStore} from './place-store.ts';

/** Additive visual evidence only. Never updates observation runs or identity projection. */
export class VisualStore{
  private db:DatabaseSync;private assets:string;
  constructor(directory:string){this.assets=join(directory,'visual-assets');mkdirSync(this.assets,{recursive:true});this.db=new DatabaseSync(join(directory,'visual-evidence.sqlite'));this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS bundles(id TEXT PRIMARY KEY,place_id TEXT NOT NULL,record TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS links(id TEXT PRIMARY KEY,place_id TEXT NOT NULL,bundle_id TEXT NOT NULL REFERENCES bundles(id),segment_id TEXT NOT NULL,run_id TEXT NOT NULL,observation_index INTEGER NOT NULL,record TEXT NOT NULL,UNIQUE(place_id,bundle_id,segment_id),UNIQUE(place_id,bundle_id,run_id,observation_index));`);}
  close(){this.db.close();}
  bundles(placeId:string):VisualBundle[]{return this.db.prepare('SELECT record FROM bundles WHERE place_id=? ORDER BY rowid').all(placeId).map(r=>VisualBundleSchema.parse(JSON.parse(String(r.record))));}
  links(placeId:string):VisualLink[]{return this.db.prepare('SELECT record FROM links WHERE place_id=? ORDER BY rowid').all(placeId).map(r=>VisualLinkSchema.parse(JSON.parse(String(r.record))));}
  asset(hash:string):Buffer|null{if(!/^[a-f0-9]{64}$/.test(hash))return null;const file=join(this.assets,hash+'.png');if(!existsSync(file))return null;const bytes=readFileSync(file);if(digest(bytes)!==hash)throw new Error('Visual asset integrity failure');return bytes;}
  saveBundle(value:VisualBundle,assets:Map<string,Buffer>){
    const bundle=VisualBundleSchema.parse(value),record=JSON.stringify(bundle),old=this.db.prepare('SELECT record FROM bundles WHERE id=?').get(bundle.id);
    if(old){if(String(old.record)!==record)throw new Error('Immutable visual bundle conflict');return bundle;}
    for(const s of bundle.segments)for(const hash of [s.sourceAsset,s.cutoutAsset,s.contextAsset]){
      const bytes=assets.get(hash);if(!bytes||digest(bytes)!==hash)throw new Error('Missing or invalid visual asset');
    }
    for(const [hash,bytes] of assets){if(digest(bytes)!==hash)throw new Error('Invalid asset hash');const file=join(this.assets,hash+'.png');if(!existsSync(file))writeFileSync(file,bytes,{flag:'wx'});}
    this.db.prepare('INSERT INTO bundles VALUES(?,?,?)').run(bundle.id,bundle.placeId,record);return bundle;
  }
  bindStill(value:VisualLink,frames:Store,places:PlaceStore){
    const link=VisualLinkSchema.parse(value),place=places.get(link.placeId),bundle=this.bundles(link.placeId).find(b=>b.id===link.bundleId),segment=bundle?.segments.find(s=>s.id===link.segmentId),frame=frames.getFrame(link.frameId);
    const run=place?frames.findRun(link.frameId,place.source==='live'?'live':'replay'):null;
    if(!place||!bundle||bundle.media!=='image'||!segment||segment.frameIndex!==0||!frame||!places.frames(place.id).some(f=>f.id===frame.id)||frame.imageHash!==bundle.sourceSha256||segment.sourceAsset!==frame.imageHash||!run||run.id!==link.runId||!run.observations.objects[link.index]||(place.source==='authored_fixture'&&run.provenance!=='authored_fixture'))throw new Error('A reviewed link requires the same saved pixels, observation run and place');
    const record=JSON.stringify(link),old=this.db.prepare('SELECT record FROM links WHERE id=?').get(link.id);
    if(old){if(String(old.record)!==record)throw new Error('Immutable visual link conflict');return link;}
    this.db.prepare('INSERT INTO links VALUES(?,?,?,?,?,?,?)').run(link.id,link.placeId,link.bundleId,link.segmentId,link.runId,link.index,record);return link;
  }
}
