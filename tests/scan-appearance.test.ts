import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeScanAppearance, compareScanAppearance, type ScanAppearanceImage, type ScanAppearanceMethod } from '../src/domain/scan-appearance.ts';

const methods: ScanAppearanceMethod[] = ['balanced', 'hue_shape', 'chroma_shape'];
function image(width = 12, height = 10, colour = [40, 80, 160, 255]): ScanAppearanceImage {
  return { width, height, data: Uint8Array.from({ length: width * height * 4 }, (_, i) => colour[i % 4]) };
}
const describe = (pixels: ScanAppearanceImage) => describeScanAppearance(pixels)!;

test('descriptors and all fixed comparisons are deterministic, symmetric and bounded', () => {
  const a = image(), b = image(12, 10, [160, 80, 40, 255]);
  const before = [...a.data], ad = describe(a), bd = describe(b);
  assert.deepEqual(ad, describe(a)); assert.deepEqual([...a.data], before);
  for (const method of methods) {
    assert.ok(Math.abs(compareScanAppearance(ad, ad, method)! - 1) < 1e-12);
    const ab = compareScanAppearance(ad, bd, method)!;
    assert.ok(Number.isFinite(ab) && ab >= 0 && ab <= 1);
    assert.equal(ab, compareScanAppearance(bd, ad, method));
  }
});
test('uniform exposure scaling preserves colour and achromatic appearance', () => {
  for (const colour of [[30, 60, 120, 255], [120, 120, 120, 255], [0, 0, 0, 255]]) {
    const a = describe(image(12, 10, colour)), b = describe(image(12, 10, colour.map((v, i) => i === 3 ? v : v / 2)));
    for (const method of methods) assert.ok(compareScanAppearance(a, b, method)! > .999999);
  }
  const a = image(), b = image();
  for (let i = 0; i < a.data.length; i += 4) {
    const gray = 20 + (i % 120); a.data.set([gray, gray, gray, 255], i); b.data.set([gray / 2, gray / 2, gray / 2, 255], i);
  }
  assert.ok(compareScanAppearance(describe(a), describe(b))! > .999999);
});
test('alpha excludes background RGB and translates foreground without metadata', () => {
  const a = image(12, 10, [255, 0, 0, 0]), b = image(12, 10, [0, 255, 0, 0]);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) {
    a.data.set([40, 80, 160, 255], ((y + 1) * 12 + x + 1) * 4);
    b.data.set([40, 80, 160, 255], ((y + 4) * 12 + x + 6) * 4);
  }
  const ad = describe(a), bd = describe(b);
  assert.deepEqual(ad.hueSaturation, bd.hueSaturation);
  assert.deepEqual(ad.chromaticity, bd.chromaticity);
  assert.ok(Math.abs(ad.silhouette.elongation - bd.silhouette.elongation) < 1e-12);
  assert.ok(compareScanAppearance(ad, bd)! > .999999);
});
test('translucent alpha is weighted and grayscale/black remain finite', () => {
  const a = image(2, 1); a.data.set([160, 80, 40, 64], 4);
  const ad = describe(a);
  assert.ok(ad.chromaticity.every(Number.isFinite));
  assert.ok(Math.abs(ad.chromaticity.reduce((s, v) => s + v, 0) - 1) < 1e-12);
  for (const colour of [[0, 0, 0, 255], [255, 255, 255, 255], [100, 100, 100, 128]]) {
    const descriptor = describe(image(1, 1, colour));
    for (const method of methods) assert.equal(compareScanAppearance(descriptor, descriptor, method), 1);
  }
});
test('silhouette is modest, orientation-independent elongation remains finite', () => {
  const wide = describe(image(12, 3)), tall = describe(image(3, 12));
  assert.deepEqual(wide.silhouette, tall.silhouette);
  assert.ok(compareScanAppearance(wide, describe(image(10, 10)))! >= .9);
});
test('invalid, absent or transparent pixels have no comparable score', () => {
  for (const pixels of [image(2, 2, [1, 2, 3, 0]), image(0, 0), { ...image(), width: 1.5 }, { ...image(), data: new Uint8Array(1) }])
    assert.equal(describeScanAppearance(pixels), null);
  const valid = describe(image());
  assert.equal(compareScanAppearance(null, valid), null);
  assert.equal(compareScanAppearance({ ...valid, hueSaturation: valid.hueSaturation.map(() => NaN) }, valid), null);
  assert.equal(compareScanAppearance({ ...valid, chromaticity: [] }, valid), null);
  assert.equal(compareScanAppearance({ ...valid, silhouette: { fill: 2, elongation: 0 } }, valid), null);
});
test('sampling is deterministic even for extreme aspect ratios', () => {
  for (const pixels of [image(1, 20_000), image(20_000, 1), image(257, 259)]) {
    const descriptor = describe(pixels);
    assert.deepEqual(descriptor, describe(pixels));
    assert.ok(compareScanAppearance(descriptor, descriptor)! > .999999);
  }
});
