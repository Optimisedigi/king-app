import { randomBytes, randomUUID } from 'crypto';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { getDataDir } from './paths';

const MAX_LABEL_BYTES = 4 * 1024 * 1024;
/** Cap the library so listing (which reads every label) stays quick. */
export const MAX_APPROVED_LABELS = 100;
/**
 * Removed labels kept as recovery copies. The editor can only undo the latest
 * removal; older copies stay on disk for manual recovery until this many
 * newer removals push them out (oldest-created label first).
 */
export const MAX_REMOVED_LABELS = 20;
/** `label-<13-digit ms timestamp>-<8 hex>`: sortable by creation and safe as a file name. */
const LABEL_ID = /^label-\d{13}-[0-9a-f]{8}$/;
/** Id given to the label saved before multiple labels existed, so it sorts first. */
const LEGACY_ID = 'label-0000000000000-00000000';

export interface ApprovedLabel {
  id: string;
  dataUrl: string;
}

const labelsDir = (): string => join(getDataDir(), 'approved-labels');
const removedDir = (): string => join(labelsDir(), 'removed');
const legacyFile = (): string => join(getDataDir(), 'approved-cake-label.png');

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function labelPath(directory: string, id: unknown): string {
  if (typeof id !== 'string' || !LABEL_ID.test(id)) throw new Error('Unknown saved label.');
  return join(directory, `${id}.png`);
}

/**
 * Move the single label saved by older versions into the library. Uses rename,
 * so the file is never copied or lost, and never overwrites an existing label.
 */
async function migrateLegacyLabel(): Promise<void> {
  const target = labelPath(labelsDir(), LEGACY_ID);
  try {
    await access(target);
    return;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  try {
    await mkdir(labelsDir(), { recursive: true });
    await rename(legacyFile(), target);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

/** Label ids stored in a folder, oldest first. Reads names only, not image data. */
async function labelIds(directory: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith('.png') && LABEL_ID.test(name.slice(0, -4)))
    .map((name) => name.slice(0, -4))
    .sort();
}

async function assertRoomForLabel(): Promise<void> {
  await migrateLegacyLabel();
  if ((await labelIds(labelsDir())).length >= MAX_APPROVED_LABELS)
    throw new Error(`Remove a saved label first. The limit is ${MAX_APPROVED_LABELS}.`);
}

export async function listApprovedLabels(): Promise<ApprovedLabel[]> {
  await migrateLegacyLabel();
  const ids = await labelIds(labelsDir());
  const labels: ApprovedLabel[] = [];
  for (const id of ids) {
    try {
      const buffer = await readFile(labelPath(labelsDir(), id));
      if (!buffer.length || buffer.length > MAX_LABEL_BYTES) continue;
      labels.push({ id, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return labels;
}

export async function saveApprovedLabel(
  dataUrl: string,
  now: number = Date.now(),
): Promise<ApprovedLabel> {
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
  await assertRoomForLabel();
  const id = `label-${String(Math.max(0, Math.floor(now))).padStart(13, '0')}-${randomBytes(4).toString('hex')}`;
  await mkdir(labelsDir(), { recursive: true });
  const temp = join(labelsDir(), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, buffer, { flag: 'wx' });
    await rename(temp, labelPath(labelsDir(), id));
  } finally {
    await rm(temp, { force: true });
  }
  return { id, dataUrl };
}

/** Take a label out of the library; it is kept in a recovery folder, not deleted. */
export async function removeApprovedLabel(id: string): Promise<void> {
  const source = labelPath(labelsDir(), id);
  await mkdir(removedDir(), { recursive: true });
  try {
    await rename(source, labelPath(removedDir(), id));
  } catch (error) {
    if (!isMissing(error)) throw error;
    return;
  }
  // Keep the latest removal; drop the oldest recovery copies beyond the cap.
  const stale = (await labelIds(removedDir())).filter((removedId) => removedId !== id);
  const excess = stale.length + 1 - MAX_REMOVED_LABELS;
  for (const oldId of stale.slice(0, Math.max(0, excess)))
    await rm(labelPath(removedDir(), oldId), { force: true });
}

/** Put a removed label back into the library under its original id. */
export async function restoreApprovedLabel(id: string): Promise<void> {
  const target = labelPath(labelsDir(), id);
  await assertRoomForLabel();
  try {
    await rename(labelPath(removedDir(), id), target);
  } catch (error) {
    if (isMissing(error)) throw new Error('That label can no longer be restored.');
    throw error;
  }
}
