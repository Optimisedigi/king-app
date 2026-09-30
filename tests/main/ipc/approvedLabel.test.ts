import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  decode: vi.fn(() => ({ getSize: () => ({ width: 1024, height: 1024 }) })),
  save: vi.fn().mockResolvedValue(undefined),
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
  readApprovedLabel: vi.fn().mockResolvedValue(null),
  saveApprovedLabel: state.save,
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
const call = (value: unknown) => state.handlers.get('images:saveApprovedLabel')?.(trusted, value);

beforeEach(() => {
  state.handlers.clear();
  state.decode
    .mockReset()
    .mockImplementation(() => ({ getSize: () => ({ width: 1024, height: 1024 }) }));
  state.save.mockClear();
  registerImageHandlers();
});

describe('approved label IPC boundary', () => {
  it('refuses oversized and undecodable labels without replacing the saved one', async () => {
    await expect(call('x'.repeat(6_000_001))).rejects.toThrow();
    state.decode.mockImplementationOnce(() => ({ getSize: () => ({ width: 0, height: 0 }) }));
    await expect(call('data:image/png;base64,invalid')).rejects.toThrow('valid PNG');
    expect(state.save).not.toHaveBeenCalled();
  });

  it('passes a decoded image to the store after sender validation', async () => {
    expect(() =>
      state.handlers.get('images:saveApprovedLabel')?.(
        { senderFrame: null },
        'data:image/png;base64,AA==',
      ),
    ).toThrow('IPC:');
    await call('data:image/png;base64,AA==');
    expect(state.save).toHaveBeenCalledWith('data:image/png;base64,AA==');
  });
});
