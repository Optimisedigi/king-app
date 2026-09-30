import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  decode: vi.fn(() => ({ getSize: () => ({ width: 1024, height: 1024 }) })),
  save: vi.fn().mockResolvedValue({ id: 'label-0000000000001-aaaaaaaa', dataUrl: 'x' }),
  remove: vi.fn().mockResolvedValue(undefined),
  restore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('electron', () => ({
  app: { getAppPath: () => '/trusted/app' },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      state.handlers.set(channel, handler),
  },
  nativeImage: { createFromDataURL: state.decode },
}));
vi.mock('../../../src/main/services/approvedLabelStore', () => ({
  listApprovedLabels: vi.fn().mockResolvedValue([]),
  saveApprovedLabel: state.save,
  removeApprovedLabel: state.remove,
  restoreApprovedLabel: state.restore,
}));
vi.mock('../../../src/main/services/imageStore', () => ({
  getImage: vi.fn(),
  listImages: vi.fn(),
  addImage: vi.fn(),
  deleteImage: vi.fn(),
}));
vi.mock('../../../src/main/services/fileManager', () => ({
  downloadAndSaveImage: vi.fn(),
  deleteImageFile: vi.fn(),
}));
vi.mock('../../../src/main/services/cropImage', () => ({ cropCloseUpFromFile: vi.fn() }));
vi.mock('../../../src/main/services/paths', () => ({ resolveLocalFileUrl: vi.fn() }));

import { registerImageHandlers } from '../../../src/main/ipc/images';

const trusted = { senderFrame: { url: 'file:///trusted/app/index.html' } };
const untrusted = { senderFrame: null };
const call = (value: unknown) => state.handlers.get('images:saveApprovedLabel')?.(trusted, value);

beforeEach(() => {
  state.handlers.clear();
  state.decode
    .mockReset()
    .mockImplementation(() => ({ getSize: () => ({ width: 1024, height: 1024 }) }));
  state.save.mockClear();
  state.remove.mockClear();
  state.restore.mockClear();
  registerImageHandlers();
});

describe('approved label IPC boundary', () => {
  it('refuses oversized and undecodable labels without saving', async () => {
    await expect(call('x'.repeat(6_000_001))).rejects.toThrow();
    state.decode.mockImplementationOnce(() => ({ getSize: () => ({ width: 0, height: 0 }) }));
    await expect(call('data:image/png;base64,invalid')).rejects.toThrow('valid PNG');
    expect(state.save).not.toHaveBeenCalled();
  });

  it.each([
    ['images:removeApprovedLabel', 'remove'],
    ['images:restoreApprovedLabel', 'restore'],
  ] as const)('%s checks the sender and the id before touching files', async (channel, key) => {
    const handler = state.handlers.get(channel);
    expect(() => handler?.(untrusted, 'label-0000000000001-aaaaaaaa')).toThrow('IPC:');
    await expect(handler?.(trusted, 42)).rejects.toThrow('Unknown saved label');
    expect(state[key]).not.toHaveBeenCalled();
    await handler?.(trusted, 'label-0000000000001-aaaaaaaa');
    expect(state[key]).toHaveBeenCalledExactlyOnceWith('label-0000000000001-aaaaaaaa');
    expect(state.save).not.toHaveBeenCalled();
  });

  it('saves a decoded label after sender validation and returns its id', async () => {
    expect(() =>
      state.handlers.get('images:saveApprovedLabel')?.(untrusted, 'data:image/png;base64,AA=='),
    ).toThrow('IPC:');
    await expect(call('data:image/png;base64,AA==')).resolves.toEqual({
      id: 'label-0000000000001-aaaaaaaa',
      dataUrl: 'x',
    });
    expect(state.save).toHaveBeenCalledWith('data:image/png;base64,AA==');
  });
});
