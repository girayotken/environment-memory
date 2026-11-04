import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Place } from '../domain/place-memory.ts';
import type { SavedFrame } from '../domain/contracts.ts';

export class PlaceStore {
  private db:DatabaseSync;
  constructor(directory:string){this.db=new DatabaseSync(join(directory,'places.sqlite'));this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS places(id TEXT PRIMARY KEY,record TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS visits(place_id TEXT NOT NULL REFERENCES places(id),position INTEGER NOT NULL,frame_id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(place_id,position),UNIQUE(place_id,frame_id));`);}
  close(){this.db.close();}
  get(id:string):Place|null {const row=this.db.prepare('SELECT record FROM places WHERE id=?').get(id);return row?JSON.parse(String(row.record)):null;}
  list():Place[]{return this.db.prepare('SELECT record FROM places ORDER BY rowid DESC LIMIT 20').all().map(r=>JSON.parse(String(r.record)));}
  create(name:string,source:Place['source']){const place:Place={id:randomUUID(),name,source,createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO places VALUES(?,?)').run(place.id,JSON.stringify(place));return place;}
  frames(id:string):Omit<SavedFrame,'run'>[]{return this.db.prepare('SELECT record FROM visits WHERE place_id=? ORDER BY position').all(id).map(r=>JSON.parse(String(r.record)));}
  append(id:string,frame:Omit<SavedFrame,'run'>){
    this.db.exec('BEGIN IMMEDIATE');try{
      if(!this.get(id))throw new Error('Place not found');
      const prior=this.frames(id),same=prior.find(f=>f.id===frame.id);if(same){this.db.exec('COMMIT');return same;}
      if(prior.length>=3)throw new Error('This bounded place supports three saved visits. Existing evidence is retained.');
      const first=prior[0],last=prior.at(-1);
      if(!frame.referenceView||first&&(first.referenceView!==frame.referenceView||first.zone!==frame.zone))throw new Error('Use the same declared workshop reference and zone.');
      if(last&&last.capturedAt>=frame.capturedAt)throw new Error('Choose a later saved visit.');
      this.db.prepare('INSERT INTO visits VALUES(?,?,?,?)').run(id,prior.length+1,frame.id,JSON.stringify(frame));this.db.exec('COMMIT');return frame;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
