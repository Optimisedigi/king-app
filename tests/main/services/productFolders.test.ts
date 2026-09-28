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
  updateEntity,
  listEntities,
  listProductFolders,
  createProductFolder,
  renameProductFolder,
  moveProducts,
} from '../../../src/main/services/entityStore';

const legacy = {
  settings: { custom: 'preserve' },
  entities: [
    {
      id: 'p1',
      name: 'Shoe',
      referenceImages: ['local-file:///entities/products/photo.png'],
      thumbnailUrl: 'local-file:///entities/products/photo.png',
      createdAt: '2025-01-01',
      productType: 'shoe',
      extra: { keep: true },
    },
    { id: 'p2', name: 'Bag', referenceImages: [], thumbnailUrl: null, createdAt: '2025-01-02' },
  ],
};
const path = () => join(state.dir, 'products.json');
const bytes = () => readFileSync(path(), 'utf8');
const disk = () => JSON.parse(bytes());
beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'folders-'));
  writeFileSync(path(), JSON.stringify(legacy));
  writeFileSync(join(state.dir, 'characters.json'), JSON.stringify(legacy));
  mkdirSync(join(state.dir, 'products'));
  writeFileSync(join(state.dir, 'products/photo.png'), 'image bytes');
});
afterEach(() => rmSync(state.dir, { recursive: true, force: true }));

describe('product folders filesystem contract', () => {
  it('reads legacy without migrations; backs up once and preserves all fields and images', async () => {
    const original = bytes();
    expect(listProductFolders()).toEqual([]);
    expect(listEntities('products')).toHaveLength(2);
    expect(bytes()).toBe(original);
    expect(existsSync(`${path()}.pre-folders.bak`)).toBe(false);
    const folder = await createProductFolder('  Catalog  ');
    expect(folder.name).toBe('Catalog');
    expect(readFileSync(`${path()}.pre-folders.bak`, 'utf8')).toBe(original);
    await moveProducts(['p1', 'p2'], folder.id);
    await renameProductFolder(folder.id, 'New name');
    await moveProducts(['p2'], null);
    expect(disk().settings).toEqual(legacy.settings);
    expect(disk().entities[0]).toEqual({ ...legacy.entities[0], folderId: folder.id });
    expect(disk().entities[1].folderId).toBeNull();
    expect(readFileSync(join(state.dir, 'products/photo.png'), 'utf8')).toBe('image bytes');
    expect(readFileSync(join(state.dir, 'characters.json'), 'utf8')).toBe(original);
    expect(readFileSync(`${path()}.pre-folders.bak`, 'utf8')).toBe(original);
  });
  it('creates inside folders and rejects character assignments and unknown folders', async () => {
    const folder = await createProductFolder('Catalog');
    expect((await addEntity('products', 'New', [], 'bag', folder.id)).folderId).toBe(folder.id);
    expect((await addEntity('products', 'Unfiled', [], undefined, null)).folderId).toBeNull();
    await expect(addEntity('products', 'Bad', [], undefined, 'missing')).rejects.toThrow();
    await expect(addEntity('characters', 'Bad', [], undefined, folder.id)).rejects.toThrow(
      'product-only',
    );
    await expect(addEntity('characters', 'Bad', [], undefined, null)).rejects.toThrow(
      'product-only',
    );
  });
  it('trims names, rejects duplicates and allows case-only rename', async () => {
    const folder = await createProductFolder('Catalog');
    await expect(createProductFolder(' cATALOG ')).rejects.toThrow('already exists');
    const other = await createProductFolder('Other');
    await expect(renameProductFolder(other.id, 'CATALOG')).rejects.toThrow('already exists');
    expect((await renameProductFolder(folder.id, ' CATALOG ')).name).toBe('CATALOG');
    await expect(renameProductFolder('missing', 'Name')).rejects.toThrow('not found');
    for (const name of ['', ' ', 'a'.repeat(81), null, 1, {}]) {
      await expect(createProductFolder(name as string)).rejects.toThrow();
    }
    expect((await createProductFolder('a'.repeat(80))).name).toHaveLength(80);
  });
  it('rejects invalid/unknown/duplicate ids with no partial writes', async () => {
    const folder = await createProductFolder('Catalog');
    const original = bytes();
    for (const [ids, target] of [
      [['p1', 'missing'], folder.id],
      [['p1'], 'missing'],
      [['p1', 'p1'], folder.id],
      [[], null],
      [Array.from({ length: 1001 }, (_, i) => String(i)), null],
      [[42], null],
      [['p1'], undefined],
      [null, null],
    ]) {
      await expect(moveProducts(ids as string[], target as string | null)).rejects.toThrow();
      expect(bytes()).toBe(original);
    }
  });
  it('serializes folder/entity writes and stale edits preserve the latest move', async () => {
    const folder = await createProductFolder('Catalog');
    await Promise.all([
      moveProducts(['p1'], folder.id),
      updateEntity('products', 'p1', 'Edited', legacy.entities[0]!.referenceImages),
      createProductFolder('Other'),
      addEntity('products', 'New', [], undefined, folder.id),
      renameProductFolder(folder.id, 'Renamed'),
    ]);
    expect(disk().entities).toHaveLength(3);
    expect(disk().entities[0]).toMatchObject({
      name: 'Edited',
      folderId: folder.id,
      extra: { keep: true },
    });
    expect(listProductFolders()).toHaveLength(2);
    const results = await Promise.allSettled([
      createProductFolder('Duplicate'),
      createProductFolder('duplicate'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });
  it.each([
    '{broken',
    'null',
    '{}',
    '{"entities":{}}',
    '{"entities":[{}]}',
    '{"entities":[],"productFolders":null}',
    JSON.stringify({ ...legacy, entities: [legacy.entities[0], legacy.entities[0]] }),
    JSON.stringify({ ...legacy, productFolders: [{ id: 'f', name: '', createdAt: 'now' }] }),
  ])('refuses malformed data unchanged: %s', async (content) => {
    writeFileSync(path(), content);
    expect(() => listProductFolders()).toThrow();
    await expect(createProductFolder('No')).rejects.toThrow();
    await expect(addEntity('products', 'No', [])).rejects.toThrow();
    await expect(updateEntity('products', 'p1', 'No', [])).rejects.toThrow();
    await expect(moveProducts(['p1'], null)).rejects.toThrow();
    expect(bytes()).toBe(content);
    expect(existsSync(`${path()}.pre-folders.bak`)).toBe(false);
  });
  it('treats missing products file as empty, and never overwrites an existing backup', async () => {
    rmSync(path());
    expect(listProductFolders()).toEqual([]);
    expect(listEntities('products')).toEqual([]);
    writeFileSync(path(), JSON.stringify(legacy));
    writeFileSync(`${path()}.pre-folders.bak`, 'prior backup');
    await createProductFolder('Catalog');
    expect(readFileSync(`${path()}.pre-folders.bak`, 'utf8')).toBe('prior backup');
  });
});
