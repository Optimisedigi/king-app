import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const state = vi.hoisted(() => ({ directory: '' }));
vi.mock('../../../src/main/services/paths', () => ({ getDataDir: () => state.directory }));

import {
  listApprovedLabels,
  saveApprovedLabel,
  removeApprovedLabel,
  restoreApprovedLabel,
  MAX_APPROVED_LABELS,
  MAX_REMOVED_LABELS,
} from '../../../src/main/services/approvedLabelStore';

const pngBytes = (fill: number): Buffer =>
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32, fill)]);
const toDataUrl = (buffer: Buffer): string => `data:image/png;base64,${buffer.toString('base64')}`;
const first = toDataUrl(pngBytes(1));
const second = toDataUrl(pngBytes(2));

beforeEach(async () => {
  state.directory = await mkdtemp(join(tmpdir(), 'label-test-'));
});
afterEach(async () => {
  await rm(state.directory, { recursive: true, force: true });
});

describe('saved label library', () => {
  it('starts empty and keeps several labels, oldest first, after a restart', async () => {
    expect(await listApprovedLabels()).toEqual([]);
    const a = await saveApprovedLabel(first, 1_000);
    const b = await saveApprovedLabel(second, 2_000);
    expect(a.id).not.toBe(b.id);
    expect(await listApprovedLabels()).toEqual([
      { id: a.id, dataUrl: first },
      { id: b.id, dataUrl: second },
    ]);
  });

  it('moves the label saved by older versions into the library without losing it', async () => {
    const legacy = pngBytes(7);
    await writeFile(join(state.directory, 'approved-cake-label.png'), legacy);
    const labels = await listApprovedLabels();
    expect(labels).toEqual([{ id: 'label-0000000000000-00000000', dataUrl: toDataUrl(legacy) }]);
    expect(await readdir(state.directory)).not.toContain('approved-cake-label.png');
    // Running again, and saving more, never duplicates or drops it.
    expect(await listApprovedLabels()).toEqual(labels);
    await saveApprovedLabel(first, 5_000);
    const after = await listApprovedLabels();
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(labels[0]);
  });

  it('never overwrites a migrated label if an old file reappears', async () => {
    await writeFile(join(state.directory, 'approved-cake-label.png'), pngBytes(7));
    await listApprovedLabels();
    await writeFile(join(state.directory, 'approved-cake-label.png'), pngBytes(9));
    const labels = await listApprovedLabels();
    expect(labels).toEqual([
      { id: 'label-0000000000000-00000000', dataUrl: toDataUrl(pngBytes(7)) },
    ]);
    expect(await readFile(join(state.directory, 'approved-cake-label.png'))).toEqual(pngBytes(9));
  });

  it('removes only the chosen label, keeps a recovery copy and can restore it', async () => {
    const cake = join(state.directory, 'original-cake.png');
    await writeFile(cake, 'keep this cake');
    const a = await saveApprovedLabel(first, 1_000);
    const b = await saveApprovedLabel(second, 2_000);
    await removeApprovedLabel(a.id);
    expect(await listApprovedLabels()).toEqual([b]);
    expect(await readFile(cake, 'utf8')).toBe('keep this cake');
    expect(
      await readFile(join(state.directory, 'approved-labels', 'removed', `${a.id}.png`)),
    ).toEqual(pngBytes(1));
    await removeApprovedLabel(a.id);
    await restoreApprovedLabel(a.id);
    expect(await listApprovedLabels()).toEqual([a, b]);
    await expect(restoreApprovedLabel(a.id)).rejects.toThrow('can no longer be restored');
  });

  it('keeps the label when its recovery copy cannot be written', async () => {
    const a = await saveApprovedLabel(first, 1_000);
    await mkdir(join(state.directory, 'approved-labels', 'removed', `${a.id}.png`), {
      recursive: true,
    });
    await expect(removeApprovedLabel(a.id)).rejects.toThrow();
    expect(await listApprovedLabels()).toEqual([a]);
  });

  it.each(['../approved-cake-label', 'label-1-2', '', 'label-0000000000001-ZZZZZZZZ'])(
    'refuses label id %j so files outside the library cannot be touched',
    async (id) => {
      await expect(removeApprovedLabel(id)).rejects.toThrow('Unknown saved label');
      await expect(restoreApprovedLabel(id)).rejects.toThrow('Unknown saved label');
    },
  );

  it('rejects malformed and oversized input without changing the library', async () => {
    const a = await saveApprovedLabel(first, 1_000);
    await expect(saveApprovedLabel('data:image/png;base64,abc')).rejects.toThrow();
    await expect(
      saveApprovedLabel(`data:image/png;base64,${'A'.repeat(6_000_000)}`),
    ).rejects.toThrow();
    expect(await listApprovedLabels()).toEqual([a]);
  });

  it('stops at the library limit, including when restoring a removed label', async () => {
    const removed = await saveApprovedLabel(first, 500);
    await removeApprovedLabel(removed.id);
    for (let index = 0; index < MAX_APPROVED_LABELS; index++)
      await saveApprovedLabel(first, 1_000 + index);
    await expect(saveApprovedLabel(second, 9_000)).rejects.toThrow('Remove a saved label first');
    await expect(restoreApprovedLabel(removed.id)).rejects.toThrow('Remove a saved label first');
    expect(await listApprovedLabels()).toHaveLength(MAX_APPROVED_LABELS);
    // The refused restore leaves the recovery copy in place.
    expect(
      await readFile(join(state.directory, 'approved-labels', 'removed', `${removed.id}.png`)),
    ).toEqual(pngBytes(1));
  });

  it('counts labels without reading their image data when saving', async () => {
    await saveApprovedLabel(first, 1_000);
    // An entry that cannot be read as a file: listing must read it, counting must not.
    await mkdir(join(state.directory, 'approved-labels', 'label-0000000002000-aaaaaaaa.png'));
    await expect(listApprovedLabels()).rejects.toThrow();
    await expect(saveApprovedLabel(second, 3_000)).resolves.toMatchObject({ dataUrl: second });
  });

  it('keeps only the newest recovery copies of removed labels', async () => {
    const saved = [];
    for (let index = 0; index < MAX_REMOVED_LABELS + 3; index++)
      saved.push(await saveApprovedLabel(first, 1_000 + index));
    for (const label of saved) await removeApprovedLabel(label.id);
    const kept = (await readdir(join(state.directory, 'approved-labels', 'removed'))).sort();
    expect(kept).toEqual(saved.slice(-MAX_REMOVED_LABELS).map((label) => `${label.id}.png`));
    // The latest removal is always kept, even if it was created first.
    const oldest = await saveApprovedLabel(second, 1);
    await removeApprovedLabel(oldest.id);
    await restoreApprovedLabel(oldest.id);
    expect((await listApprovedLabels()).map((label) => label.id)).toContain(oldest.id);
  });
});
