import type { Observations } from './contracts.ts';
import type { AppearanceFeatures } from './appearance-features.ts';

type Observation = Observations['objects'][number];
const plural = /\b(toolboxes|cases|boxes|bins|trays|robots|drills|sensors|wrenches|screwdrivers|lids|pieces|components|parts|tools|items|objects|containers|supplies|equipment|hardware)\b/;
const colours = /\b(blue|red|orange|yellow|green|teal|black|white|gray|grey|brown)\b/g;
function head(text: string) {
  return text.toLowerCase().replace(/[-–]/g, ' ').split(/\b(?:with|containing|contains|holding|filled|for|near|beside|behind|under|on|in|at)\b/)[0];
}
function groupedHead(text: string): boolean {
  const value = head(text);
  if (/\b(pair of|set of|group of)\b/.test(value)) return true;
  // A box of tools is an individual container; tools are its contents.
  if (/\b(case|toolbox|box|bin|tray|bag)\b.*\bof\b/.test(value)) return false;
  // In natural compounds the head noun matters: parts tray is one tray,
  // while robot parts describes an aggregate.
  const nouns=[...value.matchAll(/\b(toolboxes|cases|boxes|bins|trays|robots|drills|sensors|wrenches|screwdrivers|lids|pieces|components|parts|tools|items|objects|containers|supplies|equipment|hardware|case|toolbox|box|bin|tray|robot|drill|sensor|wrench|screwdriver|lid|piece|component|part|tool|item|object|container)\b/g)];
  return nouns.length>0&&plural.test(nouns.at(-1)![0]);
}
export function isGroupObservation(object: Observation): boolean {
  return groupedHead(object.label) || groupedHead(object.appearance);
}

/** Aggregate coverage can preserve uncertainty, but never supplies an individual
 * identity. A generic unknown group is context, not a wildcard identity veto. */
export function groupMayCoverIndividual(group: Observation, features: AppearanceFeatures, individual: AppearanceFeatures): boolean {
  const description = `${head(group.label)}. ${head(group.appearance)}`;
  const reportedColours = new Set([...description.matchAll(colours)].map(m => m[1] === 'grey' ? 'gray' : m[1]));
  const bodyColour = reportedColours.size === 1 ? [...reportedColours][0] : null;
  if (bodyColour && individual.bodyColour && bodyColour !== individual.bodyColour) return false;
  if (features.kind && individual.kind) {
    // Aggregate 'boxes' and 'cases' can be alternate descriptions of tool cases.
    // Coverage is weaker than identity; keep that alias ambiguous.
    return features.kind === individual.kind || (['box','case'].includes(features.kind) && ['box','case'].includes(individual.kind));
  }
  const kind = individual.kind;
  if (!kind) return false;
  if (/\btools\b/.test(description)) return ['multimeter','screwdriver','drill','wrench'].includes(kind);
  if (/\bcontainers\b/.test(description)) return ['case','box','bin','tray'].includes(kind);
  if (/\b(parts|components)\b/.test(description)) return kind === 'sensor';
  return false;
}
