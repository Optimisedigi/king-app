import { describe, expect, it } from 'vitest';
import { suggestProductPairs } from '../../../src/renderer/src/lib/productPairs';
import type { EntityData } from '../../../src/renderer/src/types/electron';

function product(id: string, name: string, folderId: string | null = null): EntityData {
  return {
    id,
    name,
    folderId,
    referenceImages: [`${id}.png`],
    thumbnailUrl: `${id}.png`,
    createdAt: '2026-01-01',
  };
}

describe('product pairing suggestions', () => {
  it('suggests exact base name + 2 in the same folder, without linking anything', () => {
    const entries = [
      product('cake', 'White Chocolate Cake'),
      product('top', 'White Chocolate Cake 2'),
      product('single', 'Cookie'),
    ];
    const suggestions = suggestProductPairs(entries);
    expect(suggestions).toEqual([
      {
        primaryId: 'cake',
        secondaryId: 'top',
        primaryPhotos: ['cake.png'],
        secondaryPhotos: ['top.png'],
      },
    ]);
    entries[1]!.referenceImages.push('changed.png');
    expect(suggestions[0]?.secondaryPhotos).toEqual(['top.png']);
    expect(entries[1]!.pairedWith).toBeUndefined();
  });

  it('never suggests turning the primary of a linked pair into a secondary', () => {
    const products = [
      product('cake', 'Cake'),
      product('top', 'Cake 2'),
      { ...product('top-top', 'Cake 2 2'), pairedWith: 'top' },
    ];
    expect(suggestProductPairs(products)).toEqual([]);
  });

  it('skips other folders, missing photos, existing links, and ambiguous chains', () => {
    const pairs = [
      product('a', 'Cake', 'one'),
      product('b', 'Cake 2', 'two'),
      { ...product('c', 'Pie'), referenceImages: [] },
      product('d', 'Pie 2'),
      { ...product('e', 'Already 2'), pairedWith: 'f' },
      product('f', 'Already'),
      product('g', 'Tart'),
      product('h', 'Tart 2'),
      product('i', 'Tart 2 2'),
    ];
    expect(suggestProductPairs(pairs)).toEqual([
      { primaryId: 'g', secondaryId: 'h', primaryPhotos: ['g.png'], secondaryPhotos: ['h.png'] },
    ]);
  });
});
