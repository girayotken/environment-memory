import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FrameSchema, RunSchema, type FrameEnvelope, type SavedFrame, type ObservationRun } from '../domain/contracts.ts';
import type { AnalyzedFrame } from '../domain/memory.ts';
import { ECONOMY, EconomicGuardError, conservativeReservation, type LiveAttempt } from './economy.ts';

export class Store {
  private db: DatabaseSync;
  private images: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.images = join(directory, 'frames');
    mkdirSync(this.images, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'memory.sqlite'));
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS frames (
        id TEXT PRIMARY KEY, captured_at TEXT NOT NULL, zone TEXT NOT NULL, source TEXT NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, image_hash TEXT NOT NULL, extension TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, frame_id TEXT NOT NULL REFERENCES frames(id), mode TEXT NOT NULL,
        model TEXT NOT NULL, created_at TEXT NOT NULL, latency_ms INTEGER NOT NULL,
        observations TEXT NOT NULL, usage TEXT NOT NULL,
        UNIQUE(frame_id, mode)
      );`);
    const columns = this.db.prepare('PRAGMA table_info(runs)').all();
    if (!columns.some(column => column.name === 'provenance')) this.db.exec('ALTER TABLE runs ADD COLUMN provenance TEXT');
    if (!this.db.prepare('PRAGMA table_info(frames)').all().some(column => column.name === 'reference_view')) this.db.exec('ALTER TABLE frames ADD COLUMN reference_view TEXT');
    this.db.exec('CREATE TABLE IF NOT EXISTS live_attempts (id TEXT PRIMARY KEY, frame_id TEXT UNIQUE NOT NULL REFERENCES frames(id), record TEXT NOT NULL)');
  }
  close() { this.db.close(); }
  saveFrame(input: FrameEnvelope): SavedFrame {
    const frame = FrameSchema.parse(input);
    const comma = frame.imageDataUrl.indexOf(',');
    const extension = frame.imageDataUrl.startsWith('data:image/png;') ? 'png' : 'jpg';
    const bytes = Buffer.from(frame.imageDataUrl.slice(comma + 1), 'base64');
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if ((extension === 'png' && !png) || (extension === 'jpg' && !jpeg)) throw new Error('Invalid image signature');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = this.getFrame(frame.frameId);
    if (existing) {
      if (existing.imageHash !== hash || existing.zone !== frame.zone || existing.capturedAt !== frame.capturedAt
        || existing.width !== frame.width || existing.height !== frame.height || existing.referenceView !== frame.referenceView) throw new Error('Frame ID conflict');
      return existing;
    }
    const imagePath = join(this.images, `${hash}.${extension}`);
    if (!existsSync(imagePath)) {
      const temporary = `${imagePath}.${randomUUID()}.tmp`;
      writeFileSync(temporary, bytes);
      renameSync(temporary, imagePath);
    }
    this.db.prepare('INSERT INTO frames (id,captured_at,zone,source,width,height,image_hash,extension,reference_view) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      frame.frameId, frame.capturedAt, frame.zone, frame.source, frame.width, frame.height, hash, extension, frame.referenceView ?? null,
    );
    return this.getFrame(frame.frameId)!;
  }
  getFrame(id: string): SavedFrame | null {
    const row = this.db.prepare('SELECT * FROM frames WHERE id=?').get(id) as Record<string, string | number> | undefined;
    if (!row) return null;
    const runRow = this.db.prepare("SELECT * FROM runs WHERE frame_id=? ORDER BY CASE mode WHEN 'live' THEN 0 WHEN 'replay' THEN 1 ELSE 2 END, created_at DESC LIMIT 1").get(id);
    return { id: String(row.id), capturedAt: String(row.captured_at), zone: row.zone as SavedFrame['zone'],
      source: 'virtual-camera', width: Number(row.width), height: Number(row.height), imageHash: String(row.image_hash),
      ...(row.reference_view ? { referenceView: String(row.reference_view) as SavedFrame['referenceView'] } : {}),
      imageUrl: `/api/frames/${row.id}/image`, run: runRow ? this.decodeRun(runRow) : null };
  }
  listFrames(): SavedFrame[] {
    const rows = this.db.prepare('SELECT id FROM frames ORDER BY captured_at DESC, rowid DESC LIMIT 120').all();
    return rows.map(row => this.getFrame(String(row.id))!);
  }
  getImage(id: string): { bytes: Buffer; mime: string } | null {
    const row = this.db.prepare('SELECT image_hash, extension FROM frames WHERE id=?').get(id);
    if (!row) return null;
    return { bytes: readFileSync(join(this.images, `${row.image_hash}.${row.extension}`)),
      mime: row.extension === 'png' ? 'image/png' : 'image/jpeg' };
  }
  findRun(frameId: string, mode: string): ObservationRun | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE frame_id=? AND mode=?').get(frameId, mode);
    return row ? this.decodeRun(row) : null;
  }
  saveRun(input: ObservationRun): ObservationRun {
    const run = RunSchema.parse(input);
    const existing = this.findRun(run.frameId, run.mode);
    if (existing) {
      if (JSON.stringify(existing.observations) !== JSON.stringify(run.observations) || existing.model !== run.model || existing.provenance !== run.provenance) throw new Error('An observation already exists for this frame and mode; it cannot be overwritten');
      return existing;
    }
    // A valid complete observation is committed as one atomic SQLite row.
    this.db.prepare('INSERT INTO runs (id, frame_id, mode, model, created_at, latency_ms, observations, usage, provenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      run.id, run.frameId, run.mode, run.model, run.createdAt, run.latencyMs,
      JSON.stringify(run.observations), JSON.stringify(run.usage), run.provenance ?? null,
    );
    return this.findRun(input.frameId, input.mode)!;
  }
  analyzedFrames(): AnalyzedFrame[] {
    return this.db.prepare('SELECT * FROM runs ORDER BY rowid').all().map(row => {
      const saved = this.getFrame(String(row.frame_id))!;
      return { frame: { id: saved.id, capturedAt: saved.capturedAt, zone: saved.zone, width: saved.width, height: saved.height, imageUrl: saved.imageUrl, imageHash: saved.imageHash, referenceView: saved.referenceView }, run: this.decodeRun(row) };
    });
  }
  liveAttempts(): LiveAttempt[] { return this.db.prepare('SELECT record FROM live_attempts ORDER BY rowid').all().map(row => JSON.parse(String(row.record))); }
  reserveLiveAttempt(frameId: string, contextTokens: number): LiveAttempt {
    const reservedUsd = conservativeReservation(contextTokens);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.liveAttempts();
      if (previous.some(attempt => attempt.frameId === frameId)) throw new EconomicGuardError('This frame already has a live attempt. Use a fresh capture; no automatic retry.');
      if (previous.length >= ECONOMY.maxCalls || previous.reduce((total, attempt) => total + attempt.reservedUsd, reservedUsd) > ECONOMY.budgetUsd) throw new EconomicGuardError('Economic test budget reached');
      const attempt: LiveAttempt = { id: randomUUID(), frameId, model: ECONOMY.model, createdAt: new Date().toISOString(), status: 'reserved', contextTokens, reservedUsd, latencyMs: 0, usage: {} };
      this.db.prepare('INSERT INTO live_attempts VALUES (?, ?, ?)').run(attempt.id, frameId, JSON.stringify(attempt));
      this.db.exec('COMMIT'); return attempt;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  finishLiveAttempt(attempt: LiveAttempt) {
    this.db.prepare('UPDATE live_attempts SET record=? WHERE id=?').run(JSON.stringify(attempt), attempt.id);
  }
  private decodeRun(value: unknown): ObservationRun {
    const row = value as Record<string, string | number>;
    return RunSchema.parse({ id: String(row.id), frameId: String(row.frame_id), mode: row.mode as ObservationRun['mode'],
      model: String(row.model), createdAt: String(row.created_at), latencyMs: Number(row.latency_ms),
      observations: JSON.parse(String(row.observations)), usage: JSON.parse(String(row.usage)),
      ...(row.provenance ? { provenance: row.provenance } : {}) });
  }
}
