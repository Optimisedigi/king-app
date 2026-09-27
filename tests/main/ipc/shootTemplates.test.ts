import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  save: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: mocks.decode } }));
vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../src/main/ipc/validateSender', () => ({
  secureHandle: (name: string, handler: (...args: unknown[]) => unknown) =>
    mocks.handlers.set(name, handler),
}));
vi.mock('../../../src/main/services/shootTemplateStore', () => ({
  resolveShootTemplateAsset: () => {
    throw new Error('Not owned');
  },
  shootTemplateStore: { saveAsset: mocks.save, get: () => ({ revision: 2 }) },
}));
import {
  decodeReference,
  imageDimensions,
  prepareTemplate,
  registerShootTemplateHandlers,
} from '../../../src/main/ipc/shootTemplates';
describe('template input boundary', () => {
  it.each([null, {}, { name: 'x', aspectRatio: 'auto', angles: {} }])(
    'rejects malformed payloads before writes',
    (value) => {
      expect(() => prepareTemplate(value)).toThrow();
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );
  it('rejects external URLs, path escapes and invalid images', () => {
    for (const source of [
      'https://example.com/a.png',
      'local-file:///shoot-templates/../../secret.png',
      'data:image/png;base64,YmFk',
    ])
      expect(() => decodeReference(source)).toThrow();
    expect(mocks.decode).not.toHaveBeenCalled();
  });
  it('bounds encoded bytes before decoding', () => {
    expect(() => decodeReference('data:image/png;base64,' + 'A'.repeat(42 * 1024 * 1024))).toThrow(
      '30 MB',
    );
    expect(mocks.decode).not.toHaveBeenCalled();
  });
  it('bounds pixel dimensions before decoding', () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(100000, 16);
    png.writeUInt32BE(100000, 20);
    expect(() => imageDimensions(png)).toThrow('40 megapixels');
    expect(() => decodeReference(`data:image/png;base64,${png.toString('base64')}`)).toThrow(
      '40 megapixels',
    );
    expect(mocks.decode).not.toHaveBeenCalled();
  });
  it('rejects out-of-frame guides', () => {
    expect(() =>
      prepareTemplate({
        name: 'x',
        aspectRatio: '1:1',
        angles: {
          'eye-level': {
            source: 'x',
            crop: { x: 0, y: 0, width: 1, height: 1 },
            guides: { centreX: 0, width: 1, baseY: 0.8 },
          },
        },
      }),
    ).toThrow('guides');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects stale revisions before decoding or writes', async () => {
    registerShootTemplateHandlers();
    const handler = mocks.handlers.get('shootTemplates:update');
    expect(handler).toBeDefined();
    await expect(handler?.({}, '11111111-1111-1111-1111-111111111111', 1, {})).rejects.toThrow(
      'changed',
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
