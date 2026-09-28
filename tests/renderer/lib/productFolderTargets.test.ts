import { describe, expect, it } from 'vitest';
import {
  ALL_PRODUCTS_VALUE,
  UNFILED_PRODUCTS_VALUE,
  isProductBatch,
  snapshotProductFolderTargets as snapshot,
} from '../../../src/renderer/src/lib/productFolderTargets';
import { buildGenerationJobs } from '../../../src/renderer/src/lib/generationJobs';
import type { EntityData } from '../../../src/renderer/src/types/electron';
import type { ProductFolder } from '../../../src/shared/productFolders';

const folders: ProductFolder[] = [
  { id: 'a', name: 'Same name', createdAt: '2026-01-01' },
  { id: 'b', name: 'Same name', createdAt: '2026-01-01' },
];
function product(
  id: string,
  folderId?: string | null,
  referenceImages = [`${id}.png`],
): EntityData {
  return {
    id,
    name: 'Same name',
    folderId,
    referenceImages,
    thumbnailUrl: null,
    createdAt: '2026-01-01',
  };
}

describe('product folder targets', () => {
  it('isolates folder membership by ID even when names match products and other folders', () => {
    const result = snapshot(
      'folder:a',
      [product('1', 'a'), product('2', 'b'), product('3')],
      folders,
      false,
    );
    expect(result.scope).toBe('Folder: Same name');
    expect(result.targets.map((target) => target.key)).toEqual(['1']);
    expect(
      snapshot('folder:a', [product('1', 'a')], [{ ...folders[0]!, name: 'Renamed' }], false).scope,
    ).toBe('Folder: Renamed');
  });

  it('includes only absent/null memberships in Unfiled, not orphaned folder IDs', () => {
    const result = snapshot(
      UNFILED_PRODUCTS_VALUE,
      [product('1'), product('2', null), product('3', 'deleted')],
      folders,
      false,
    );
    expect(result.targets.map((target) => target.key)).toEqual(['1', '2']);
  });

  it('blocks deleted/unknown folders even if products still reference them; never falls back to All', () => {
    expect(() => snapshot('folder:deleted', [product('1', 'deleted')], folders, false)).toThrow(
      'unavailable or deleted',
    );
    expect(() => snapshot('product:1', [product('1')], folders, false)).toThrow('unavailable');
  });

  it('distinguishes an empty scope from members without photos', () => {
    expect(() => snapshot('folder:a', [product('1', 'b')], folders, false)).toThrow('is empty');
    expect(() => snapshot('folder:a', [product('1', 'a', [])], folders, false)).toThrow(
      'reference photos',
    );
    expect(() => snapshot(UNFILED_PRODUCTS_VALUE, [], folders, true)).toThrow('is empty');
  });

  it('retains all invalid references for composition preflight, but preserves no-template filtering/capping', () => {
    const products = [product('1', 'a', []), product('2', 'a', Array(9).fill('photo'))];
    const composition = snapshot('folder:a', products, folders, true);
    expect(composition.targets.map((target) => target.referenceImages.length)).toEqual([0, 9]);
    const plain = snapshot('folder:a', products, folders, false);
    expect(plain.targets.map((target) => target.key)).toEqual(['2']);
    expect(plain.targets[0]!.referenceImages).toHaveLength(8);
  });

  it('does not mutate input and snapshots target photos/names independently of later changes', () => {
    const products = [product('1', 'a')];
    const before = structuredClone(products);
    const result = snapshot('folder:a', products, folders, true);
    expect(products).toEqual(before);
    products[0]!.referenceImages.push('later.png');
    products[0]!.name = 'Changed';
    products[0]!.folderId = 'b';
    expect(result.targets[0]).toEqual({ key: '1', label: 'Same name', referenceImages: ['1.png'] });
    result.targets[0]!.referenceImages.push('snapshot-only.png');
    expect(products[0]!.referenceImages).not.toContain('snapshot-only.png');
  });

  it('supports more than 20 members with a minimum count of one per product', () => {
    const products = Array.from({ length: 25 }, (_, index) => product(String(index), 'a'));
    const { targets } = snapshot('folder:a', products, folders, false);
    expect(targets).toHaveLength(25);
    expect(
      buildGenerationJobs({ targets, count: 1, basePrompt: 'Scene', idPrefix: 'test' }),
    ).toHaveLength(25);
  });

  it('generates one set per explicitly linked pair and preserves single-photo products', () => {
    const products = [
      product('cake', undefined, ['front.png']),
      { ...product('top', undefined, ['top.png']), pairedWith: 'cake' },
      product('cookie', undefined, ['cookie.png']),
    ];
    const { targets } = snapshot(ALL_PRODUCTS_VALUE, products, [], true);
    expect(targets).toEqual([
      { key: 'cake', label: 'Same name', referenceImages: ['front.png', 'top.png'] },
      { key: 'cookie', label: 'Same name', referenceImages: ['cookie.png'] },
    ]);
    expect(
      buildGenerationJobs({ targets, count: 2, basePrompt: 'Scene', idPrefix: 'test' }),
    ).toHaveLength(4);
  });

  it('blocks stale links or an oversized linked group before any jobs are built', () => {
    expect(() =>
      snapshot(ALL_PRODUCTS_VALUE, [{ ...product('orphan'), pairedWith: 'missing' }], [], true),
    ).toThrow('pairing changed');
    const products = [
      product(
        'cake',
        undefined,
        Array.from({ length: 7 }, (_, i) => `front-${i}`),
      ),
      { ...product('top', undefined, ['top.png']), pairedWith: 'cake' },
    ];
    expect(() => snapshot(ALL_PRODUCTS_VALUE, products, [], true)).toThrow('at most 7');
    expect(
      snapshot(ALL_PRODUCTS_VALUE, products, [], false).targets[0]?.referenceImages,
    ).toHaveLength(8);
  });

  it('keeps All products across every folder and Unfiled, independently of folder list availability', () => {
    const products = [product('1', 'a'), product('2', 'b'), product('3'), product('4', null, [])];
    expect(
      snapshot(ALL_PRODUCTS_VALUE, products, [], false).targets.map((target) => target.key),
    ).toEqual(['1', '2', '3']);
    expect(snapshot(ALL_PRODUCTS_VALUE, products, [], true).targets).toHaveLength(4);
    expect(isProductBatch(ALL_PRODUCTS_VALUE)).toBe(true);
    expect(isProductBatch('folder:deleted')).toBe(true);
    expect(isProductBatch('product:1')).toBe(false);
    expect(isProductBatch('character:1')).toBe(false);
    expect(isProductBatch('none')).toBe(false);
  });
});
