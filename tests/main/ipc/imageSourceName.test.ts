import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  addImage: vi.fn(async (image: unknown) => image),
}));
vi.mock('electron', () => ({
  app: { getAppPath: () => '/trusted/app' },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      state.handlers.set(channel, handler),
  },
  nativeImage: { createFromDataURL: vi.fn() },
}));
vi.mock('../../../src/main/services/approvedLabelStore', () => ({
  listApprovedLabels: vi.fn(),
  saveApprovedLabel: vi.fn(),
  removeApprovedLabel: vi.fn(),
  restoreApprovedLabel: vi.fn(),
}));
vi.mock('../../../src/main/services/imageStore', () => ({
  getImage: vi.fn(),
  listImages: vi.fn(),
  addImage: state.addImage,
  deleteImage: vi.fn(),
}));
vi.mock('../../../src/main/services/fileManager', () => ({
  downloadAndSaveImage: vi.fn(async () => ({
    filename: 'abc.png',
    localUrl: 'local-file:///abc.png',
  })),
  deleteImageFile: vi.fn(),
}));
vi.mock('../../../src/main/services/cropImage', () => ({ cropCloseUpFromFile: vi.fn() }));
vi.mock('../../../src/main/services/paths', () => ({ resolveLocalFileUrl: vi.fn() }));

import { registerImageHandlers } from '../../../src/main/ipc/images';

const trusted = { senderFrame: { url: 'file:///trusted/app/index.html' } };
const save = (extra: Record<string, unknown>) =>
  state.handlers.get('images:save')?.(trusted, {
    url: 'data:image/png;base64,AA==',
    prompt: 'A cake',
    aspectRatio: '1:1',
    ...extra,
  });

beforeEach(() => {
  state.handlers.clear();
  state.addImage.mockClear();
  registerImageHandlers();
});

describe('images:save source name', () => {
  it('stores the original photo name with the saved image', async () => {
    await expect(save({ sourceName: '  IMG_2041 blueberry  ' })).resolves.toMatchObject({
      sourceName: 'IMG_2041 blueberry',
      prompt: 'A cake',
    });
  });

  it.each([undefined, '', '   ', 42, { name: 'x' }])(
    'leaves the field off for a missing or invalid name %j',
    async (sourceName) => {
      const saved = (await save({ sourceName })) as Record<string, unknown>;
      expect('sourceName' in saved).toBe(false);
    },
  );

  it('caps an overlong name instead of storing it whole', async () => {
    const saved = (await save({ sourceName: 'x'.repeat(1_000) })) as { sourceName: string };
    expect(saved.sourceName).toHaveLength(255);
  });
});
