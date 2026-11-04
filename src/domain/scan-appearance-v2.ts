import { describeScanAppearance, type ScanAppearanceImage } from './scan-appearance.ts';

/** Retrospective development candidate: preserve frozen v1 colour extraction,
 * omit silhouette because view changes can reverse an otherwise correct colour
 * ranking. Original colour weights .50/.40 are renormalized, not retuned.
 * Appearance resemblance never establishes physical identity. */
export const SCAN_APPEARANCE_V2_VERSION = 'foreground-colour-v2' as const;
export interface ScanAppearanceV2Descriptor {
  version: typeof SCAN_APPEARANCE_V2_VERSION;
  hueSaturation: number[];
  chromaticity: number[];
}

export function describeScanAppearanceV2(image: ScanAppearanceImage): ScanAppearanceV2Descriptor | null {
  const colour = describeScanAppearance(image);
  return colour ? { version: SCAN_APPEARANCE_V2_VERSION,
    hueSaturation: colour.hueSaturation, chromaticity: colour.chromaticity } : null;
}

function affinity(a: number[], b: number[], length: number): number | null {
  if (a.length !== length || b.length !== length || [...a, ...b].some(v => !Number.isFinite(v) || v < 0)) return null;
  const am = a.reduce((s, v) => s + v, 0), bm = b.reduce((s, v) => s + v, 0);
  if (!(am > 0 && bm > 0)) return null;
  return Math.max(0, Math.min(1, a.reduce((s, v, i) => s + Math.sqrt(v * b[i]), 0) / Math.sqrt(am * bm)));
}

export function compareScanAppearanceV2(a: ScanAppearanceV2Descriptor | null,
  b: ScanAppearanceV2Descriptor | null): number | null {
  if (!a || !b || a.version !== SCAN_APPEARANCE_V2_VERSION || b.version !== SCAN_APPEARANCE_V2_VERSION) return null;
  const hue = affinity(a.hueSaturation, b.hueSaturation, 12 * 3 + 4);
  const chroma = affinity(a.chromaticity, b.chromaticity, 8 * 8);
  return hue === null || chroma === null ? null : Math.max(0, Math.min(1, (5 * hue + 4 * chroma) / 9));
}
