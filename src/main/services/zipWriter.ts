import { randomUUID } from 'crypto';
import { open, rename, rm, type FileHandle } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { crc32 } from 'zlib';

/**
 * A minimal zip writer for exporting saved images.
 *
 * Entries are stored without compression: PNG, JPEG and WebP are already
 * compressed, so deflating them again costs time and saves almost nothing.
 * Files stream to a hidden temporary file beside the target and are renamed
 * into place only once the archive is complete, so a failed or cancelled
 * export never leaves a half-written zip under the user's chosen name.
 */
export interface ZipWriter {
  add(name: string, data: Buffer): Promise<void>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}

/** Classic zip uses 32-bit sizes and offsets and a 16-bit entry count. */
const MAX_ZIP32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;
/** General-purpose flag bit 11: entry names are UTF-8. */
const UTF8_FLAG = 0x0800;

interface Entry {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
}

/** MS-DOS date and time fields, as stored in zip headers. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export async function openZipWriter(target: string, modified: Date): Promise<ZipWriter> {
  const partial = join(dirname(target), `.${basename(target)}.${randomUUID()}.partial`);
  const file: FileHandle = await open(partial, 'wx');
  const stamp = dosDateTime(modified);
  const entries: Entry[] = [];
  let offset = 0;
  let closed = false;

  async function write(buffer: Buffer): Promise<void> {
    if (offset + buffer.length > MAX_ZIP32) {
      throw new Error('This export is too large for one zip file. Select fewer images.');
    }
    await file.write(buffer);
    offset += buffer.length;
  }

  async function discard(): Promise<void> {
    if (!closed) {
      closed = true;
      await file.close();
    }
    await rm(partial, { force: true });
  }

  return {
    async add(name, data) {
      if (closed) throw new Error('Zip is already closed.');
      if (entries.length >= MAX_ENTRIES) throw new Error('Too many files for one zip.');
      const entry: Entry = {
        name: Buffer.from(name, 'utf8'),
        crc: crc32(data),
        size: data.length,
        offset,
      };
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4); // version needed: 2.0
      header.writeUInt16LE(UTF8_FLAG, 6);
      header.writeUInt16LE(0, 8); // stored
      header.writeUInt16LE(stamp.time, 10);
      header.writeUInt16LE(stamp.date, 12);
      header.writeUInt32LE(entry.crc, 14);
      header.writeUInt32LE(entry.size, 18);
      header.writeUInt32LE(entry.size, 22);
      header.writeUInt16LE(entry.name.length, 26);
      header.writeUInt16LE(0, 28);
      await write(Buffer.concat([header, entry.name]));
      await write(data);
      entries.push(entry);
    },

    async finish() {
      if (closed) throw new Error('Zip is already closed.');
      try {
        const start = offset;
        for (const entry of entries) {
          const header = Buffer.alloc(46);
          header.writeUInt32LE(0x02014b50, 0);
          header.writeUInt16LE(20, 4); // made by: 2.0
          header.writeUInt16LE(20, 6); // version needed: 2.0
          header.writeUInt16LE(UTF8_FLAG, 8);
          header.writeUInt16LE(0, 10); // stored
          header.writeUInt16LE(stamp.time, 12);
          header.writeUInt16LE(stamp.date, 14);
          header.writeUInt32LE(entry.crc, 16);
          header.writeUInt32LE(entry.size, 20);
          header.writeUInt32LE(entry.size, 24);
          header.writeUInt16LE(entry.name.length, 28);
          // Extra, comment, disk, internal and external attributes stay zero.
          header.writeUInt32LE(entry.offset, 42);
          await write(Buffer.concat([header, entry.name]));
        }
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(entries.length, 8);
        end.writeUInt16LE(entries.length, 10);
        end.writeUInt32LE(offset - start, 12);
        end.writeUInt32LE(start, 16);
        await write(end);
        closed = true;
        await file.close();
        await rename(partial, target);
      } catch (error) {
        await discard();
        throw error;
      }
    },

    abort: discard,
  };
}
