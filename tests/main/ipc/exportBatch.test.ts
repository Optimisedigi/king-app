import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  exportDir: '',
  sourceDir: '',
  zipPath: '' as string | undefined,
}));
vi.mock('electron', () => ({
  app: { getAppPath: () => '/trusted/app', getPath: () => state.exportDir },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      state.handlers.set(channel, handler),
  },
  BrowserWindow: { getFocusedWindow: () => ({}) },
  dialog: {
    showOpenDialog: async () => ({ filePaths: [state.exportDir] }),
    showSaveDialog: async () => ({ filePath: state.zipPath }),
  },
}));
vi.mock('electron-log/main', () => ({ default: { error: vi.fn(), info: vi.fn() } }));
vi.mock('../../../src/main/services/paths', () => ({
  resolveLocalFileUrl: (url: string) =>
    url.startsWith('local-file:///')
      ? join(state.sourceDir, url.slice('local-file:///'.length))
      : null,
}));

import { registerFileHandlers } from '../../../src/main/ipc/files';

const trusted = { senderFrame: { url: 'file:///trusted/app/index.html' } };
const exportBatch = (items: unknown) => state.handlers.get('files:exportBatch')?.(trusted, items);
const exportZip = (items: unknown) => state.handlers.get('files:exportZip')?.(trusted, items);

/** Entry names in a zip, read from its central directory. */
function zipEntryNames(zip: Buffer): string[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = zip.readUInt32LE(end + 16);
  return Array.from({ length: zip.readUInt16LE(end + 10) }, () => {
    const length = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 46, offset + 46 + length).toString('utf8');
    offset += 46 + length;
    return name;
  });
}

beforeEach(async () => {
  state.handlers.clear();
  state.exportDir = await mkdtemp(join(tmpdir(), 'export-dest-'));
  state.sourceDir = await mkdtemp(join(tmpdir(), 'export-src-'));
  await writeFile(join(state.sourceDir, 'generated.png'), 'GENERATED');
  state.zipPath = join(state.exportDir, 'Selected images.zip');
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

describe('files:exportZip', () => {
  it('saves the selected images into one zip with unique, safe names', async () => {
    const result = await exportZip([
      { url: 'local-file:///generated.png', name: 'Lemon Tart', filename: 'x.png' },
      { url: 'local-file:///generated.png', name: 'Lemon Tart', filename: 'x.webp' },
      { url: 'local-file:///generated.png', name: '../../etc/passwd', filename: 'x.jpg' },
    ]);
    expect(result).toMatchObject({
      success: true,
      filePath: state.zipPath,
      exported: 3,
      failed: 0,
    });
    expect(await readdir(state.exportDir)).toEqual(['Selected images.zip']);
    expect(zipEntryNames(await readFile(join(state.exportDir, 'Selected images.zip')))).toEqual([
      'Lemon Tart.png',
      'Lemon Tart.webp',
      // Separators are removed, so a name can never become a path inside the zip.
      '.. .. etc passwd.jpg',
    ]);
  });

  it('skips images it cannot read and counts them as failed', async () => {
    const result = await exportZip([
      { url: 'local-file:///generated.png', name: 'Cake', filename: 'x.png' },
      { url: 'local-file:///missing.png', name: 'Gone', filename: 'x.png' },
      { url: 'https://example.com/a.png', name: 'Remote', filename: 'x.png' },
    ]);
    expect(result).toMatchObject({ success: true, exported: 1, failed: 2 });
    expect(zipEntryNames(await readFile(join(state.exportDir, 'Selected images.zip')))).toEqual([
      'Cake.png',
    ]);
  });

  it('creates no zip when none of the images could be read', async () => {
    const result = await exportZip([
      { url: 'local-file:///missing.png', name: 'Gone', filename: 'x.png' },
    ]);
    expect(result).toMatchObject({ success: false, exported: 0, failed: 1 });
    expect(await readdir(state.exportDir)).toEqual([]);
  });

  it('writes nothing when the save dialog is cancelled', async () => {
    state.zipPath = undefined;
    const result = await exportZip([
      { url: 'local-file:///generated.png', name: 'Cake', filename: 'x.png' },
    ]);
    expect(result).toMatchObject({ success: false, cancelled: true, exported: 0 });
    expect(await readdir(state.exportDir)).toEqual([]);
  });
});
