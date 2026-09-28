import { describe, expect, it } from 'vitest';
import { collectProductReferences } from '../../../src/renderer/src/lib/productReferences';
import { buildAngleShots, ELEVATED_45_CAMERA } from '../../../src/renderer/src/lib/productAngles';
import { COMPOSITION_CAMERAS } from '../../../src/renderer/src/lib/compositionPrompt';
import type { EntityData } from '../../../src/renderer/src/types/electron';

function product(id: string, name: string, referenceImages: string[]): EntityData {
  return { id, name, referenceImages, thumbnailUrl: null, createdAt: '2026-01-01' };
}

describe('explicit product reference selection', () => {
  it('combines all angles from exactly the ticked entries, not similarly named neighbours', () => {
    const products = [
      product('a', 'cake', ['front.png']),
      product('b', 'cake 2', ['side.png']),
      product('c', 'cake too', ['other.png']),
    ];
    expect(collectProductReferences(products, ['a'])).toEqual(['front.png']);
    expect(collectProductReferences(products, ['a', 'b'])).toEqual(['front.png', 'side.png']);
    expect(products[0]?.referenceImages).toEqual(['front.png']);
  });
  it('deduplicates shared photos without dropping additional views or changing selection order', () => {
    const products = [
      product('a', 'A', ['common.png', 'front.png']),
      product('b', 'B', ['side.png', 'common.png']),
    ];
    expect(collectProductReferences(products, ['b', 'a'])).toEqual([
      'side.png',
      'common.png',
      'front.png',
    ]);
  });
  it('rejects unavailable or empty entries instead of silently generating from the remainder', () => {
    const products = [product('a', 'A', ['front.png']), product('b', 'Empty', [])];
    expect(() => collectProductReferences(products, ['a', 'missing'])).toThrow('unavailable');
    expect(() => collectProductReferences(products, ['a', 'b'])).toThrow('no reference photos');
  });
  it('does not silently truncate reference overflow; submit preflight decides the cap', () => {
    const urls = Array.from({ length: 9 }, (_, i) => `${i}.png`);
    expect(collectProductReferences([product('a', 'A', urls)], ['a'])).toEqual(urls);
    expect(collectProductReferences([], [])).toEqual([]);
  });
  it('uses the same explicit camera elevation with and without a composition', () => {
    expect(COMPOSITION_CAMERAS['elevated-45']).toBe(ELEVATED_45_CAMERA);
    expect(ELEVATED_45_CAMERA).toContain('above the tabletop plane');
    expect(ELEVATED_45_CAMERA).toContain(
      'Product reference photos define identity, not camera elevation',
    );
    expect(buildAngleShots('Cake')[1]?.prompt).toContain(ELEVATED_45_CAMERA);
    expect(buildAngleShots('Cake')[0]?.prompt).not.toContain(ELEVATED_45_CAMERA);
  });
});
