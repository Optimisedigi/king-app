import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SavedPrompt } from '../../../src/main/services/savedPromptStore';

// `vi.hoisted` keeps these mock handles reachable from the hoisted
// `vi.mock` factory below.
const mocks = vi.hoisted(() => {
  const store: { prompts: unknown[] } = { prompts: [] };
  return {
    store,
    readJson: vi.fn(() => ({ prompts: [...(store.prompts as never[])] })),
    writeJsonAtomic: vi.fn((_path: string, value: { prompts: unknown[] }) => {
      store.prompts = value.prompts;
    }),
    withJsonLock: vi.fn((_path: string, fn: () => unknown) => Promise.resolve(fn())),
  };
});
const { store } = mocks;

vi.mock('../../../src/main/services/atomicJson', () => ({
  readJson: mocks.readJson,
  writeJsonAtomic: mocks.writeJsonAtomic,
  withJsonLock: mocks.withJsonLock,
}));

vi.mock('../../../src/main/services/paths', () => ({
  getSavedPromptsJsonPath: vi.fn(() => '/mock/data/saved-prompts.json'),
}));

import {
  listSavedPrompts,
  addSavedPrompt,
  updateSavedPrompt,
  deleteSavedPrompt,
  MAX_SAVED_PROMPT_LENGTH,
  MAX_SAVED_PROMPT_TITLE_LENGTH,
} from '../../../src/main/services/savedPromptStore';

beforeEach(() => {
  store.prompts = [];
  vi.clearAllMocks();
});

describe('addSavedPrompt', () => {
  it('saves a prompt and returns it with an id and timestamps', async () => {
    const saved = await addSavedPrompt({ title: 'Studio packshot', prompt: 'white background' });
    expect(saved.id).toBeTruthy();
    expect(saved.title).toBe('Studio packshot');
    expect(saved.prompt).toBe('white background');
    expect(saved.createdAt).toBe(saved.updatedAt);
    expect(store.prompts).toHaveLength(1);
  });

  it('trims surrounding whitespace', async () => {
    const saved = await addSavedPrompt({ title: '  Name  ', prompt: '  body  ' });
    expect(saved.title).toBe('Name');
    expect(saved.prompt).toBe('body');
  });

  it('rejects an empty title or prompt', async () => {
    await expect(addSavedPrompt({ title: '   ', prompt: 'body' })).rejects.toThrow();
    await expect(addSavedPrompt({ title: 'Name', prompt: '   ' })).rejects.toThrow();
  });

  it('rejects non-text input from the renderer', async () => {
    await expect(addSavedPrompt({ title: 42, prompt: 'body' })).rejects.toThrow();
    await expect(addSavedPrompt({ title: 'Name', prompt: { evil: true } })).rejects.toThrow();
  });

  it('rejects a prompt beyond the length cap', async () => {
    const tooLong = 'x'.repeat(MAX_SAVED_PROMPT_LENGTH + 1);
    await expect(addSavedPrompt({ title: 'Name', prompt: tooLong })).rejects.toThrow();
  });

  it('truncates an over-long title rather than failing', async () => {
    const saved = await addSavedPrompt({
      title: 'y'.repeat(MAX_SAVED_PROMPT_TITLE_LENGTH + 50),
      prompt: 'body',
    });
    expect(saved.title).toHaveLength(MAX_SAVED_PROMPT_TITLE_LENGTH);
  });
});

describe('listSavedPrompts', () => {
  it('returns the most recently updated first', async () => {
    store.prompts = [
      { id: 'a', title: 'A', prompt: 'a', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'b', title: 'B', prompt: 'b', createdAt: '2026-01-02', updatedAt: '2026-03-01' },
      { id: 'c', title: 'C', prompt: 'c', createdAt: '2026-01-03', updatedAt: '2026-02-01' },
    ] satisfies SavedPrompt[];
    expect(listSavedPrompts().map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('returns an empty list when nothing is saved', () => {
    expect(listSavedPrompts()).toEqual([]);
  });
});

describe('updateSavedPrompt', () => {
  it('changes only the fields supplied', async () => {
    const saved = await addSavedPrompt({ title: 'Name', prompt: 'body' });
    const updated = await updateSavedPrompt(saved.id, { prompt: 'new body' });
    expect(updated?.title).toBe('Name');
    expect(updated?.prompt).toBe('new body');
  });

  it('returns null for an unknown id', async () => {
    expect(await updateSavedPrompt('missing', { title: 'x' })).toBeNull();
  });

  it('rejects an invalid replacement value', async () => {
    const saved = await addSavedPrompt({ title: 'Name', prompt: 'body' });
    await expect(updateSavedPrompt(saved.id, { prompt: '  ' })).rejects.toThrow();
  });
});

describe('deleteSavedPrompt', () => {
  it('removes the prompt and reports success', async () => {
    const saved = await addSavedPrompt({ title: 'Name', prompt: 'body' });
    expect(await deleteSavedPrompt(saved.id)).toBe(true);
    expect(store.prompts).toHaveLength(0);
  });

  it('reports failure for an unknown id', async () => {
    expect(await deleteSavedPrompt('missing')).toBe(false);
  });
});
