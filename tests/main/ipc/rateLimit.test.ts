import { describe, it, expect, vi } from 'vitest';
import { APIError } from 'openai';

// `generate.ts` pulls in Electron and the app's stores at import time; none of
// that is needed to exercise the rate-limit detection.
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: vi.fn() } }));
vi.mock('electron-log/main', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../src/main/services/apiKeyStore', () => ({ getApiKey: vi.fn() }));
vi.mock('../../../src/main/services/openaiOAuth', () => ({ getValidAccessToken: vi.fn() }));
vi.mock('../../../src/main/services/paths', () => ({ resolveLocalFileUrl: vi.fn() }));
vi.mock('../../../src/main/ipc/validateSender', () => ({ secureHandle: vi.fn() }));

import { isRateLimited } from '../../../src/main/ipc/generate';

describe('isRateLimited', () => {
  it('detects a 429 from the OpenAI SDK', () => {
    const error = new APIError(429, undefined, 'Rate limit reached', undefined);
    expect(isRateLimited(error)).toBe(true);
  });

  it('detects the OAuth path error, which carries the status in its message', () => {
    // Matches the shape thrown by the Codex path.
    const error = new Error('OpenAI OAuth request failed (429): {"detail":"slow down"}');
    expect(isRateLimited(error)).toBe(true);
  });

  it('detects a provider error object exposing a numeric status', () => {
    expect(isRateLimited({ status: 429 })).toBe(true);
  });

  it('ignores other OpenAI failures so they surface immediately', () => {
    expect(isRateLimited(new APIError(400, undefined, 'Bad request', undefined))).toBe(false);
    expect(isRateLimited(new APIError(401, undefined, 'Bad key', undefined))).toBe(false);
    expect(isRateLimited({ status: 500 })).toBe(false);
  });

  it('does not treat an unrelated message as a rate limit', () => {
    expect(isRateLimited(new Error('The image requires 33489 patches'))).toBe(false);
    expect(isRateLimited(new Error('failed with code 4290'))).toBe(false);
  });

  it('handles non-error values without throwing', () => {
    expect(isRateLimited(null)).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
    expect(isRateLimited('429')).toBe(false);
  });
});
