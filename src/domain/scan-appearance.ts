/** Fixed pixel-only ranking experiment. Scores express appearance resemblance,
 * never physical identity or a calibrated probability. No metadata is accepted. */
export const SCAN_APPEARANCE_VERSION = 'foreground-colour-shape-v1' as const;
export type ScanAppearanceMethod = 'balanced' | 'hue_shape' | 'chroma_shape';
export interface ScanAppearanceImage { width: number; height: number; data: Uint8Array | Uint8ClampedArray }
export interface ScanAppearanceDescriptor {
  version: typeof SCAN_APPEARANCE_VERSION;
  hueSaturation: number[];
  chromaticity: number[];
  silhouette: { elongation: number; fill: number };
}
const HUES = 12, SATURATIONS = 3, CHROMA = 8, SAMPLE_SIDE = 128;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
function normalize(values: number[]) {
  const total = values.reduce((a, b) => a + b, 0);
  return values.map(v => total > 0 ? v / total : 0);
}
function linearBin(values: number[], value: number, bins: number, weight: number, offset = 0) {
  const p = clamp(value) * (bins - 1), lo = Math.floor(p), fraction = p - lo;
  values[offset + lo] += weight * (1 - fraction);
  values[offset + Math.min(lo + 1, bins - 1)] += weight * fraction;
}
/** At most 16,384 regularly spaced samples. Alpha supplies foreground weight;
 * transparent RGB is ignored. Achromatic brightness is relative to foreground
 * mean, preserving uniform exposure-scale invariance without division by zero.
 * Shape has deliberately little influence because viewpoint changes silhouettes. */
export function describeScanAppearance(image: ScanAppearanceImage): ScanAppearanceDescriptor | null {
  const { width, height, data } = image;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(width * height * 4) || data.length !== width * height * 4) return null;
  const strideX = Math.max(1, Math.ceil(width / SAMPLE_SIDE)), strideY = Math.max(1, Math.ceil(height / SAMPLE_SIDE));
  const hueSaturation = Array<number>(HUES * SATURATIONS + 4).fill(0);
  const chromaticity = Array<number>(CHROMA * CHROMA).fill(0);
  let mass = 0, brightness = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y += strideY) for (let x = 0; x < width; x += strideX) {
    const i = (y * width + x) * 4, weight = data[i + 3] / 255;
    if (!weight) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    mass += weight; brightness += weight * Math.max(r, g, b);
    sx += weight * x; sy += weight * y; sxx += weight * x * x; syy += weight * y * y; sxy += weight * x * y;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (!mass) return null;
  const meanBrightness = brightness / mass;
  for (let y = 0; y < height; y += strideY) for (let x = 0; x < width; x += strideX) {
    const i = (y * width + x) * 4, weight = data[i + 3] / 255;
    if (!weight) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    const saturation = max > 0 ? delta / max : 0;
    // Soft circular hue and linear saturation bins avoid hard quantization edges.
    if (delta > 0) {
      let hue = (max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta) / 6;
      hue = ((hue % 1) + 1) % 1;
      const h = hue * HUES, lo = Math.floor(h), fraction = h - lo;
      linearBin(hueSaturation, saturation, SATURATIONS, weight * saturation * (1 - fraction), lo * SATURATIONS);
      linearBin(hueSaturation, saturation, SATURATIONS, weight * saturation * fraction, ((lo + 1) % HUES) * SATURATIONS);
    }
    linearBin(hueSaturation, meanBrightness > 0 ? max / meanBrightness / 2 : .5, 4, weight * (1 - saturation), HUES * SATURATIONS);
    const sum = r + g + b;
    // Black has undefined chromaticity: retain a neutral finite bin rather than
    // manufacturing a dominant red/green colour from a zero denominator.
    const cr = (sum > 0 ? r / sum : 1 / 3) * (CHROMA - 1);
    const cg = (sum > 0 ? g / sum : 1 / 3) * (CHROMA - 1);
    const rl = Math.floor(cr), gl = Math.floor(cg), rf = cr - rl, gf = cg - gl;
    for (const [dx, wx] of [[0, 1 - rf], [1, rf]]) for (const [dy, wy] of [[0, 1 - gf], [1, gf]])
      chromaticity[Math.min(CHROMA - 1, rl + dx) * CHROMA + Math.min(CHROMA - 1, gl + dy)] += weight * wx * wy;
  }
  const vx = Math.max(0, sxx / mass - (sx / mass) ** 2), vy = Math.max(0, syy / mass - (sy / mass) ** 2);
  const covariance = sxy / mass - sx * sy / mass ** 2;
  const trace = vx + vy, spread = Math.sqrt((vx - vy) ** 2 + 4 * covariance ** 2);
  const elongation = trace > 0 ? clamp(spread / trace) : 0;
  const columns = Math.floor((right - left) / strideX) + 1, rows = Math.floor((bottom - top) / strideY) + 1;
  return { version: SCAN_APPEARANCE_VERSION, hueSaturation: normalize(hueSaturation), chromaticity: normalize(chromaticity),
    silhouette: { elongation, fill: clamp(mass / (columns * rows)) } };
}
function affinity(a: number[], b: number[], length: number): number | null {
  if (a.length !== length || b.length !== length || [...a, ...b].some(v => !Number.isFinite(v) || v < 0)) return null;
  const am = a.reduce((s, v) => s + v, 0), bm = b.reduce((s, v) => s + v, 0);
  if (!(am > 0 && bm > 0)) return null;
  return clamp(a.reduce((s, v, i) => s + Math.sqrt(v * b[i]), 0) / Math.sqrt(am * bm));
}
export function compareScanAppearance(a: ScanAppearanceDescriptor | null, b: ScanAppearanceDescriptor | null,
  method: ScanAppearanceMethod = 'balanced'): number | null {
  if (!a || !b || a.version !== SCAN_APPEARANCE_VERSION || b.version !== SCAN_APPEARANCE_VERSION) return null;
  const hue = affinity(a.hueSaturation, b.hueSaturation, HUES * SATURATIONS + 4);
  const chroma = affinity(a.chromaticity, b.chromaticity, CHROMA * CHROMA);
  if (hue === null || chroma === null || [a.silhouette.elongation, a.silhouette.fill, b.silhouette.elongation, b.silhouette.fill]
    .some(v => !Number.isFinite(v) || v < 0 || v > 1)) return null;
  const shape = Math.exp(-2 * Math.abs(a.silhouette.elongation - b.silhouette.elongation) - Math.abs(a.silhouette.fill - b.silhouette.fill));
  if (method === 'hue_shape') return clamp(.85 * hue + .15 * shape);
  if (method === 'chroma_shape') return clamp(.85 * chroma + .15 * shape);
  if (method !== 'balanced') return null;
  return clamp(.50 * hue + .40 * chroma + .10 * shape);
}
