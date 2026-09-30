import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  exportDir: '',
  sourceDir: '',
}));
vi.mock('electron', () => ({
  app: { getAppPath: () => '/trusted/app', getPath: () => state.exportDir },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      state.handlers.set(channel, handler),
  },
  BrowserWindow: { getFocusedWindow: () => ({}) },
  dialog: { showOpenDialog: async () => ({ filePaths: [state.exportDir] }) },
}));
vi.mock('electron-log/main', () => ({ default: { error: vi.fn() } }));
vi.mock('../../../src/main/services/paths', () => ({
  resolveLocalFileUrl: (url: string) =>
    url.startsWith('local-file:///')
      ? join(state.sourceDir, url.slice('local-file:///'.length))
      : null,
}));

import { registerFileHandlers } from '../../../src/main/ipc/files';

const trusted = { senderFrame: { url: 'file:///trusted/app/index.html' } };
const exportBatch = (items: unknown) => state.handlers.get('files:exportBatch')?.(trusted, items);

beforeEach(async () => {
  state.handlers.clear();
  state.exportDir = await mkdtemp(join(tmpdir(), 'export-dest-'));
  state.sourceDir = await mkdtemp(join(tmpdir(), 'export-src-'));
  await writeFile(join(state.sourceDir, 'generated.png'), 'GENERATED');
  registerFileHandlers();
});
afterEach(async () => {
  await rm(state.exportDir, { recursive: true, force: true });
  await rm(state.sourceDir, { recursive: true, force: true });
});

describe('files:exportBatch', () => {
  it('never overwrites a file that is already in the chosen folder', async () => {
    await writeFile(join(state.exportDir, 'Lemon Tart.png'), 'ORIGINAL PHOTO');
    await writeFile(join(state.exportDir, 'lemon tart-2.PNG'), 'ANOTHER FILE');
    const result = await exportBatch([
      { url: 'local-file:///generated.png', name: 'Lemon Tart', filename: 'x.png' },
      { url: 'local-file:///generated.png', name: 'Lemon Tart', filename: 'x.png' },
    ]);
    expect(result).toMatchObject({ success: true, exported: 2, failed: 0 });
    expect(await readFile(join(state.exportDir, 'Lemon Tart.png'), 'utf8')).toBe('ORIGINAL PHOTO');
    expect(await readFile(join(state.exportDir, 'lemon tart-2.PNG'), 'utf8')).toBe('ANOTHER FILE');
    expect((await readdir(state.exportDir)).sort()).toEqual([
      'Lemon Tart-3.png',
      'Lemon Tart-4.png',
      'Lemon Tart.png',
      'lemon tart-2.PNG',
    ]);
    expect(await readFile(join(state.exportDir, 'Lemon Tart-3.png'), 'utf8')).toBe('GENERATED');
  });

  it('uses the plain name when nothing in the folder has it yet', async () => {
    await exportBatch([
      { url: 'local-file:///generated.png', name: 'IMG_2041 cake', filename: 'x.png' },
    ]);
    expect(await readdir(state.exportDir)).toEqual(['IMG_2041 cake.png']);
  });
});
