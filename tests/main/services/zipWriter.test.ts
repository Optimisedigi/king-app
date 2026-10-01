import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { crc32 } from 'zlib';
import { openZipWriter } from '../../../src/main/services/zipWriter';

/** Read a stored (uncompressed) zip through its central directory, as unzip tools do. */
function readStoredZip(zip: Buffer): { name: string; data: Buffer; utf8: boolean }[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries: { name: string; data: Buffer; utf8: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
    const flags = zip.readUInt16LE(offset + 8);
    expect(zip.readUInt16LE(offset + 10)).toBe(0); // stored
    const crc = zip.readUInt32LE(offset + 16);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    entries.push({ name, data, utf8: (flags & 0x0800) !== 0 });
    offset += 46 + nameLength;
  }
  return entries;
}

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zip-writer-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('openZipWriter', () => {
  it('writes every added file with its name and exact bytes', async () => {
    const target = join(dir, 'images.zip');
    const zip = await openZipWriter(target, new Date(2026, 9, 1, 12, 30, 10));
    await zip.add('Lemon Tart.png', Buffer.from('PNG BYTES'));
    await zip.add('Gâteau 45°.jpg', Buffer.from([0, 1, 2, 255]));
    await zip.finish();

    const entries = readStoredZip(await readFile(target));
    expect(entries.map((entry) => entry.name)).toEqual(['Lemon Tart.png', 'Gâteau 45°.jpg']);
    expect(entries[0]?.data.toString()).toBe('PNG BYTES');
    expect([...(entries[1]?.data ?? [])]).toEqual([0, 1, 2, 255]);
    expect(entries.every((entry) => entry.utf8)).toBe(true);
  });

  it('only creates the zip once it is finished', async () => {
    const target = join(dir, 'images.zip');
    const zip = await openZipWriter(target, new Date(2026, 9, 1));
    await zip.add('a.png', Buffer.from('A'));
    expect(await readdir(dir)).not.toContain('images.zip');
    await zip.finish();
    expect(await readdir(dir)).toEqual(['images.zip']);
  });

  it('leaves nothing behind when aborted', async () => {
    const zip = await openZipWriter(join(dir, 'images.zip'), new Date(2026, 9, 1));
    await zip.add('a.png', Buffer.from('A'));
    await zip.abort();
    expect(await readdir(dir)).toEqual([]);
  });
});
