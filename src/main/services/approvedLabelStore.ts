import { randomUUID } from 'crypto';
import { readFile, writeFile, rename, rm } from 'fs/promises';
import { join } from 'path';
import { getDataDir } from './paths';

const MAX_LABEL_BYTES = 4 * 1024 * 1024;
const labelFile = (): string => join(getDataDir(), 'approved-cake-label.png');

export async function readApprovedLabel(): Promise<string | null> {
  try {
    const buffer = await readFile(labelFile());
    if (!buffer.length || buffer.length > MAX_LABEL_BYTES)
      throw new Error('Saved label is invalid.');
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  }
}

/** Remove only the reusable preset; retain its latest crop for recovery. */
export async function removeApprovedLabel(): Promise<void> {
  try {
    await rename(labelFile(), join(getDataDir(), 'approved-cake-label-removed.png'));
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
}

export async function saveApprovedLabel(dataUrl: string): Promise<void> {
  if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl))
    throw new Error('Choose a valid PNG label.');
  const base64 = dataUrl.slice('data:image/png;base64,'.length);
  if (base64.length > Math.ceil(MAX_LABEL_BYTES / 3) * 4)
    throw new Error('The label is too large.');
  const buffer = Buffer.from(base64, 'base64');
  if (
    buffer.length < 24 ||
    buffer.length > MAX_LABEL_BYTES ||
    !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error('Choose a valid PNG label no larger than 4 MB.');
  const destination = labelFile();
  const temp = join(getDataDir(), `approved-cake-label-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, buffer, { flag: 'wx' });
    await rename(temp, destination);
  } finally {
    await rm(temp, { force: true });
  }
}
