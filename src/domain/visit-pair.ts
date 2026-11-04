import { z } from 'zod';
import { ObservationSchema, type SavedFrame } from './contracts.ts';
import { appearanceFeatures, compatibleAppearance, distinctiveAppearanceKey } from './appearance-features.ts';
import { isGroupObservation, groupMayCoverIndividual } from './group-coverage.ts';

const view = z.strictObject({ summary: z.string().max(1200), objects: z.array(ObservationSchema).max(6) });
export const PairAnalysisSchema = z.strictObject({
  summary: z.string().max(1200), before: view, after: view,
  links: z.array(z.strictObject({ beforeIndex: z.number().int().nonnegative(), afterIndex: z.number().int().nonnegative(),
    decision: z.enum(['same_candidate', 'uncertain']), reason: z.string().min(1).max(600) })).max(12),
}).superRefine((result, context) => {
  for (const link of result.links) if (link.beforeIndex >= result.before.objects.length || link.afterIndex >= result.after.objects.length)
    context.addIssue({ code: 'custom', message: 'Link refers to an absent observation' });
});
export type PairAnalysis = z.infer<typeof PairAnalysisSchema>;
export type PairFrame = Omit<SavedFrame, 'run'>;
export interface VisitPair {
  id: string; createdAt: string; before: PairFrame; after: PairFrame;
  analysis: PairAnalysis | null; source: 'live_model' | 'authored_fixture' | null;
  model: string | null; usage: Record<string, number>;
}
export type PairKind = 'same_candidate' | 'newly_observed' | 'not_observed' | 'unresolved';
export interface PairItem {
  id: string; kind: PairKind; label: string; reason: string;
  scope?: 'individual' | 'group';
  groupCoverage?: { side: 'before' | 'after'; index: number; supportsCoverage: boolean }[];
  beforeIndex: number | null; afterIndex: number | null; candidateIds: string[];
  lastSeen: { frameId: string; capturedAt: string; location: string };
}

export function pairContextError(before: PairFrame, after: PairFrame): string | null {
  if (before.id === after.id || before.capturedAt >= after.capturedAt) return 'Choose a later, different visit.';
  if (!before.referenceView || before.referenceView !== after.referenceView || before.zone !== after.zone)
    return 'Capture both visits from the same declared reference view; legacy/unassigned views cannot be compared here.';
  if (before.width !== after.width || before.height !== after.height) return 'Capture both visits at the same resolution.';
  return null;
}

// A conservative ambiguity guard, not a visual identity classifier. Known noun aliases
// stop two same-colour lookalikes being forced together even if the model proposes it.
export function appearanceGroup(label: string): string {
  const text = label.toLowerCase().replace(/tool\s*box|tool\s*case|carrying case/g, 'case').replace(/cordless\s+drill|power\s+drill/g, 'drill');
  const noun = ['multimeter', 'screwdriver', 'drill', 'case', 'bin', 'tray', 'robot', 'box', 'sensor', 'wrench'].find(word => new RegExp(`\\b${word}\\b`).test(text));
  const colour = ['blue', 'red', 'orange', 'yellow', 'green', 'teal', 'black', 'white', 'gray', 'grey', 'brown'].find(word => new RegExp(`\\b${word}\\b`).test(text));
  return noun ? `${noun}:${colour === 'grey' ? 'gray' : colour ?? ''}` : text.replace(/\b(left|right|middle|first|second|small|large|\d+)\b/g, '').replace(/\s+/g, ' ').trim();
}
function family(label: string): string | null {
  const text = appearanceGroup(label).split(':')[0];
  if (['case', 'bin', 'tray', 'box'].includes(text)) return 'container';
  if (['multimeter', 'screwdriver', 'drill', 'wrench'].includes(text)) return 'tool';
  if (text === 'robot') return 'assembly';
  if (text === 'sensor') return 'part';
  return null;
}

