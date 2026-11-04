import Fastify from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { FrameSchema, ReplaySchema } from '../domain/contracts.ts';
import { buildMemory } from '../domain/memory.ts';
import { Store } from './store.ts';
import { mockObservation, observeLive, providerHealth, type MetaTransport } from './observer.ts';
import { ECONOMY, EconomicGuardError } from './economy.ts';
import { registerVisitPairs } from './visit-pair-routes.ts';
import { registerPlaces } from './place-routes.ts';
import type { PairTransport } from './visit-pair-observer.ts';
import {registerVisualEvidence} from './visual-routes.ts';
import {registerRelations} from './relation-routes.ts';
import {registerAutomaticRelations} from './automatic-relations.ts';

export function createApp(directory: string, options: { port?: number; meta?: MetaTransport; pairMeta?: PairTransport; readOnly?:boolean } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 6_100_000 });
  const store = new Store(directory);
  let observing = false;
  app.addHook('onClose', async () => store.close());
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !['http://localhost:5177', 'http://127.0.0.1:5177', 'http://localhost:7384', 'http://127.0.0.1:7384', ...(options.port ? [`http://localhost:${options.port}`, `http://127.0.0.1:${options.port}`] : [])].includes(origin)) {
      return reply.code(403).send({ error: 'Origin not allowed' });
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    if(options.readOnly&&!['GET','HEAD','OPTIONS'].includes(request.method))return reply.code(403).send({error:'Saved evidence review is read-only. No new inference or uploads.'});
  });
  app.get('/api/health', async () => options.readOnly?{...providerHealth(),liveEnabled:false,readOnly:true}:providerHealth());
  app.get('/api/live-usage', async () => {
    const attempts = store.liveAttempts();
    return { limits: ECONOMY, attempts, reservedUsd: attempts.reduce((sum, attempt) => sum + attempt.reservedUsd, 0),
      estimatedUsd: attempts.reduce((sum, attempt) => sum + (attempt.usage.estimatedCostUsd ?? 0), 0) };
  });
  app.get('/api/frames', async () => store.listFrames());
  app.get<{ Params: { id: string } }>('/api/frames/:id', async (request, reply) => {
    const frame = store.getFrame(request.params.id);
    return frame ?? reply.code(404).send({ error: 'Frame not found' });
  });
  app.get('/api/memory', async (request, reply) => {
    const query = z.strictObject({ stream: z.enum(['live', 'authored', 'imported']).default('live'), after: z.uuid().optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid memory source or frame ID' });
    return buildMemory(store.analyzedFrames(), query.data.stream, query.data.after);
  });
  app.post<{ Params: { id: string } }>('/api/frames/:id/replay', async (request, reply) => {
    const body = ReplaySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid replay. Expected schemaVersion, declared provenance, model and complete observations.' });
    if (!store.getFrame(request.params.id)) return reply.code(404).send({ error: 'Frame not found' });
    try {
      return store.saveRun({ id: randomUUID(), frameId: request.params.id, mode: 'replay', model: body.data.model,
        provenance: body.data.provenance, createdAt: new Date().toISOString(), latencyMs: 0, usage: {}, observations: body.data.observations });
    } catch { return reply.code(409).send({ error: 'This frame already has different replay evidence. Existing evidence was preserved; use a new capture.' }); }
  });
  app.post('/api/frames', async (request, reply) => {
    const parsed = FrameSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid frame envelope. Only pixels and declared capture metadata are accepted.' });
    try { return reply.code(201).send(store.saveFrame(parsed.data)); }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : 'Frame could not be saved' }); }
  });
  app.get<{ Params: { id: string } }>('/api/frames/:id/image', async (request, reply) => {
    if (!z.uuid().safeParse(request.params.id).success) return reply.code(400).send({ error: 'Invalid frame ID' });
    const image = store.getImage(request.params.id);
    if (!image) return reply.code(404).send({ error: 'Frame not found' });
    return reply.type(image.mime).send(image.bytes);
  });
  app.post<{ Params: { id: string } }>('/api/frames/:id/observe', async (request, reply) => {
    const body = z.strictObject({ mode: z.enum(['mock', 'live']) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Choose mock or live analysis explicitly' });
    const frame = store.getFrame(request.params.id);
    if (!frame) return reply.code(404).send({ error: 'Frame not found' });
    const existing = store.findRun(frame.id, body.data.mode);
    if (existing) return existing;
    const health = providerHealth();
    if (body.data.mode === 'live' && (!health.liveConfigured || !health.liveEnabled || !health.creditConfirmed)) {
      return reply.code(412).send({ error: 'Live analysis is not enabled. Configure the server and confirm applied credits first.' });
    }
    if (body.data.mode === 'live' && Math.max(frame.width, frame.height) > ECONOMY.maxEdge) return reply.code(422).send({ error: 'Take a new economic capture (640px or smaller) before analysis.' });
    if (observing) return reply.code(429).send({ error: 'One observation is already in progress. Please wait.' });
    observing = true;
    try {
      const run = body.data.mode === 'mock' ? mockObservation(frame.id) : await observeLive(frame, store.getImage(frame.id)!, store, options.meta);
      return store.saveRun(run);
    } catch (error) {
      // Never send raw provider errors, keys, request bodies or partial observations to the client.
      if (error instanceof EconomicGuardError) return reply.code(422).send({ error: error.message });
      return reply.code(502).send({ error: 'Observation failed. Previous evidence was preserved; no partial result was committed.' });
    } finally { observing = false; }
  });
  registerVisitPairs(app, directory, store, options.pairMeta);
  const places=registerPlaces(app, directory, store);
  registerVisualEvidence(app,directory,store,places);
  registerRelations(app,directory,store,places);
  registerAutomaticRelations(app,directory,store,places);
  return app;
}
