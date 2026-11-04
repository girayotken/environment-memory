import OpenAI from 'openai';
import type { Store } from './store.ts';
import { PairAnalysisSchema, type VisitPair } from '../domain/visit-pair.ts';
import { VisitPairStore, PAIR_LIMITS } from './visit-pair-store.ts';
import { EconomicGuardError, estimatedCost } from './economy.ts';
import { providerHealth } from './observer.ts';

type Image = { bytes: Buffer; mime: string };
interface PairResponse {
  model: string; status?: string | null; output_text: string;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number;
    input_tokens_details?: { cached_tokens: number }; output_tokens_details?: { reasoning_tokens: number } } | null;
}
export interface PairTransport {
  count(request: ReturnType<typeof pairRequest>): Promise<number>;
  generate(request: ReturnType<typeof pairRequest>): Promise<PairResponse>;
}
const objectSchema = { type: 'object', additionalProperties: false,
  required: ['label', 'appearance', 'locationDescription', 'uncertainty', 'bbox'], properties: {
    label: { type: 'string' }, appearance: { type: 'string' }, locationDescription: { type: 'string' }, uncertainty: { type: 'string' },
    bbox: { anyOf: [{ type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 }, { type: 'null' }] },
  } };
const viewSchema = { type: 'object', additionalProperties: false, required: ['summary', 'objects'], properties: {
  summary: { type: 'string' }, objects: { type: 'array', maxItems: 6, items: objectSchema },
} };
export function pairRequest(pair: Pick<VisitPair, 'before' | 'after'>, images: [Image, Image]) {
  return { model: PAIR_LIMITS.model, store: false, max_output_tokens: PAIR_LIMITS.maxOutputTokens,
    reasoning: { effort: 'minimal' as const },
    input: [{ role: 'user' as const, content: [
      { type: 'input_text' as const, text: `Compare two independently saved visits from the same declared fixed camera view. Image 1 is earlier (${pair.before.capturedAt}, zone ${pair.before.zone}); image 2 is later (${pair.after.capturedAt}, zone ${pair.after.zone}). Inspect pixels only. In each image describe at most 6 distinct visible portable foreground objects on or beneath the main workbench. Omit furniture, background shelving and its contents. Keep fields under 12 words. Give an approximate normalized bbox [left,top,right,bottom] when visible, else null. Propose links between zero-based before/after object indices using same_candidate only when distinguishing appearance supports continuity and no competing lookalike is visible; otherwise uncertain. Match each observation to at most one same_candidate. Location changes alone do not change identity. Do not assume every earlier object remains, or invent events, IDs, hidden contents or numerical confidence. Use only supported visual reasons. Unmatched objects are newly described/not described; do not claim arrival, removal or confirmed absence. No expected object list is provided.` },
      { type: 'input_image' as const, image_url: `data:${images[0].mime};base64,${images[0].bytes.toString('base64')}`, detail: 'auto' as const },
      { type: 'input_image' as const, image_url: `data:${images[1].mime};base64,${images[1].bytes.toString('base64')}`, detail: 'auto' as const },
    ] }],
    text: { format: { type: 'json_schema' as const, name: 'two_visit_observations', strict: true,
      schema: { type: 'object', additionalProperties: false, required: ['summary', 'before', 'after', 'links'], properties: {
        summary: { type: 'string' }, before: viewSchema, after: viewSchema,
        links: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false,
          required: ['beforeIndex', 'afterIndex', 'decision', 'reason'], properties: {
            beforeIndex: { type: 'integer', minimum: 0 }, afterIndex: { type: 'integer', minimum: 0 },
            decision: { type: 'string', enum: ['same_candidate', 'uncertain'] }, reason: { type: 'string' },
          } } },
      } },
    } },
  };
}

export async function observePair(pair: VisitPair, frames: Store, store: VisitPairStore, transport?: PairTransport) {
  if (pair.analysis) return pair;
  const health = providerHealth();
  if (process.env.ENABLE_LIVE_VISIT_COMPARISON !== 'true' || !health.liveEnabled || !health.liveConfigured || !health.creditConfirmed || health.model !== PAIR_LIMITS.model)
    throw new EconomicGuardError('Live two-visit comparison is not enabled for this trial. Saved views remain available.');
  const attempts = store.attempts();
  if (attempts.some(a => a.pairId === pair.id) || attempts.length >= PAIR_LIMITS.maxCalls) throw new EconomicGuardError('Comparison already attempted or the trial cap is reached; no retry started.');
  if ([pair.before, pair.after].some(frame => Math.max(frame.width, frame.height) > PAIR_LIMITS.maxEdge)) throw new EconomicGuardError('Use captures no larger than 640px.');
  const left = frames.getImage(pair.before.id), right = frames.getImage(pair.after.id);
  if (!left || !right) throw new EconomicGuardError('Saved image evidence is unavailable.');
  const request = pairRequest(pair, [left, right]), started = performance.now();
  if (!transport) {
    const client = new OpenAI({ apiKey: process.env.MODEL_API_KEY, baseURL: 'https://api.meta.ai/v1', maxRetries: 0, timeout: 45_000 });
    transport = { count: async request => (await client.responses.inputTokens.count({ model: request.model, input: request.input, text: request.text, reasoning: request.reasoning })).input_tokens,
      generate: request => client.responses.create(request) };
  }
  let count: number;
  try { count = await transport.count(request); }
  catch { throw new EconomicGuardError('Comparison token preflight failed; no generation started.'); }
  const attempt = store.reserve(pair.id, count);
  let response: PairResponse;
  try { response = await transport.generate(request); }
  catch { attempt.status = 'provider_error'; attempt.latencyMs = Math.round(performance.now() - started); store.finish(attempt); throw new EconomicGuardError('Comparison provider request failed; reservation retained. No retry.'); }
  attempt.latencyMs = Math.round(performance.now() - started);
  if (response.usage) {
    const u = response.usage, cached = u.input_tokens_details?.cached_tokens ?? 0, reasoning = u.output_tokens_details?.reasoning_tokens ?? 0;
    attempt.usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens,
      cachedInputTokens: cached, reasoningTokens: reasoning, visibleOutputTokens: Math.max(0, u.output_tokens - reasoning),
      estimatedCostUsd: estimatedCost(u.input_tokens, u.output_tokens, cached), latencyMs: attempt.latencyMs };
  }
  if (response.status !== 'completed') { attempt.status = 'incomplete'; store.finish(attempt); throw new EconomicGuardError('Comparison incomplete; previous evidence retained and partial result discarded.'); }
  let analysis;
  try { analysis = PairAnalysisSchema.parse(JSON.parse(response.output_text)); }
  catch { attempt.status = 'invalid_output'; store.finish(attempt); throw new EconomicGuardError('Comparison failed validation; no partial result committed.'); }
  attempt.status = 'completed'; store.finish(attempt, { analysis, model: response.model });
  return store.get(pair.id)!;
}