export function projectVisitPairV1(pair: VisitPair): PairItem[] {
  if (!pair.analysis) return [];
  const raw = PairAnalysisSchema.parse(pair.analysis), prior = raw.before.objects, next = raw.after.objects;
  const samePixels = pair.before.imageHash === pair.after.imageHash;
  const oldId = (i: number) => `item:${pair.id}:before:${i}`;
  const newId = (i: number) => `item:${pair.id}:after:${i}`;
  const group = (items: typeof prior, key: string) => items.filter(item => appearanceGroup(item.label) === key).length;
  const accepted = raw.links.filter(link => {
    const key = appearanceGroup(prior[link.beforeIndex].label), other = appearanceGroup(next[link.afterIndex].label);
    const a = family(prior[link.beforeIndex].label), b = family(next[link.afterIndex].label);
    const groupDescription = /\b(boxes|containers|parts|tools|items|trays|bins|cases|robots|drills|sensors|wrenches|screwdrivers)\b/i;
    return !samePixels && link.decision === 'same_candidate'
      && !(a && b && a !== b)
      && !groupDescription.test(prior[link.beforeIndex].label) && !groupDescription.test(next[link.afterIndex].label)
      && raw.links.filter(other => other.decision === 'same_candidate' && other.beforeIndex === link.beforeIndex).length === 1
      && raw.links.filter(other => other.decision === 'same_candidate' && other.afterIndex === link.afterIndex).length === 1
      && group(prior, key) === 1 && group(next, other) === 1;
  });
  const linkedBefore = new Set(accepted.map(link => link.beforeIndex)), linkedAfter = new Set(accepted.map(link => link.afterIndex));
  const seen = (frame: PairFrame, location: string) => ({ frameId: frame.id, capturedAt: frame.capturedAt, location });
  const rows: PairItem[] = accepted.map(link => ({
    id: oldId(link.beforeIndex), kind: 'same_candidate', label: next[link.afterIndex].label,
    reason: `${link.reason} Model-proposed continuity; unique physical identity is not proven.`,
    beforeIndex: link.beforeIndex, afterIndex: link.afterIndex, candidateIds: [], lastSeen: seen(pair.after, next[link.afterIndex].locationDescription),
  }));
  prior.forEach((item, index) => {
    if (linkedBefore.has(index)) return;
    const related = raw.links.some(link => link.beforeIndex === index) || next.some(other => appearanceGroup(other.label) === appearanceGroup(item.label));
    rows.push({ id: oldId(index), kind: samePixels || related ? 'unresolved' : 'not_observed', label: item.label,
      reason: samePixels ? 'Identical saved pixels cannot establish a visit change.' : related
        ? 'Competing or unsupported associations remain unresolved; earlier evidence is retained.'
        : 'Not described in visit 2. Hidden, out of frame or overlooked remain possible; this does not mean missing.',
      beforeIndex: index, afterIndex: null, candidateIds: [], lastSeen: seen(pair.before, item.locationDescription) });
  });
  next.forEach((item, index) => {
    if (linkedAfter.has(index)) return;
    const possible = new Set(raw.links.filter(link => link.afterIndex === index).map(link => link.beforeIndex));
    prior.forEach((old, i) => { if (appearanceGroup(old.label) === appearanceGroup(item.label)) possible.add(i); });
    rows.push({ id: newId(index), kind: samePixels || possible.size ? 'unresolved' : 'newly_observed', label: item.label,
      reason: samePixels ? 'Identical saved pixels received a different interpretation.' : possible.size
        ? 'Possible earlier candidates remain; no forced identity merge.'
        : 'First described in visit 2. It may have been outside the earlier view; physical arrival is not established.',
      beforeIndex: null, afterIndex: index, candidateIds: [...possible].map(oldId), lastSeen: seen(pair.after, item.locationDescription) });
  });
  return rows;
}


export const MATCHING_VERSION = 'group-scope-v3';
/** Reproducible derived revision over immutable observations. V1 remains available
 * for comparison; neither projection edits raw model links or recorded usage. */
