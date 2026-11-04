import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.ts';
import { VisitPairStore } from './visit-pair-store.ts';
import { observePair, type PairTransport } from './visit-pair-observer.ts';
import { PairAnalysisSchema, projectVisitPair, projectVisitPairV1, projectVisitPairV2, MATCHING_VERSION, type VisitPair } from '../domain/visit-pair.ts';
import { EconomicGuardError } from './economy.ts';

export function registerVisitPairs(app: FastifyInstance, directory: string, frames: Store, transport?: PairTransport) {
  const pairs = new VisitPairStore(directory); let working = false;
  app.addHook('onClose', async () => pairs.close());
  const present = (pair: VisitPair) => ({ ...pair, items: projectVisitPair(pair), matchingVersion: MATCHING_VERSION, previousItems: projectVisitPairV1(pair), appearanceV2Items: projectVisitPairV2(pair) });
  app.get('/api/visit-pairs', async () => ({ pairs: pairs.list().map(present), trial: pairs.usage() }));
  app.post('/api/visit-pairs', async (request, reply) => {
    const body = z.strictObject({ beforeFrameId: z.uuid(), afterFrameId: z.uuid() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Choose two saved visit frames.' });
    const before = frames.getFrame(body.data.beforeFrameId), after = frames.getFrame(body.data.afterFrameId);
    if (!before || !after) return reply.code(404).send({ error: 'Saved visit frame not found.' });
    const { run: _beforeRun, ...left } = before, { run: _afterRun, ...right } = after;
    try { return present(pairs.create(left, right)); }
    catch(error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Visits are not comparable.' }); }
  });
  app.post<{ Params: { id: string } }>('/api/visit-pairs/:id/analyze', async (request, reply) => {
    if (!z.strictObject({ mode: z.literal('live') }).safeParse(request.body).success) return reply.code(400).send({ error: 'Request live comparison explicitly.' });
    const pair = pairs.get(request.params.id); if (!pair) return reply.code(404).send({ error: 'Visit pair not found.' });
    if (pair.analysis) return present(pair);
    if (working) return reply.code(429).send({ error: 'One comparison is already in progress.' });
    working = true;
    try { return present(await observePair(pair, frames, pairs, transport)); }
    catch(error) { return reply.code(error instanceof EconomicGuardError ? 422 : 502).send({ error: error instanceof EconomicGuardError ? error.message : 'Comparison failed; evidence preserved.' }); }
    finally { working = false; }
  });
  app.post<{ Params: { id: string } }>('/api/visit-pairs/:id/authored', async (request, reply) => {
    const parsed = z.strictObject({ provenance: z.literal('authored_fixture'), analysis: PairAnalysisSchema }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Authored fixtures require explicit provenance and a complete analysis.' });
    if (!pairs.get(request.params.id)) return reply.code(404).send({ error: 'Visit pair not found.' });
    try { return present(pairs.authored(request.params.id, parsed.data.analysis)); }
    catch { return reply.code(409).send({ error: 'Existing comparison evidence or live attempt cannot be overwritten.' }); }
  });
}
