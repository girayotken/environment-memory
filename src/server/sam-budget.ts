/** A separate unit-priced trial; never shares or resets the Muse token ledger. */
export const SAM_TRIAL = Object.freeze({ model: 'sam-3.1', maxCalls: 3, capUsd: 0.01,
  maxFrames: 16, minimumVideoBillingFrames: 50, imageUsd: 0.0025, frameUsd: 0.0002 });
export interface SamAttempt { media: 'image'|'video'; frames: number; reservedUsd: number; status: string; usageEstimatedCostUsd?: number }
export function samUsageCost(media: 'image'|'video', usage: Record<string,unknown>) {
  const units = usage[media === 'image' ? 'images_processed' : 'video_frames_processed'];
  if (typeof units !== 'number' || !Number.isInteger(units) || units < 1) throw new Error('SAM billable usage missing or invalid');
  return units * (media === 'image' ? SAM_TRIAL.imageUsd : SAM_TRIAL.frameUsd);
}
export function reserveSamCost(previous: readonly SamAttempt[], media: 'image'|'video', frames: number) {
  if (!Number.isInteger(frames) || frames < 1 || frames > SAM_TRIAL.maxFrames || (media === 'image' && frames !== 1)) throw new Error('Invalid SAM media units');
  const cost = media === 'image' ? SAM_TRIAL.imageUsd : Math.max(frames,SAM_TRIAL.minimumVideoBillingFrames) * SAM_TRIAL.frameUsd;
  if (previous.length >= SAM_TRIAL.maxCalls || previous.reduce((sum, a) => sum + Math.max(a.reservedUsd,a.usageEstimatedCostUsd??0), 0) + cost > SAM_TRIAL.capUsd + 1e-12) throw new Error('SAM trial budget exhausted; no request started');
  return cost;
}
