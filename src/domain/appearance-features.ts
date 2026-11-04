import type { Observations } from './contracts.ts';

type Observation = Observations['objects'][number];
export interface AppearanceFeatures {
  kind: string | null;
  bodyColour: string | null;
  band: { state: 'unknown' | 'none_visible' | 'present'; colour: string | null };
  grouped: boolean;
}
const colours = 'blue|red|orange|yellow|green|teal|black|white|gray|grey|brown';
const bandWord = '(?:band|tape|strap|stripe)';
const normal = (text: string) => text.toLowerCase().replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
const colourName = (text: string) => text === 'grey' ? 'gray' : text;
function nounText(text: string) {
  return text.replace(/\b(tool\s*box(?:es)?|tool\s*case(?:s)?|carrying case(?:s)?)\b/g, 'case')
    .replace(/\b(cordless|power)\s+drills?\b/g, 'drill').replace(/\b(cardboard|parcel)\s+box\b/g, 'box')
    .replace(/\bmeter device\b/g, 'multimeter')
    .replace(/\b(boxes|trays|bins|cases|robots|drills|sensors|wrenches|screwdrivers)\b/g, word => word === 'boxes' ? 'box' : word === 'wrenches' ? 'wrench' : word.slice(0, -1));
}

/** Small explicit English vocabulary over appearance only. Unknown is never absence.
 * Location, bbox, model links, simulator state and frame IDs are not feature inputs. */
export function appearanceFeatures(object: Pick<Observation, 'label' | 'appearance'> & Partial<Pick<Observation, 'uncertainty'>>): AppearanceFeatures {
  const raw = normal(`${object.label}. ${object.appearance}`), text = nounText(raw);
  const kind = ['multimeter', 'screwdriver', 'drill', 'case', 'bin', 'tray', 'robot', 'box', 'sensor', 'wrench']
    .find(word => new RegExp(`\\b${word}\\b`).test(text)) ?? null;
  const grouped = /\b(boxes|containers|parts|tools|items|trays|bins|cases|robots|drills|sensors|wrenches|screwdrivers)\b/.test(raw);
  // Colour must qualify an object noun, not its tape. This avoids a yellow band
  // changing the body colour of a blue case.
  const bodyNoun = kind ?? '(?:item|object|container|tool|device)';
  const body = text.match(new RegExp(`\\b(${colours})\\s+(?:(?:rectangular|plastic|molded|latched|small|large|open)\\s+){0,4}${bodyNoun}\\b`));
  const none = new RegExp(`\\b(?:no|without)\\s+(?:visible\\s+)?(?:(?:${colours})\\s+)?${bandWord}\\b`).test(raw);
  // Do not turn negation, conflicting markings or hedged descriptions into a key.
  const field = normal(object.uncertainty ?? '');
  const uncertainBand = /\b(band|tape|strap|stripe|marking|colou?r)\b/.test(field) && /\b(uncertain|unclear|occluded|hidden|unknown|maybe|possibly|not visible)\b/.test(field);
  const hedged = new RegExp(`\\b(?:maybe|possibly|perhaps|unclear|uncertain|hidden|occluded|not visible|not clearly visible)\\b`).test(raw);
  const negatedColour = new RegExp(`\\bnot\\s+(?:a\\s+)?(?:${colours})\\s+${bandWord}\\b`).test(raw);
  const positive = [...raw.matchAll(new RegExp(`\\b(${colours})\\s+(?:colou?red\\s+)?${bandWord}\\b`, 'g'))]
    .map(match => colourName(match[1]));
  const reverse = [...raw.matchAll(new RegExp(`\\b${bandWord}\\s+(?:is\\s+|in\\s+)?(${colours})\\b`, 'g'))]
    .map(match => colourName(match[1]));
  const marks = new Set([...positive, ...reverse]);
  const band: AppearanceFeatures['band'] = hedged || uncertainBand || negatedColour || (none && marks.size > 0) || marks.size > 1
    ? { state: 'unknown', colour: null }
    : none ? { state: 'none_visible', colour: null }
      : marks.size === 1 ? { state: 'present', colour: [...marks][0] }
        : { state: 'unknown', colour: null };
  return { kind, bodyColour: body ? colourName(body[1]) : null, band, grouped };
}

/** Compatibility is about described visual states, never proof of physical identity. */
export function compatibleAppearance(a: AppearanceFeatures, b: AppearanceFeatures): boolean {
  if (a.kind && b.kind && a.kind !== b.kind) return false;
  if (a.bodyColour && b.bodyColour && a.bodyColour !== b.bodyColour) return false;
  if (a.band.state !== 'unknown' && b.band.state !== 'unknown') {
    if (a.band.state !== b.band.state) return false;
    if (a.band.colour && b.band.colour && a.band.colour !== b.band.colour) return false;
  }
  return true;
}

export function distinctiveAppearanceKey(features: AppearanceFeatures): string | null {
  return !features.grouped && features.kind && features.bodyColour && features.band.state === 'present' && features.band.colour
    ? `${features.kind}:${features.bodyColour}:band:${features.band.colour}` : null;
}
