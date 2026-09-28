import {
  listEntities,
  addEntity,
  updateEntity,
  deleteEntity,
  saveEntityImages,
  listProductFolders,
  createProductFolder,
  renameProductFolder,
  moveProducts,
  linkProductPairs,
  unlinkProductPair,
  type ProductPair,
} from '../services/entityStore';
import { secureHandle } from './validateSender';
import { validateProductFolderTarget } from '../../shared/productFolders';

const VALID_TYPES = ['characters', 'products'];

function validateType(entityType: string): boolean {
  return VALID_TYPES.includes(entityType);
}

function validateCreateData(entityType: string, data: unknown): void {
  if (!data || typeof data !== 'object') throw new Error('Invalid entity data');
  const value = data as Record<string, unknown>;
  if (
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    (value.productType !== undefined && typeof value.productType !== 'string') ||
    !Array.isArray(value.files) ||
    !value.files.every((file: unknown) => {
      if (!file || typeof file !== 'object') return false;
      const item = file as Record<string, unknown>;
      return (
        typeof item.name === 'string' &&
        item.name.length <= 255 &&
        (item.buffer instanceof ArrayBuffer || item.buffer instanceof Uint8Array)
      );
    })
  )
    throw new Error('Invalid entity data');
  if (value.folderId !== undefined) {
    if (entityType !== 'products') throw new Error('Folders are product-only');
    validateProductFolderTarget(value.folderId);
  }
  // Fail before saving images; addEntity repeats existence validation under the write lock.
  if (entityType === 'products') {
    const folders = listProductFolders();
    if (
      value.folderId !== null &&
      value.folderId !== undefined &&
      !folders.some((folder) => folder.id === value.folderId)
    ) {
      throw new Error('Product folder not found');
    }
  }
}

export function registerEntityHandlers(): void {
  secureHandle('productFolders:list', async () => listProductFolders());
  secureHandle('productFolders:create', async (_event, name: string) => createProductFolder(name));
  secureHandle('productFolders:rename', async (_event, id: string, name: string) =>
    renameProductFolder(id, name),
  );
  secureHandle(
    'productFolders:move',
    async (_event, productIds: string[], folderId: string | null) =>
      moveProducts(productIds, folderId),
  );
  secureHandle('productPairs:link', async (_event, pairs: ProductPair[]) =>
    linkProductPairs(pairs),
  );
  secureHandle('productPairs:unlink', async (_event, secondaryId: string) =>
    unlinkProductPair(secondaryId),
  );
  secureHandle('entities:list', async (_event, entityType: string) => {
    if (!validateType(entityType)) return [];
    return listEntities(entityType);
  });

  secureHandle(
    'entities:create',
    async (
      _event,
      entityType: string,
      data: {
        name: string;
        files: { name: string; buffer: Uint8Array }[];
        productType?: string;
        folderId?: string | null;
      },
    ) => {
      if (!validateType(entityType)) throw new Error('Invalid entity type');

      validateCreateData(entityType, data);
      const buffers = data.files.map((f) => ({
        name: f.name,
        buffer: Buffer.from(f.buffer),
      }));
      const imageUrls = saveEntityImages(entityType, buffers);
      return await addEntity(
        entityType,
        data.name,
        imageUrls,
        data.productType,
        data.folderId,
        data.files.map((file) => file.name),
      );
    },
  );

  secureHandle(
    'entities:update',
    async (
      _event,
      entityType: string,
      id: string,
      data: {
        name: string;
        existingImages: string[];
        newFiles: { name: string; buffer: Uint8Array }[];
        productType?: string;
      },
    ) => {
      if (!validateType(entityType)) throw new Error('Invalid entity type');

      if (
        !data ||
        !Array.isArray(data.existingImages) ||
        !data.existingImages.every((url) => typeof url === 'string') ||
        !Array.isArray(data.newFiles) ||
        !data.newFiles.every(
          (file) =>
            file &&
            typeof file.name === 'string' &&
            file.name.length <= 255 &&
            (file.buffer instanceof ArrayBuffer || file.buffer instanceof Uint8Array),
        )
      )
        throw new Error('Invalid entity update');
      let newUrls: string[] = [];
      if (data.newFiles.length > 0) {
        const buffers = data.newFiles.map((f) => ({
          name: f.name,
          buffer: Buffer.from(f.buffer),
        }));
        newUrls = saveEntityImages(entityType, buffers);
      }

      const allImages = [...data.existingImages, ...newUrls];
      const updated = await updateEntity(
        entityType,
        id,
        data.name,
        allImages,
        data.productType,
        data.newFiles.map((file) => file.name),
      );
      if (!updated) throw new Error('Entity not found');
      return updated;
    },
  );

  secureHandle('entities:delete', async (_event, entityType: string, id: string) => {
    if (!validateType(entityType)) return { success: false };
    const success = await deleteEntity(entityType, id);
    return { success };
  });
}
