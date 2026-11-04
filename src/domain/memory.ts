import type { ObservationRun, Observations, SavedFrame, Zone } from './contracts.ts';

export type MemoryStream = 'live' | 'authored' | 'imported';
export interface AnalyzedFrame {
  // No scene object, IDs, commands or transforms are accepted by this boundary.
  frame: Pick<SavedFrame, 'id' | 'capturedAt' | 'zone' | 'imageUrl' | 'imageHash' | 'width' | 'height' | 'referenceView'>;
  run: ObservationRun;
}
export interface Evidence {
  observationId: string; frameId: string; runId: string; capturedAt: string; zone: Zone; imageUrl: string;
  label: string; appearance: string; locationDescription: string; uncertainty: string;
}
export interface MemoryItem {
  id: string; label: string; appearance: string; history: Evidence[]; lastSeen: Evidence;
  candidateItemIds: string[]; identity: 'tentative' | 'unresolved';
}
export type ChangeKind = 'newly_observed' | 'possibly_moved' | 'not_observed' | 'unchanged' | 'unresolved';
export interface Change { kind: ChangeKind; label: string; explanation: string; before: Evidence | null; after: Evidence | null }
export interface Comparison { beforeFrameId: string; afterFrameId: string; beforeFrame: AnalyzedFrame['frame']; afterFrame: AnalyzedFrame['frame']; samePixels: boolean; changes: Change[] }
export interface MemoryView {
  stream: MemoryStream; analyzedFrames: number; items: MemoryItem[];
  comparison: Comparison | null; comparisonNote: string;
}
const normalize = (value: string) => value.toLocaleLowerCase('en-US').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sameLabel = (a: { label: string }, b: { label: string }) => normalize(a.label) === normalize(b.label);
const sameAppearance = (a: { appearance: string }, b: { appearance: string }) => Boolean(normalize(a.appearance)) && normalize(a.appearance) === normalize(b.appearance);
export function streamOf(run: ObservationRun): MemoryStream | null {
  return run.mode === 'live' ? 'live' : run.mode === 'replay' ? run.provenance === 'authored_fixture' ? 'authored' : 'imported' : null;
}
function evidence(record: AnalyzedFrame, object: Observations['objects'][number], index: number): Evidence {
  return { observationId: `${record.run.id}:${index}`, frameId: record.frame.id, runId: record.run.id,
    capturedAt: record.frame.capturedAt, zone: record.frame.zone, imageUrl: record.frame.imageUrl,
    label: object.label, appearance: object.appearance, locationDescription: object.locationDescription, uncertainty: object.uncertainty };
}

/** Same-label/appearance is a tentative link, never a claim of unique real-world identity. */
export function buildMemory(input: readonly AnalyzedFrame[], stream: MemoryStream, afterFrameId?: string): MemoryView {
  // Caller supplies immutable commit order, not capture time. Late evidence cannot rekey existing items.
  const records = input.filter(record => streamOf(record.run) === stream);
  const items: MemoryItem[] = [], ingested = new Set<string>();
  for (const record of records) {
    if (ingested.has(record.run.id)) continue; ingested.add(record.run.id);
    const previous = [...items];
    record.run.observations.objects.forEach((object, index) => {
      const observed = evidence(record, object, index);
      const candidates = previous.filter(item => sameLabel(item, object));
      const countNow = record.run.observations.objects.filter(other => sameLabel(other, object)).length;
      const unique = candidates.length === 1 && countNow === 1 && candidates[0].identity !== 'unresolved' && sameAppearance(candidates[0], object);
      if (unique) {
        const item = candidates[0]; item.history.push(observed);
        if (observed.capturedAt > item.lastSeen.capturedAt || (observed.capturedAt === item.lastSeen.capturedAt && observed.frameId.localeCompare(item.lastSeen.frameId) > 0)) item.lastSeen = observed;
      } else {
        const ambiguous = candidates.length > 0 || countNow > 1 || !normalize(object.appearance);
        items.push({ id: `item:${observed.observationId}`, label: object.label, appearance: object.appearance,
          history: [observed], lastSeen: observed, candidateItemIds: candidates.map(item => item.id), identity: ambiguous ? 'unresolved' : 'tentative' });
        // Later evidence can reveal ambiguity in an earlier candidate too.
        if (ambiguous) candidates.forEach(item => { item.identity = 'unresolved'; });
      }
    });
  }
  for (const item of items) item.history.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.observationId.localeCompare(b.observationId));
  const chronological = [...records].sort((a, b) => a.frame.capturedAt.localeCompare(b.frame.capturedAt) || a.frame.id.localeCompare(b.frame.id));
  const after = afterFrameId ? chronological.find(record => record.frame.id === afterFrameId) : chronological.at(-1);
  const before = after && chronological.filter(record => record.frame.zone === after.frame.zone && record.frame.referenceView === after.frame.referenceView && record.frame.width === after.frame.width && record.frame.height === after.frame.height && record.frame.id !== after.frame.id
    && record.frame.capturedAt < after.frame.capturedAt).at(-1);
  return { stream, analyzedFrames: ingested.size, items: items.sort((a, b) => b.lastSeen.capturedAt.localeCompare(a.lastSeen.capturedAt) || a.id.localeCompare(b.id)),
    comparison: before && after ? compareFrames(before, after) : null,
    comparisonNote: !after ? 'The selected frame has no observation in this source. Unanalyzed frames do not imply absence.'
      : !before ? 'A previous analyzed view with the same reference, zone and image dimensions is needed. Other views do not establish coverage here.'
        : 'Same declared reference, zone and image dimensions; descriptions are compared. Framing and identity remain uncertain.' };
}

