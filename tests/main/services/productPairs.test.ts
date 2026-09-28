import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
const state = vi.hoisted(() => ({ dir: '' }));
vi.mock('../../../src/main/services/paths', () => ({
  getEntityJsonPath: (type: string) => join(state.dir, `${type}.json`),
  getEntityImagesDir: (type: string) => join(state.dir, type),
}));
import {
  addEntity,
  deleteEntity,
  linkProductPairs,
  listEntities,
  moveProducts,
  unlinkProductPair,
  updateEntity,
} from '../../../src/main/services/entityStore';

const pair = {
  primaryId: 'cake',
  secondaryId: 'top',
  primaryPhotos: ['cake.png'],
  secondaryPhotos: ['top.png'],
};
const entries = [
  {
    id: 'cake',
    name: 'Cake',
    referenceImages: ['cake.png'],
    thumbnailUrl: 'cake.png',
    createdAt: '2025-01-01',
  },
  {
    id: 'top',
    name: 'Cake 2',
    referenceImages: ['top.png'],
    thumbnailUrl: 'top.png',
    createdAt: '2025-01-01',
  },
  {
    id: 'cookie',
    name: 'Cookie',
    referenceImages: ['cookie.png'],
    thumbnailUrl: 'cookie.png',
    createdAt: '2025-01-01',
  },
];
const path = () => join(state.dir, 'products.json');
const bytes = () => readFileSync(path(), 'utf8');
beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'product-pairs-'));
  mkdirSync(join(state.dir, 'products'));
  writeFileSync(path(), JSON.stringify({ entities: entries }));
});
afterEach(() => rmSync(state.dir, { recursive: true, force: true }));

describe('approved product pairs', () => {
  it('persists only links, backs up once, and allows idempotent retries and unlink', async () => {
    const original = bytes();
    await linkProductPairs([pair]);
    expect(readFileSync(`${path()}.pre-pairs.bak`, 'utf8')).toBe(original);
    expect(listEntities('products').find((entry) => entry.id === 'top')?.pairedWith).toBe('cake');
    expect(listEntities('products').find((entry) => entry.id === 'cake')?.referenceImages).toEqual([
      'cake.png',
    ]);
    const linked = bytes();
    await linkProductPairs([pair]);
    expect(bytes()).toBe(linked);
    await unlinkProductPair('top');
    expect(
      listEntities('products').find((entry) => entry.id === 'top')?.pairedWith,
    ).toBeUndefined();
    expect(readFileSync(`${path()}.pre-pairs.bak`, 'utf8')).toBe(original);
  });

  it('rejects stale, overlapping and cross-folder requests without partial writes', async () => {
    const original = bytes();
    await expect(
      linkProductPairs([
        pair,
        {
          primaryId: 'cake',
          secondaryId: 'cookie',
          primaryPhotos: ['cake.png'],
          secondaryPhotos: ['cookie.png'],
        },
      ]),
    ).rejects.toThrow();
    await expect(
      linkProductPairs([
        {
          primaryId: 'cake',
          secondaryId: 'cake',
          primaryPhotos: ['cake.png'],
          secondaryPhotos: ['cake.png'],
        },
      ]),
    ).rejects.toThrow();
    expect(bytes()).toBe(original);
    expect(existsSync(`${path()}.pre-pairs.bak`)).toBe(false);
    writeFileSync(
      path(),
      JSON.stringify({
        entities: [entries[0], { ...entries[1], folderId: 'other' }, entries[2]],
        productFolders: [{ id: 'other', name: 'Other', createdAt: '2025-01-01' }],
      }),
    );
    const changed = bytes();
    await expect(linkProductPairs([pair])).rejects.toThrow();
    expect(bytes()).toBe(changed);
  });

  it('rejects approval when the photos changed since the review', async () => {
    const reviewed = { ...pair, primaryPhotos: ['cake.png'], secondaryPhotos: ['top.png'] };
    writeFileSync(
      path(),
      JSON.stringify({
        entities: [
          entries[0],
          {
            ...entries[1],
            referenceImages: ['different-top.png'],
            thumbnailUrl: 'different-top.png',
          },
          entries[2],
        ],
      }),
    );
    const changed = bytes();
    await expect(linkProductPairs([reviewed])).rejects.toThrow('Refresh');
    expect(bytes()).toBe(changed);
  });

  it('refuses to make an existing primary into a secondary, preserving readable metadata', async () => {
    writeFileSync(
      path(),
      JSON.stringify({
        entities: [
          ...entries,
          {
            id: 'top-top',
            name: 'Cake 2 2',
            referenceImages: ['top-top.png'],
            thumbnailUrl: 'top-top.png',
            createdAt: '2025-01-01',
          },
        ],
      }),
    );
    await linkProductPairs([
      {
        primaryId: 'top',
        secondaryId: 'top-top',
        primaryPhotos: ['top.png'],
        secondaryPhotos: ['top-top.png'],
      },
    ]);
    const linked = bytes();
    await expect(linkProductPairs([pair])).rejects.toThrow();
    expect(bytes()).toBe(linked);
    expect(listEntities('products')).toHaveLength(4);
  });

  it('prevents moving half a pair and detaches the surviving entry after deletion', async () => {
    await linkProductPairs([pair]);
    const linked = bytes();
    await expect(moveProducts(['cake'], null)).rejects.toThrow('Move both');
    expect(bytes()).toBe(linked);
    await deleteEntity('products', 'cake');
    expect(
      listEntities('products').find((entry) => entry.id === 'top')?.pairedWith,
    ).toBeUndefined();
  });

  it('keeps original upload names aligned through edits without renaming the stored files', async () => {
    const added = await addEntity('products', 'New', ['local-file:///one.png'], undefined, null, [
      'Cake Front.png',
    ]);
    expect(added.originalFilenames).toEqual(['Cake Front.png']);
    const updated = await updateEntity(
      'products',
      added.id,
      'New',
      ['local-file:///one.png', 'local-file:///two.png'],
      undefined,
      ['Cake Top.png'],
    );
    expect(updated?.originalFilenames).toEqual(['Cake Front.png', 'Cake Top.png']);
    expect(updated?.referenceImages).toEqual(['local-file:///one.png', 'local-file:///two.png']);
    await expect(
      updateEntity('products', added.id, 'New', ['missing.png'], undefined, []),
    ).rejects.toThrow('changed');
  });
});
