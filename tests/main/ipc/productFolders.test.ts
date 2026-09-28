import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
const state = vi.hoisted(() => ({
  dir: '',
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  expose: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('electron', () => ({
  app: { getAppPath: () => '/trusted/app' },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      state.handlers.set(channel, handler),
  },
  contextBridge: { exposeInMainWorld: state.expose },
  ipcRenderer: { invoke: state.invoke },
}));
vi.mock('../../../src/main/services/paths', () => ({
  getEntityJsonPath: (type: string) => join(state.dir, `${type}.json`),
  getEntityImagesDir: (type: string) => join(state.dir, type),
}));
import { registerEntityHandlers } from '../../../src/main/ipc/entities';
import type { ElectronAPI } from '../../../src/preload';
import '../../../src/preload';
const trusted = { senderFrame: { url: 'file:///trusted/app/index.html' } };
const call = async (channel: string, ...args: unknown[]) =>
  state.handlers.get(channel)!(trusted, ...args);
beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'folder-ipc-'));
  mkdirSync(join(state.dir, 'products'));
  mkdirSync(join(state.dir, 'characters'));
  registerEntityHandlers();
});
afterEach(() => rmSync(state.dir, { recursive: true, force: true }));

describe('product folder IPC boundary', () => {
  it('registers all channels through real secureHandle sender validation', async () => {
    for (const channel of [
      'productFolders:list',
      'productFolders:create',
      'productFolders:rename',
      'productFolders:move',
      'entities:create',
      'productPairs:link',
      'productPairs:unlink',
    ]) {
      for (const event of [
        { senderFrame: null },
        { senderFrame: { url: 'https://evil.example' } },
        { senderFrame: { url: 'file:///outside/index.html' } },
      ]) {
        expect(() => state.handlers.get(channel)!(event)).toThrow('IPC:');
      }
    }
    expect(await call('productFolders:list')).toEqual([]);
  });
  it('rejects invalid types and characters before saving files', async () => {
    for (const name of [null, {}, [], 5, '', 'a'.repeat(81)]) {
      await expect(call('productFolders:create', name)).rejects.toThrow();
    }
    for (const data of [
      null,
      {},
      { name: 'N', files: [], folderId: 5 },
      { name: 'N', files: [], folderId: 'missing' },
      { name: 'N', files: [{ name: 'a', buffer: 'bad' }] },
    ]) {
      await expect(call('entities:create', 'products', data)).rejects.toThrow();
    }
    await expect(
      call('entities:create', 'characters', { name: 'N', files: [], folderId: null }),
    ).rejects.toThrow('product-only');
    await expect(call('productFolders:rename', {}, 'name')).rejects.toThrow();
    await expect(call('productFolders:move', 'p1', null)).rejects.toThrow();
    await expect(call('productFolders:move', ['p1'], {})).rejects.toThrow();
    expect(readdirSync(join(state.dir, 'products'))).toEqual([]);
    expect(readdirSync(join(state.dir, 'characters'))).toEqual([]);
  });
  it('supports create in folder, rename, move and stale entity updates', async () => {
    const folder = (await call('productFolders:create', 'Catalog')) as { id: string };
    const product = (await call('entities:create', 'products', {
      name: 'Product',
      files: [{ name: 'a.png', buffer: new Uint8Array([1, 2]) }],
      folderId: folder.id,
    })) as { id: string; folderId: string; referenceImages: string[] };
    expect(product.folderId).toBe(folder.id);
    expect(await call('productFolders:move', [product.id], null)).toBeUndefined();
    const updated = await call('entities:update', 'products', product.id, {
      name: 'Edited',
      existingImages: product.referenceImages,
      newFiles: [],
      folderId: folder.id,
    });
    expect(updated).toMatchObject({ folderId: null, referenceImages: product.referenceImages });
    expect(await call('productFolders:rename', folder.id, ' New ')).toMatchObject({ name: 'New' });
    expect(readdirSync(join(state.dir, 'products'))).toHaveLength(1);
  });
  it('retains original upload names and validates approved pairs at the trusted IPC boundary', async () => {
    const front = (await call('entities:create', 'products', {
      name: 'Cake',
      files: [{ name: 'cake.png', buffer: new Uint8Array([1]) }],
    })) as { id: string; referenceImages: string[]; originalFilenames: string[] };
    const top = (await call('entities:create', 'products', {
      name: 'Cake 2',
      files: [{ name: 'cake.png', buffer: new Uint8Array([2]) }],
    })) as { id: string; referenceImages: string[]; originalFilenames: string[] };
    expect(front.referenceImages[0]).not.toBe(top.referenceImages[0]);
    expect(top.originalFilenames).toEqual(['cake.png']);
    const edited = await call('entities:update', 'products', top.id, {
      name: 'Cake 2',
      existingImages: top.referenceImages,
      newFiles: [{ name: 'new top.png', buffer: new Uint8Array([3]) }],
    });
    expect(edited).toMatchObject({ originalFilenames: ['cake.png', 'new top.png'] });
    await expect(
      call('productPairs:link', [
        {
          primaryId: front.id,
          secondaryId: 'missing',
          primaryPhotos: front.referenceImages,
          secondaryPhotos: [],
        },
      ]),
    ).rejects.toThrow();
    await call('productPairs:link', [
      {
        primaryId: front.id,
        secondaryId: top.id,
        primaryPhotos: front.referenceImages,
        secondaryPhotos: (edited as { referenceImages: string[] }).referenceImages,
      },
    ]);
    expect(await call('entities:list', 'products')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: top.id, pairedWith: front.id })]),
    );
    await call('productPairs:unlink', top.id);
    expect(await call('entities:list', 'products')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: top.id, originalFilenames: ['cake.png', 'new top.png'] }),
      ]),
    );
  });

  it('exposes the typed preload API and forwards the exact contract', async () => {
    const api = state.expose.mock.calls.find(([name]) => name === 'api')![1] as ElectronAPI;
    expect(Object.keys(api.productFolders)).toEqual(['list', 'create', 'rename', 'move']);
    await api.productFolders.list();
    await api.productFolders.create('Name');
    await api.productFolders.rename('f1', 'Renamed');
    await api.productFolders.move(['p1'], null);
    const data = { name: 'P', files: [], folderId: 'f1' };
    await api.entities.create('products', data);
    expect(state.invoke.mock.calls.slice(-5)).toEqual([
      ['productFolders:list'],
      ['productFolders:create', 'Name'],
      ['productFolders:rename', 'f1', 'Renamed'],
      ['productFolders:move', ['p1'], null],
      ['entities:create', 'products', data],
    ]);
  });
});
