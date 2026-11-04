import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { ObservationsSchema, type ObservationRun, type SavedFrame, type Health } from '../domain/contracts.ts';
import { ECONOMY, EconomicGuardError, estimatedCost } from './economy.ts';
import type { Store } from './store.ts';

interface MetaResponse {
  id: string; model: string; status?: string | null; output_text: string;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number;
    input_tokens_details?: { cached_tokens: number }; output_tokens_details?: { reasoning_tokens: number } } | null;
}
export interface MetaTransport {
  count(request: ReturnType<typeof observationRequest>): Promise<number>;
  generate(request: ReturnType<typeof observationRequest>): Promise<MetaResponse>;
}

export function providerHealth(): Health {
  return { liveEnabled: process.env.ENABLE_LIVE_META_API === 'true',
    liveConfigured: Boolean(process.env.MODEL_API_KEY && process.env.META_MODEL),
    creditConfirmed: process.env.META_CREDITS_CONFIRMED === 'true',
    model: process.env.META_MODEL || 'Not configured', provider: 'Meta Model API', storage: 'SQLite + local frames' };
}

export function mockObservation(frameId: string): ObservationRun {
  return { id: randomUUID(), frameId, mode: 'mock', model: 'wiring-fixture-v1', createdAt: new Date().toISOString(),
    latencyMs: 0, usage: {}, observations: {
      summary: 'Wiring example only. These sample objects were authored, not inferred from this image.',
      objects: [{ label: 'Example object', appearance: 'Sample fixture, not a visual observation',
        locationDescription: 'Unverified', uncertainty: 'No model inference was performed.', bbox: null }],
    } };
}

// Only the saved pixels and public capture metadata cross into the provider.
export function observationRequest(frame: Pick<SavedFrame, 'zone' | 'capturedAt'>, imageDataUrl: string) {
  return {
    model: process.env.META_MODEL || 'muse-spark-1.3',
    store: false,
    max_output_tokens: ECONOMY.maxOutputTokens,
    reasoning: { effort: 'minimal' as const },
    input: [{ role: 'user' as const, content: [
      { type: 'input_text' as const, text: `Inspect this camera frame. Declared zone: ${frame.zone}. Captured: ${frame.capturedAt}. Describe at most ${ECONOMY.maxObjects} distinct visible portable objects, prioritizing tools, containers and parts. Omit room and furniture. Use short literal English labels and compact descriptions (at most 12 words per field). Describe only visible appearance and spatial relationships. No hidden contents, missing claims, invented IDs or unseen events. Keep uncertainty explicit; no numeric confidence. Set bbox to null for this economical test. Return the specified JSON.` },
      { type: 'input_image' as const, image_url: imageDataUrl, detail: 'auto' as const },
    ] }],
    text: { format: { type: 'json_schema' as const, name: 'frame_observations', strict: true,
      // Refinements are validated again locally; strict schema is explicitly authored for the provider.
      schema: { type: 'object', additionalProperties: false, required: ['summary', 'objects'], properties: {
        summary: { type: 'string' }, objects: { type: 'array', maxItems: ECONOMY.maxObjects, items: { type: 'object', additionalProperties: false,
          required: ['label', 'appearance', 'locationDescription', 'uncertainty', 'bbox'], properties: {
            label: { type: 'string' }, appearance: { type: 'string' }, locationDescription: { type: 'string' },
            uncertainty: { type: 'string' }, bbox: { type: 'null' },
          } } },
      } },
    } },
  };
}

export async function observeLive(frame: SavedFrame, image: { bytes: Buffer; mime: string }, store: Store, transport?: MetaTransport): Promise<ObservationRun> {
  const health = providerHealth();
  if (!health.liveEnabled || !health.liveConfigured || !health.creditConfirmed) throw new Error('Live analysis is disabled until credentials and applied credits are confirmed locally.');
  if (process.env.META_MODEL !== ECONOMY.model || Math.max(frame.width, frame.height) > ECONOMY.maxEdge) throw new Error('Use the economic model and capture size');
  const previous = store.liveAttempts();
  if (previous.some(attempt => attempt.frameId === frame.id) || previous.length >= ECONOMY.maxCalls) throw new EconomicGuardError('This test already ran or the economic call limit was reached. No generation started.');
  const started = performance.now();
  if (!transport) {
    const client = new OpenAI({ apiKey: process.env.MODEL_API_KEY, baseURL: 'https://api.meta.ai/v1', maxRetries: 0, timeout: 45_000 });
    transport = { count: async request => (await client.responses.inputTokens.count({ model: request.model, input: request.input, text: request.text, reasoning: request.reasoning })).input_tokens,
      generate: request => client.responses.create(request) };
  }
  const request = observationRequest(frame, `data:${image.mime};base64,${image.bytes.toString('base64')}`);
  let contextTokens;
  try { contextTokens = await transport.count(request); }
  catch (error) { throw new EconomicGuardError(`Token preflight failed${error instanceof OpenAI.APIError && error.status ? ` (HTTP ${error.status})` : ''}. No generation started.`); }
  const attempt = store.reserveLiveAttempt(frame.id, contextTokens);
  let result;
  try { result = await transport.generate(request); }
  catch (error) {
    attempt.status = 'provider_error'; attempt.latencyMs = Math.round(performance.now() - started);
    if (error instanceof OpenAI.APIError && error.status) attempt.httpStatus = error.status;
    store.finishLiveAttempt(attempt); throw new Error('Meta request failed; reservation retained and no retry was made');
  }
  attempt.latencyMs = Math.round(performance.now() - started); attempt.responseId = result.id;
  if (result.usage) {
    const usage = result.usage, cached = usage.input_tokens_details?.cached_tokens ?? 0, reasoning = usage.output_tokens_details?.reasoning_tokens ?? 0;
    attempt.usage = { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens,
      cachedInputTokens: cached, reasoningTokens: reasoning, visibleOutputTokens: Math.max(0, usage.output_tokens - reasoning),
      estimatedCostUsd: estimatedCost(usage.input_tokens, usage.output_tokens, cached) };
  }
  if (result.status !== 'completed') { attempt.status = 'incomplete'; store.finishLiveAttempt(attempt); throw new Error('Model did not complete; partial output was not committed'); }
  let observations;
  try { observations = ObservationsSchema.parse(JSON.parse(result.output_text)); }
  catch { attempt.status = 'invalid_output'; store.finishLiveAttempt(attempt); throw new Error('Model output did not pass validation'); }
  attempt.status = 'completed'; store.finishLiveAttempt(attempt);
  return { id: randomUUID(), frameId: frame.id, mode: 'live', model: result.model, createdAt: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - started), observations,
    usage: { ...attempt.usage, preflightContextTokens: contextTokens, reservedCostUsd: attempt.reservedUsd } };
}