export function compareFrames(before: AnalyzedFrame, after: AnalyzedFrame): Comparison {
  if (before.frame.zone !== after.frame.zone || before.frame.referenceView !== after.frame.referenceView || before.frame.width !== after.frame.width || before.frame.height !== after.frame.height || streamOf(before.run) !== streamOf(after.run)) throw new Error('Compare the same zone, dimensions and evidence source/reference view');
  const left = before.run.observations.objects, right = after.run.observations.objects, changes: Change[] = [];
  const samePixels = before.frame.imageHash === after.frame.imageHash;
  right.forEach((object, index) => {
    const candidates = left.map((old, i) => ({ old, i })).filter(({ old }) => sameLabel(old, object));
    const observed = evidence(after, object, index), countNow = right.filter(other => sameLabel(other, object)).length;
    if (!candidates.length) {
      changes.push({ kind: samePixels ? 'unresolved' : 'newly_observed', label: object.label,
        explanation: samePixels ? 'Identical pixels received a different description; no room change established.' : 'Appears in this observation, but was not described in the previous view. May have been outside its view.', before: null, after: observed });
    } else if (candidates.length !== 1 || countNow !== 1 || !sameAppearance(candidates[0].old, object)) {
      changes.push({ kind: 'unresolved', label: object.label, explanation: 'Similar labels or differing appearance descriptions prevent a unique match.', before: null, after: observed });
    } else {
      const prior = evidence(before, candidates[0].old, candidates[0].i);
      const locationChanged = normalize(prior.locationDescription) !== normalize(object.locationDescription);
      changes.push({ kind: locationChanged ? samePixels ? 'unresolved' : 'possibly_moved' : 'unchanged', label: object.label,
        explanation: locationChanged ? samePixels ? 'The pixels are identical but the location descriptions differ; no movement established.'
          : 'A tentative appearance match has a different location description. Verify both images; framing or wording can also differ.'
          : 'The label, appearance and location descriptions agree. This does not prove the room is unchanged.', before: prior, after: observed });
    }
  });
  left.forEach((object, index) => {
    if (!right.some(other => sameLabel(other, object))) changes.push({ kind: samePixels ? 'unresolved' : 'not_observed', label: object.label,
      explanation: samePixels ? 'Identical pixels received a different description; earlier evidence is retained.' : 'Not described in this view. It may be hidden, out of frame or overlooked; last-seen evidence is retained.',
      before: evidence(before, object, index), after: null });
  });
  return { beforeFrameId: before.frame.id, afterFrameId: after.frame.id, beforeFrame: before.frame, afterFrame: after.frame, samePixels, changes };
}

export function searchItems(items: readonly MemoryItem[], query: string): MemoryItem[] {
  const words = normalize(query).split(' ').filter(Boolean);
  return items.filter(item => words.every(word => normalize(`${item.label} ${item.appearance}`).includes(word)));
}
