import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeScanAppearance, compareScanAppearance, type ScanAppearanceImage } from '../src/domain/scan-appearance.ts';
import { describeScanAppearanceV2, compareScanAppearanceV2 } from '../src/domain/scan-appearance-v2.ts';

function image(width = 12, height = 10, colour = [40, 80, 160, 255]): ScanAppearanceImage {
  return { width, height, data: Uint8Array.from({ length: width * height * 4 }, (_, i) => colour[i % 4]) };
}
const describe = (pixels: ScanAppearanceImage) => describeScanAppearanceV2(pixels)!;

test('v2 keeps frozen colour extraction and deterministic bounded symmetric similarity', () => {
  const a = image(), b = image(12, 10, [160, 80, 40, 255]), before = [...a.data];
  const ad = describe(a), bd = describe(b), v1 = describeScanAppearance(a)!;
  assert.deepEqual(ad.hueSaturation, v1.hueSaturation);
  assert.deepEqual(ad.chromaticity, v1.chromaticity);
  assert.deepEqual(ad, describe(a)); assert.deepEqual([...a.data], before);
  assert.ok(Math.abs(compareScanAppearanceV2(ad, ad)! - 1) < 1e-12);
  const ab = compareScanAppearanceV2(ad, bd)!;
  assert.ok(Number.isFinite(ab) && ab >= 0 && ab <= 1);
  assert.ok(ab < compareScanAppearanceV2(ad, ad)!);
  assert.equal(ab, compareScanAppearanceV2(bd, ad));
});

test('same foreground colour is not penalized for viewpoint-like silhouette changes', () => {
  const wide = image(24, 3), square = image(10, 10), tall = image(3, 24);
  assert.ok(compareScanAppearance(describeScanAppearance(wide), describeScanAppearance(square))! < .95);
  for (const other of [square, tall])
    assert.ok(compareScanAppearanceV2(describe(wide), describe(other))! > .999999);
});

test('transparent RGB and foreground translation do not affect ranking; alpha weights colours', () => {
  const a = image(12, 10, [255, 0, 0, 0]), b = image(12, 10, [0, 255, 0, 0]);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) {
    a.data.set([40, 80, 160, 255], ((y + 1) * 12 + x + 1) * 4);
    b.data.set([40, 80, 160, 255], ((y + 4) * 12 + x + 6) * 4);
  }
  assert.deepEqual(describe(a), describe(b));
  const mixed = image(2, 1); mixed.data.set([160, 80, 40, 64], 4);
  const blue = describe(image()), orange = describe(image(12, 10, [160, 80, 40, 255]));
  assert.ok(compareScanAppearanceV2(describe(mixed), blue)! > compareScanAppearanceV2(describe(mixed), orange)!);
});

test('removing shape preserves v1 exposure-scale invariance, including grayscale and black', () => {
  for (const colour of [[30, 60, 120, 255], [120, 120, 120, 255], [0, 0, 0, 255]]) {
    const scaled = colour.map((v, i) => i === 3 ? v : v / 2);
    assert.ok(compareScanAppearanceV2(describe(image(12, 10, colour)), describe(image(12, 10, scaled)))! > .999999);
  }
});

test('absent, malformed, transparent and incompatible descriptors have no score', () => {
  for (const pixels of [image(2, 2, [1, 2, 3, 0]), image(0, 0), { ...image(), width: 1.5 }, { ...image(), data: new Uint8Array(1) }])
    assert.equal(describeScanAppearanceV2(pixels), null);
  const valid = describe(image());
  assert.equal(compareScanAppearanceV2(null, valid), null);
  assert.equal(compareScanAppearanceV2({ ...valid, hueSaturation: valid.hueSaturation.map(() => NaN) }, valid), null);
  assert.equal(compareScanAppearanceV2({ ...valid, chromaticity: [] }, valid), null);
  assert.equal(compareScanAppearanceV2({ ...valid, chromaticity: valid.chromaticity.map(() => 0) }, valid), null);
  assert.equal(compareScanAppearanceV2({ ...valid, hueSaturation: valid.hueSaturation.map(() => -1) }, valid), null);
  assert.equal(compareScanAppearanceV2({ ...valid, version: 'other' as typeof valid.version }, valid), null);
});
