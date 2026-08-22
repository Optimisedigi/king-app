import { join } from 'path';
import { safeStorage } from 'electron';
import log from 'electron-log/main';
import { getDataDir } from './paths';
import { readJson, writeJsonAtomic, withJsonLock } from './atomicJson';

/**
 * On-disk shape. `encryptedKey` is base64-encoded ciphertext from
 * `safeStorage.encryptString`. Legacy entries with plaintext `key` are
 * migrated in-place on first read.
 */
interface StoredKey {
  encryptedKey?: string;
  /** @deprecated Plaintext \u2014 present only in pre-safeStorage files. Migrated on load. */
  key?: string;
  savedAt: string;
}

interface ApiKeyStore {
  keys: Record<string, StoredKey>;
}

function getStorePath(): string {
  return join(getDataDir(), 'api-keys.json');
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encrypt(plain: string): string {
  if (canEncrypt()) {
    return safeStorage.encryptString(plain).toString('base64');
  }
  // Rare fallback (Linux without libsecret). Keep the app usable \u2014 prefix
  // with a sentinel so we know it's plaintext-in-encrypted-field.
  log.warn('safeStorage unavailable \u2014 API key will be stored in plaintext fallback.');
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64');
}

function decrypt(encoded: string): string | null {
  if (encoded.startsWith('plain:')) {
    try {
      return Buffer.from(encoded.slice('plain:'.length), 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  if (!canEncrypt()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch (err) {
    log.warn('safeStorage decrypt failed', err);
    return null;
  }
}

function readStoreRaw(): ApiKeyStore {
  return readJson<ApiKeyStore>(getStorePath(), { keys: {} });
}

function writeStoreRaw(store: ApiKeyStore): void {
  writeJsonAtomic(getStorePath(), store);
}

/**
 * One-shot upgrade: if any entry still has the legacy plaintext `key` field,
 * re-encrypt under safeStorage and drop the plaintext. Runs on every read
 * that touches the store but is a no-op once migrated.
 */
function migrateIfNeeded(store: ApiKeyStore): { store: ApiKeyStore; migrated: boolean } {
  let migrated = false;
  for (const [service, entry] of Object.entries(store.keys)) {
    if (!entry.encryptedKey && typeof entry.key === 'string') {
      store.keys[service] = {
        encryptedKey: encrypt(entry.key),
        savedAt: entry.savedAt,
      };
      migrated = true;
    }
  }
  return { store, migrated };
}

function readStore(): ApiKeyStore {
  const raw = readStoreRaw();
  const { store, migrated } = migrateIfNeeded(raw);
  if (migrated) writeStoreRaw(store);
  return store;
}

function getDecryptedKey(service: string): string | null {
  const store = readStore();
  const entry = store.keys[service];
  if (!entry?.encryptedKey) return null;
  return decrypt(entry.encryptedKey);
}

export function getApiKey(service: string): string | null {
  return getDecryptedKey(service);
}

export function getAllApiKeys(): Record<string, { maskedKey: string; savedAt: string }> {
  const store = readStore();
  const result: Record<string, { maskedKey: string; savedAt: string }> = {};
  for (const [service, entry] of Object.entries(store.keys)) {
    const plain = entry.encryptedKey ? decrypt(entry.encryptedKey) : null;
    result[service] = {
      maskedKey: plain ? maskKey(plain) : '****',
      savedAt: entry.savedAt,
    };
  }
  return result;
}

export async function setApiKey(service: string, key: string): Promise<void> {
  const path = getStorePath();
  await withJsonLock(path, () => {
    const store = readStore();
    store.keys[service] = { encryptedKey: encrypt(key), savedAt: new Date().toISOString() };
    writeStoreRaw(store);
  });
}

export async function deleteApiKey(service: string): Promise<void> {
  const path = getStorePath();
  await withJsonLock(path, () => {
    const store = readStore();
    delete store.keys[service];
    writeStoreRaw(store);
  });
}

function maskKey(key: string): string {
  if (key.length <= 12) return '****';
  return key.slice(0, 6) + '****' + key.slice(-4);
}
