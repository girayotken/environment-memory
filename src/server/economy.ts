// Verified against Meta's official pricing/rate-limits page, 2026-10-27.
export const ECONOMY = Object.freeze({ model: 'muse-spark-1.3', maxEdge: 640, maxInputTokens: 4096,
  maxOutputTokens: 1600, maxObjects: 6, maxCalls: 3, budgetUsd: 0.05,
  inputPerMillion: 1.25, cachedPerMillion: 0.15, outputPerMillion: 4.25 });
export class EconomicGuardError extends Error {}

export function estimatedCost(input: number, output: number, cached = 0) {
  if (![input, output, cached].every(value => Number.isInteger(value) && value >= 0) || cached > input) throw new Error('Invalid token accounting');
  return ((input - cached) * ECONOMY.inputPerMillion + cached * ECONOMY.cachedPerMillion + output * ECONOMY.outputPerMillion) / 1_000_000;
}
export function conservativeReservation(contextTokens: number) {
  if (!Number.isInteger(contextTokens) || contextTokens < 0 || contextTokens > ECONOMY.maxInputTokens) throw new EconomicGuardError(`Preflight context ${contextTokens} exceeds the economic test limit (${ECONOMY.maxInputTokens}). No generation started.`);
  // Context count includes steering overhead; this is a conservative test guard,
  // not an invoice prediction. No tools, conversation growth or automatic retries.
  return estimatedCost(contextTokens, ECONOMY.maxOutputTokens);
}
export interface LiveAttempt {
  id: string; frameId: string; model: string; createdAt: string;
  status: 'reserved' | 'completed' | 'incomplete' | 'invalid_output' | 'provider_error';
  contextTokens: number; reservedUsd: number; latencyMs: number;
  usage: Record<string, number>; responseId?: string; httpStatus?: number;
}
export interface TrialUsage { limits: typeof ECONOMY; attempts: LiveAttempt[]; reservedUsd: number; estimatedUsd: number }
