import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {RelationReviewSchema,activeRelationReviews,type RelationReview,type ReviewRevision} from '../domain/relation-contracts.ts';
import {isGroupObservation} from '../domain/group-coverage.ts';
import type {Store} from './store.ts';
import type {PlaceStore} from './place-store.ts';
import type {VisualStore} from './visual-store.ts';
export class RelationStore{
  private db:DatabaseSync;
  constructor(directory:string){this.db=new DatabaseSync(join(directory,'relations.sqlite'));this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS review_events(revision INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,place_id TEXT NOT NULL,record TEXT NOT NULL)');}
  close(){this.db.close();}
  latestRevision(placeId:string){return Number(this.db.prepare('SELECT COALESCE(MAX(revision),0) n FROM review_events WHERE place_id=?').get(placeId)!.n);}
  events(placeId:string,through=this.latestRevision(placeId)):ReviewRevision[]{return this.db.prepare('SELECT revision,record FROM review_events WHERE place_id=? AND revision<=? ORDER BY revision').all(placeId,through).map(row=>({revision:Number(row.revision),event:RelationReviewSchema.parse(JSON.parse(String(row.record)))}));}
  append(input:RelationReview,frames:Store,places:PlaceStore,visual?:VisualStore){
    const event=RelationReviewSchema.parse(input),record=JSON.stringify(event);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const prior=this.db.prepare('SELECT revision,record FROM review_events WHERE id=?').get(event.id);
      if(prior){if(prior.record!==record)throw new Error('Immutable relation review conflict');this.db.exec('COMMIT');return Number(prior.revision);}
      const place=places.get(event.placeId);if(!place)throw new Error('Review place not found');
      const active=activeRelationReviews(this.events(place.id));
      if(event.action==='retract'){
        if(!active.some(e=>e.id===event.targetId))throw new Error('Retraction requires an active claim in the same place');
      }else{
        const frame=frames.getFrame(event.frameId),run=frames.findRun(event.frameId,place.source==='live'?'live':'replay');
        const observation=run?.observations.objects[event.index];
        if(!frame||frame.imageHash!==event.imageHash||!places.frames(place.id).some(f=>f.id===frame.id)||!run||run.id!==event.runId||!observation||isGroupObservation(observation)||(place.source==='authored_fixture'&&run.provenance!=='authored_fixture'))throw new Error('Review requires matching saved pixels, source run, individual observation and place');
        if(event.bounds.right>frame.width||event.bounds.bottom>frame.height)throw new Error('Reviewed region exceeds source image');
        const same=active.find(e=>e.frameId===event.frameId&&e.runId===event.runId&&e.index===event.index);
        if(event.supersedes){if(!same||same.id!==event.supersedes)throw new Error('Replacement requires the active review of the same observation');}
        else if(same)throw new Error('An active review exists; append an explicit replacement');
        if(event.regionMethod==='existing-sam-mask'){
          const bundle=visual?.bundles(place.id).find(b=>b.id===event.bundleId&&b.media==='image'&&b.sourceSha256===frame.imageHash);
          const segment=bundle?.segments.find(s=>s.id===event.segmentId);
          const linked=visual?.links(place.id).some(l=>l.bundleId===bundle?.id&&l.segmentId===segment?.id&&l.frameId===frame.id&&l.runId===run.id&&l.index===event.index);
          if(!segment||!linked||JSON.stringify(segment.bounds)!==JSON.stringify(event.bounds))throw new Error('Existing SAM region requires its exact reviewed same-image link and bounds');
        }else if(event.bundleId||event.segmentId)throw new Error('Agent box cannot claim SAM segment provenance');
      }
      const result=this.db.prepare('INSERT INTO review_events(id,place_id,record) VALUES(?,?,?)').run(event.id,event.placeId,record);
      this.db.exec('COMMIT');return Number(result.lastInsertRowid);
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
