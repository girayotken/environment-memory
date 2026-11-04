import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PairAnalysisSchema, pairContextError, type PairAnalysis, type PairFrame, type VisitPair } from '../domain/visit-pair.ts';
import { ECONOMY, EconomicGuardError, estimatedCost } from './economy.ts';

export const PAIR_LIMITS = Object.freeze({ maxCalls: 3, budgetUsd: 0.05, maxEdge: 640, maxInputTokens: 4096, maxOutputTokens: 2400, model: ECONOMY.model });
export interface PairAttempt {
  id: string; pairId: string; createdAt: string; status: 'reserved' | 'completed' | 'provider_error' | 'incomplete' | 'invalid_output';
  contextTokens: number; reservedUsd: number; latencyMs: number; usage: Record<string, number>;
}
export class VisitPairStore {
  private db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true }); this.db = new DatabaseSync(join(directory, 'two-visits.sqlite'));
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS pairs(id TEXT PRIMARY KEY, before_id TEXT NOT NULL, after_id TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(before_id,after_id));
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,pair_id TEXT UNIQUE NOT NULL REFERENCES pairs(id),record TEXT NOT NULL);`);
  }
  close() { this.db.close(); }
  get(id: string): VisitPair | null { const row = this.db.prepare('SELECT record FROM pairs WHERE id=?').get(id); return row ? JSON.parse(String(row.record)) : null; }
  list(): VisitPair[] { return this.db.prepare('SELECT record FROM pairs ORDER BY rowid DESC LIMIT 30').all().map(row => JSON.parse(String(row.record))); }
  create(before: PairFrame, after: PairFrame) {
    const issue = pairContextError(before, after); if (issue) throw new Error(issue);
    const existing = this.db.prepare('SELECT id FROM pairs WHERE before_id=? AND after_id=?').get(before.id, after.id);
    if (existing) return this.get(String(existing.id))!;
    const pair: VisitPair = { id: randomUUID(), createdAt: new Date().toISOString(), before, after, analysis: null, source: null, model: null, usage: {} };
    this.db.prepare('INSERT INTO pairs VALUES(?,?,?,?)').run(pair.id, before.id, after.id, JSON.stringify(pair)); return pair;
  }
  attempts(): PairAttempt[] { return this.db.prepare('SELECT record FROM attempts ORDER BY rowid').all().map(row => JSON.parse(String(row.record))); }
  usage() {
    const attempts = this.attempts();
    return { limits: PAIR_LIMITS, liveEnabled: process.env.ENABLE_LIVE_VISIT_COMPARISON === 'true', attempts,
      reservedUsd: attempts.reduce((sum, a) => sum + a.reservedUsd, 0), estimatedUsd: attempts.reduce((sum, a) => sum + (a.usage.estimatedCostUsd ?? 0), 0) };
  }
  reserve(pairId: string, contextTokens: number): PairAttempt {
    if (!Number.isInteger(contextTokens) || contextTokens < 0 || contextTokens > PAIR_LIMITS.maxInputTokens) throw new EconomicGuardError('Comparison preflight exceeds the input limit; no generation started.');
    const reservedUsd = estimatedCost(contextTokens, PAIR_LIMITS.maxOutputTokens);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.attempts();
      if (!this.get(pairId) || prior.some(a => a.pairId === pairId)) throw new EconomicGuardError('This comparison already has an attempt. No automatic retry.');
      if (prior.length >= PAIR_LIMITS.maxCalls || prior.reduce((sum, a) => sum + a.reservedUsd, reservedUsd) > PAIR_LIMITS.budgetUsd) throw new EconomicGuardError('Two-visit test budget reached; no generation started.');
      const attempt: PairAttempt = { id: randomUUID(), pairId, createdAt: new Date().toISOString(), status: 'reserved', contextTokens, reservedUsd, latencyMs: 0, usage: {} };
      this.db.prepare('INSERT INTO attempts VALUES(?,?,?)').run(attempt.id, pairId, JSON.stringify(attempt)); this.db.exec('COMMIT'); return attempt;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  finish(attempt: PairAttempt, output?: { analysis: PairAnalysis; model: string }) {
    const parsed = output ? PairAnalysisSchema.parse(output.analysis) : null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(attempt.pairId); if (!current) throw new Error('Pair not found');
      const reserved = this.attempts().find(value => value.id === attempt.id && value.pairId === attempt.pairId);
      if (!reserved || reserved.status !== 'reserved') throw new Error('Attempt is absent or already finalized');
      if ((attempt.status === 'completed') !== Boolean(parsed)) throw new Error('Completion requires validated observations');
      if (parsed) {
        if (current.analysis) throw new Error('Existing pair evidence is immutable');
        const updated = { ...current, analysis: parsed, source: 'live_model', model: output!.model, usage: attempt.usage };
        this.db.prepare('UPDATE pairs SET record=? WHERE id=?').run(JSON.stringify(updated), current.id);
      }
      this.db.prepare('UPDATE attempts SET record=? WHERE id=?').run(JSON.stringify(attempt), attempt.id); this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  authored(id: string, analysis: PairAnalysis) {
    const current = this.get(id); if (!current || current.analysis || this.attempts().some(a => a.pairId === id)) throw new Error('Existing evidence or attempt cannot be replaced');
    const updated: VisitPair = { ...current, analysis: PairAnalysisSchema.parse(analysis), source: 'authored_fixture', model: 'authored-pair-fixture' };
    this.db.prepare('UPDATE pairs SET record=? WHERE id=?').run(JSON.stringify(updated), id); return updated;
  }
}