export function projectVisitPairV2(pair: VisitPair): PairItem[] {
  return projectAppearancePair(pair, false);
}
export function projectVisitPair(pair: VisitPair): PairItem[] {
  return projectAppearancePair(pair, true);
}
function projectAppearancePair(pair: VisitPair, groupScoped: boolean): PairItem[] {
  if (!pair.analysis) return [];
  const raw = PairAnalysisSchema.parse(pair.analysis), prior = raw.before.objects, next = raw.after.objects;
  const scopes = (objects: typeof prior) => objects.map(isGroupObservation);
  const leftGroups = scopes(prior), rightGroups = scopes(next);
  const groupId = (side: 'before' | 'after', index: number) => `group:${pair.id}:${side}:${index}`;
  if (pair.before.imageHash === pair.after.imageHash) return projectVisitPairV1(pair).map(row => {
    if (!groupScoped) return row;
    const side = row.beforeIndex !== null ? 'before' : 'after', index = row.beforeIndex ?? row.afterIndex!;
    const grouped = side === 'before' ? leftGroups[index] : rightGroups[index];
    return { ...row, scope: grouped ? 'group' : 'individual', ...(grouped ? { id: groupId(side,index) } : {}) };
  });
  const features = (objects: typeof prior, groups: boolean[]) => objects.map((object, index) => {
    const value = appearanceFeatures(object); return groupScoped ? { ...value, grouped: groups[index] } : value;
  });
  const left = features(prior,leftGroups), right = features(next,rightGroups);
  const leftKeys = left.map(distinctiveAppearanceKey), rightKeys = right.map(distinctiveAppearanceKey);
  const oldId = (i: number) => `item:${pair.id}:before:${i}`;
  const newId = (i: number) => `item:${pair.id}:after:${i}`;
  const usedBefore = new Set<number>(), usedAfter = new Set<number>();
  const rows: PairItem[] = [];
  leftKeys.forEach((key, beforeIndex) => {
    if (!key || leftKeys.filter(value => value === key).length !== 1 || rightKeys.filter(value => value === key).length !== 1) return;
    const afterIndex = rightKeys.indexOf(key), features = left[beforeIndex];
    usedBefore.add(beforeIndex); usedAfter.add(afterIndex);
    rows.push({ id: oldId(beforeIndex), kind: 'same_candidate', label: next[afterIndex].label,
      reason: `Derived appearance candidate: shared ${features.bodyColour} ${features.kind} with ${features.band.colour} band. No competing described band signature; location did not select this link. Markings can change or be hidden, so physical identity is not proven.`,
      beforeIndex, afterIndex, candidateIds: [], ...(groupScoped ? { scope: 'individual' as const } : {}),
      lastSeen: { frameId: pair.after.id, capturedAt: pair.after.capturedAt, location: next[afterIndex].locationDescription } });
  });
  // Preserve the established single-object behavior, but reject visual conflicts.
  // A raw model link cannot override a distinctive observed feature association.
  for (const row of projectVisitPairV1(pair)) {
    if (row.kind !== 'same_candidate' || row.beforeIndex === null || row.afterIndex === null) continue;
    const a = row.beforeIndex, b = row.afterIndex;
    if (usedBefore.has(a) || usedAfter.has(b) || left[a].grouped || right[b].grouped || !compatibleAppearance(left[a], right[b])) continue;
    usedBefore.add(a); usedAfter.add(b); rows.push(groupScoped ? { ...row, scope: 'individual' } : row);
  }
  // Candidate compatibility is recalculated from appearances, not from old
  // position-based model proposals. Unknown features keep ambiguity alive.
  prior.forEach((item, index) => {
    if (usedBefore.has(index)) return;
    if (groupScoped && leftGroups[index]) {
      rows.push({ id: groupId('before',index), kind: 'unresolved', scope: 'group', label: item.label,
        reason: 'Earlier group observation retained as coverage evidence. It does not identify individual members or prove their later absence.',
        beforeIndex: index, afterIndex: null, candidateIds: [], lastSeen: { frameId: pair.before.id, capturedAt: pair.before.capturedAt, location: item.locationDescription } }); return;
    }
    const groupCoverage = groupScoped ? next.flatMap((object, i) => rightGroups[i]
      ? [{ side: 'after' as const, index: i, supportsCoverage: groupMayCoverIndividual(object,right[i],left[index]) }] : []) : [];
    const possible = next.flatMap((_, i) => (!groupScoped || !rightGroups[i]) && compatibleAppearance(left[index], right[i]) ? [i] : []);
    const covered = groupCoverage.some(value=>value.supportsCoverage);
    rows.push({ id: oldId(index), kind: possible.length || covered ? 'unresolved' : 'not_observed', label: item.label,
      ...(groupScoped ? { scope: 'individual' as const, groupCoverage } : {}),
      reason: covered ? 'A later compatible group may include this object; individual identity is unresolved. Group evidence is not an identity link.' : possible.length
        ? 'Compatible appearance candidates remain, but no unique observed distinguishing feature supports a link. Earlier evidence retained.'
        : 'Earlier appearance is not described in visit 2. Hidden, overlooked or changed appearance remain possible; this does not mean missing.',
      beforeIndex: index, afterIndex: null, candidateIds: [],
      lastSeen: { frameId: pair.before.id, capturedAt: pair.before.capturedAt, location: item.locationDescription } });
  });
  next.forEach((item, index) => {
    if (usedAfter.has(index)) return;
    if (groupScoped && rightGroups[index]) {
      rows.push({ id: groupId('after',index), kind: 'unresolved', scope: 'group', label: item.label,
        reason: 'Group observation retained separately. A change in group wording/count is not a new individual object.',
        beforeIndex: null, afterIndex: index, candidateIds: [], lastSeen: { frameId: pair.after.id, capturedAt: pair.after.capturedAt, location: item.locationDescription } }); return;
    }
    const groupCoverage = groupScoped ? prior.flatMap((object, i) => leftGroups[i]
      ? [{ side: 'before' as const, index: i, supportsCoverage: groupMayCoverIndividual(object,left[i],right[index]) }] : []) : [];
    const possible = prior.flatMap((_, i) => (!groupScoped || !leftGroups[i]) && compatibleAppearance(left[i], right[index]) ? [i] : []);
    const covered = groupCoverage.some(value=>value.supportsCoverage);
    rows.push({ id: newId(index), kind: possible.length || covered ? 'unresolved' : 'newly_observed', label: item.label,
      ...(groupScoped ? { scope: 'individual' as const, groupCoverage } : {}),
      reason: covered ? 'An earlier compatible group may already include this appearance. Individual identity is unresolved; group evidence is not an earlier item ID.' : possible.length
        ? 'Compatible earlier appearances remain. Unknown or unreported features are not evidence of absence; no identity forced by elimination.'
        : groupScoped ? 'First individually described appearance in visit 2. Group observations remain separate; an earlier object could have changed appearance; physical arrival is not established.'
        : 'First described appearance in visit 2. An earlier object could have acquired a different marking or appearance; physical arrival is not established.',
      beforeIndex: null, afterIndex: index, candidateIds: possible.map(oldId),
      lastSeen: { frameId: pair.after.id, capturedAt: pair.after.capturedAt, location: item.locationDescription } });
  });
  return rows;
}
