import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const state = vi.hoisted(() => ({ directory: '' }));
vi.mock('../../../src/main/services/paths', () => ({ getDataDir: () => state.directory }));

import {
  readApprovedLabel,
  saveApprovedLabel,
} from '../../../src/main/services/approvedLabelStore';

const png = `data:image/png;base64,${Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(32),
]).toString('base64')}`;

beforeEach(async () => {
  state.directory = await mkdtemp(join(tmpdir(), 'label-test-'));
});
afterEach(async () => {
  await rm(state.directory, { recursive: true, force: true });
});

describe('approved label persistence', () => {
  it('returns null when no label was saved and reads a saved label after a restart', async () => {
    expect(await readApprovedLabel()).toBeNull();
    await saveApprovedLabel(png);
    expect(await readApprovedLabel()).toBe(png);
  });

  it('rejects malformed and oversized input without overwriting the approved label', async () => {
    await saveApprovedLabel(png);
    await expect(saveApprovedLabel('data:image/png;base64,abc')).rejects.toThrow();
    await expect(
      saveApprovedLabel(`data:image/png;base64,${'A'.repeat(6_000_000)}`),
    ).rejects.toThrow();
    expect(await readApprovedLabel()).toBe(png);
  });
});
