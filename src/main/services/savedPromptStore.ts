import { randomUUID } from 'crypto';
import { getSavedPromptsJsonPath } from './paths';
import { readJson, writeJsonAtomic, withJsonLock } from './atomicJson';

/**
 * Prompts the user has saved to reuse across products.
 *
 * Kept separate from the built-in prompt library in
 * `src/renderer/src/lib/prompts.ts`, which ships with the app and is
 * read-only. These are the user's own and persist in the data directory.
 */
export interface SavedPrompt {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

/** Guards against a single paste filling the store with megabytes of text. */
export const MAX_SAVED_PROMPT_LENGTH = 8000;
export const MAX_SAVED_PROMPT_TITLE_LENGTH = 120;
/** Keeps the list navigable and the JSON file small. */
export const MAX_SAVED_PROMPTS = 500;

interface SavedPromptStoreFile {
  prompts: SavedPrompt[];
}

function readStore(): SavedPromptStoreFile {
  return readJson<SavedPromptStoreFile>(getSavedPromptsJsonPath(), { prompts: [] });
}

/** Newest first, matching how the other stores order their lists. */
export function listSavedPrompts(): SavedPrompt[] {
  const store = readStore();
  return [...store.prompts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function cleanTitle(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Prompt title must be text.');
  const title = value.trim().slice(0, MAX_SAVED_PROMPT_TITLE_LENGTH);
  if (!title) throw new Error('Give the prompt a name.');
  return title;
}

function cleanPrompt(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Prompt must be text.');
  const prompt = value.trim();
  if (!prompt) throw new Error('The prompt is empty.');
  if (prompt.length > MAX_SAVED_PROMPT_LENGTH) {
    throw new Error(`Prompts are limited to ${MAX_SAVED_PROMPT_LENGTH} characters.`);
  }
  return prompt;
}

export async function addSavedPrompt(data: {
  title: unknown;
  prompt: unknown;
}): Promise<SavedPrompt> {
  const title = cleanTitle(data.title);
  const prompt = cleanPrompt(data.prompt);

  return withJsonLock(getSavedPromptsJsonPath(), () => {
    const store = readStore();
    if (store.prompts.length >= MAX_SAVED_PROMPTS) {
      throw new Error(`You can save up to ${MAX_SAVED_PROMPTS} prompts. Delete one first.`);
    }

    const now = new Date().toISOString();
    const saved: SavedPrompt = { id: randomUUID(), title, prompt, createdAt: now, updatedAt: now };
    store.prompts.push(saved);
    writeJsonAtomic(getSavedPromptsJsonPath(), store);
    return saved;
  });
}

export async function updateSavedPrompt(
  id: string,
  data: { title?: unknown; prompt?: unknown },
): Promise<SavedPrompt | null> {
  const title = data.title === undefined ? undefined : cleanTitle(data.title);
  const prompt = data.prompt === undefined ? undefined : cleanPrompt(data.prompt);

  return withJsonLock(getSavedPromptsJsonPath(), () => {
    const store = readStore();
    const existing = store.prompts.find((p) => p.id === id);
    if (!existing) return null;

    if (title !== undefined) existing.title = title;
    if (prompt !== undefined) existing.prompt = prompt;
    existing.updatedAt = new Date().toISOString();

    writeJsonAtomic(getSavedPromptsJsonPath(), store);
    return existing;
  });
}

export async function deleteSavedPrompt(id: string): Promise<boolean> {
  return withJsonLock(getSavedPromptsJsonPath(), () => {
    const store = readStore();
    const next = store.prompts.filter((p) => p.id !== id);
    if (next.length === store.prompts.length) return false;

    store.prompts = next;
    writeJsonAtomic(getSavedPromptsJsonPath(), store);
    return true;
  });
}
