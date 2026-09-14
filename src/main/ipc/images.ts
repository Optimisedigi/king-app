import { randomUUID } from 'crypto';
import {
  listImages,
  addImage,
  deleteImage,
  getImage,
  type ImageModel,
} from '../services/imageStore';
import { downloadAndSaveImage, deleteImageFile } from '../services/fileManager';
import { cropCloseUpFromFile } from '../services/cropImage';
import { resolveLocalFileUrl } from '../services/paths';
import { secureHandle } from './validateSender';

export function registerImageHandlers(): void {
  secureHandle('images:list', async (_event, cursor?: string, limit?: number) => {
    return listImages(cursor, limit);
  });

  secureHandle(
    'images:save',
    async (
      _event,
      data: { url: string; prompt: string; aspectRatio: string; model?: ImageModel },
    ) => {
      const { filename, localUrl } = await downloadAndSaveImage(data.url);
      const image = await addImage({
        id: randomUUID(),
        url: localUrl,
        prompt: data.prompt,
        aspectRatio: data.aspectRatio,
        createdAt: new Date().toISOString(),
        filename,
        model: data.model,
      });
      return image;
    },
  );

  /**
   * Crop a close-up out of an image the app has already saved. Takes a
   * `local-file://` URL so the region comes from our own images directory --
   * `resolveLocalFileUrl` rejects any other scheme or a path escaping it.
   */
  secureHandle('images:cropCloseUp', async (_event, localUrl: string) => {
    if (typeof localUrl !== 'string') return { success: false as const };
    const path = resolveLocalFileUrl(localUrl);
    if (!path) return { success: false as const };
    const dataUrl = cropCloseUpFromFile(path);
    return dataUrl ? { success: true as const, dataUrl } : { success: false as const };
  });

  secureHandle('images:delete', async (_event, id: string) => {
    const image = await getImage(id);
    if (image) {
      deleteImageFile(image.filename);
    }
    const success = await deleteImage(id);
    return { success };
  });
}
