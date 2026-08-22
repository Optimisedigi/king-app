import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8'),
  },
}));

vi.mock('electron-log/main', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mocks = vi.hoisted(() => {
  const fakeStore: {
    keys: Record<string, { encryptedKey?: string; key?: string; savedAt: string }>;
  } = { keys: {} };
  return {
    fakeStore,
    readJson: vi.fn(() => ({ keys: { ...fakeStore.keys } })),
    writeJsonAtomic: vi.fn(
      (
        _path: string,
        value: { keys: Record<string, { encryptedKey?: string; savedAt: string }> },
      ) => {
        fakeStore.keys = value.keys;
      },
    ),
    withJsonLock: vi.fn((_path: string, fn: () => unknown) => Promise.resolve(fn())),
  };
});
const { fakeStore, writeJsonAtomic } = mocks;

vi.mock('../../../src/main/services/atomicJson', () => ({
  readJson: mocks.readJson,
  writeJsonAtomic: mocks.writeJsonAtomic,
  withJsonLock: mocks.withJsonLock,
}));

vi.mock('../../../src/main/services/paths', () => ({
  getDataDir: vi.fn(() => '/mock/data'),
}));

import {
  getAllApiKeys,
  getApiKey,
  setApiKey,
  deleteApiKey,
} from '../../../src/main/services/apiKeyStore';

function encodeForTest(plain: string): string {
  return Buffer.from(plain, 'utf8').toString('base64');
}

function seedKey(service: string, plain: string, savedAt = '2024-01-01T00:00:00.000Z'): void {
  fakeStore.keys[service] = { encryptedKey: encodeForTest(plain), savedAt };
}

describe('apiKeyStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeStore.keys = {};
  });

  describe('masking', () => {
    it('fully masks short keys', () => {
      seedKey('openai', 'short');
      expect(getAllApiKeys().openai.maskedKey).toBe('****');
    });

    it('reveals only the first 6 and last 4 characters of long keys', () => {
      seedKey('openai', 'abcdef_middle_wxyz');
      expect(getAllApiKeys().openai.maskedKey).toBe('abcdef****wxyz');
    });
  });

  it('returns masked metadata for every service', () => {
    seedKey('openai', 'openai_example_1234', '2024-07-01T00:00:00.000Z');
    seedKey('facebook', 'facebook_access_5678', '2024-08-01T00:00:00.000Z');

    expect(getAllApiKeys()).toEqual({
      openai: { maskedKey: 'openai****1234', savedAt: '2024-07-01T00:00:00.000Z' },
      facebook: { maskedKey: 'facebo****5678', savedAt: '2024-08-01T00:00:00.000Z' },
    });
  });

  it('returns decrypted keys and null for missing services', () => {
    seedKey('openai', 'stored-openai-key');
    expect(getApiKey('openai')).toBe('stored-openai-key');
    expect(getApiKey('missing')).toBeNull();
  });

  it('encrypts a saved key without changing process.env', async () => {
    const existingEnvironmentKey = process.env.OPENAI_API_KEY;
    await setApiKey('openai', 'new-openai-key');

    const written = writeJsonAtomic.mock.calls[0][1] as {
      keys: Record<string, { encryptedKey: string; savedAt: string }>;
    };
    expect(written.keys.openai.encryptedKey).toBe(encodeForTest('new-openai-key'));
    expect(written.keys.openai.savedAt).toBeDefined();
    expect(process.env.OPENAI_API_KEY).toBe(existingEnvironmentKey);
  });

  it('deletes a stored key', async () => {
    seedKey('openai', 'old-key');
    await deleteApiKey('openai');

    const calls = writeJsonAtomic.mock.calls;
    const lastWritten = calls[calls.length - 1][1] as { keys: Record<string, unknown> };
    expect(lastWritten.keys.openai).toBeUndefined();
  });

  it('migrates a legacy plaintext key on first read', () => {
    const legacyPlaintext = 'legacy-value';
    fakeStore.keys.openai = { key: legacyPlaintext, savedAt: '2024-01-01T00:00:00.000Z' };

    expect(getApiKey('openai')).toBe(legacyPlaintext);
    expect(writeJsonAtomic).toHaveBeenCalled();
    expect(fakeStore.keys.openai.encryptedKey).toBe(encodeForTest(legacyPlaintext));
    expect(fakeStore.keys.openai.key).toBeUndefined();
  });
});
