import { writeFileSync, existsSync, unlinkSync, readFileSync, copyFileSync, constants } from 'fs';
import {
  type ProductFolder,
  normalizeProductFolderName,
  validateProductFolderId,
  validateProductFolderTarget,
  validateProductFolderMove,
} from '../../shared/productFolders';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { getEntityJsonPath, getEntityImagesDir } from './paths';
import { readJson, writeJsonAtomic, withJsonLock } from './atomicJson';

export interface StoredEntity {
  id: string;
  name: string;
  referenceImages: string[];
  thumbnailUrl: string | null;
  createdAt: string;
  productType?: string;
  folderId?: string | null;
  /** The primary entry's ID; references remain stored on their original entry. */
  pairedWith?: string;
  /** Original upload names in the same order as referenceImages; legacy entries lack this. */
  originalFilenames?: string[];
}

export interface ProductPair {
  primaryId: string;
  secondaryId: string;
  primaryPhotos: string[];
  secondaryPhotos: string[];
}

interface EntityStore {
  entities: StoredEntity[];
  productFolders?: ProductFolder[];
}

function readStore(entityType: string): EntityStore {
  const path = getEntityJsonPath(entityType);
  if (entityType !== 'products') return readJson<EntityStore>(path, { entities: [] });
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entities: [] };
    throw error;
  }
  const store = JSON.parse(text) as EntityStore;
  if (!store || !Array.isArray(store.entities)) throw new Error('Invalid products store');
  const ids = new Set<string>();
  for (const entity of store.entities) {
    if (
      !entity ||
      typeof entity.name !== 'string' ||
      typeof entity.createdAt !== 'string' ||
      !Array.isArray(entity.referenceImages) ||
      !entity.referenceImages.every((url) => typeof url === 'string') ||
      (entity.originalFilenames !== undefined &&
        (!Array.isArray(entity.originalFilenames) ||
          entity.originalFilenames.length !== entity.referenceImages.length ||
          !entity.originalFilenames.every(
            (name) => typeof name === 'string' && name.length <= 255,
          ))) ||
      (entity.thumbnailUrl !== null && typeof entity.thumbnailUrl !== 'string')
    ) {
      throw new Error('Invalid product record');
    }
    validateProductFolderId(entity.id);
    if (ids.has(entity.id)) throw new Error('Duplicate product ids');
    ids.add(entity.id);
    if (entity.folderId !== undefined) validateProductFolderTarget(entity.folderId);
    if (entity.pairedWith !== undefined) validateProductFolderId(entity.pairedWith);
  }
  const byId = new Map(store.entities.map((entity) => [entity.id, entity]));
  const pairedPrimaries = new Set<string>();
  for (const entity of store.entities) {
    if (entity.pairedWith) {
      const primary = byId.get(entity.pairedWith);
      if (
        !primary ||
        primary.pairedWith ||
        primary.id === entity.id ||
        pairedPrimaries.has(primary.id) ||
        (primary.folderId ?? null) !== (entity.folderId ?? null)
      )
        throw new Error('Invalid product photo pairing');
      pairedPrimaries.add(primary.id);
    }
  }
  if (store.productFolders !== undefined) {
    if (!Array.isArray(store.productFolders)) throw new Error('Invalid product folders');
    const folderIds = new Set<string>();
    const names = new Set<string>();
    for (const folder of store.productFolders) {
      if (!folder || typeof folder.createdAt !== 'string')
        throw new Error('Invalid product folder');
      validateProductFolderId(folder.id);
      const name = normalizeProductFolderName(folder.name).toLowerCase();
      if (folderIds.has(folder.id) || names.has(name)) throw new Error('Duplicate product folders');
      folderIds.add(folder.id);
      names.add(name);
    }
  }
  for (const entity of store.entities) requireFolder(store, entity.folderId);
  return store;
}

function requireFolder(store: EntityStore, folderId: string | null | undefined): void {
  if (folderId !== undefined) validateProductFolderTarget(folderId);
  if (
    folderId !== null &&
    folderId !== undefined &&
    !store.productFolders?.some((folder) => folder.id === folderId)
  ) {
    throw new Error('Product folder not found');
  }
}

// Only on an explicit first folder mutation, never on startup or ordinary edits.
function backupBeforeFolders(store: EntityStore): void {
  const path = getEntityJsonPath('products');
  if (store.productFolders !== undefined || !existsSync(path)) return;
  try {
    copyFileSync(path, `${path}.pre-folders.bak`, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

function backupBeforePairs(): void {
  const path = getEntityJsonPath('products');
  if (!existsSync(path)) return;
  try {
    copyFileSync(path, `${path}.pre-pairs.bak`, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

/** Apply the entire approved review as one locked write, or none of it. */
export async function linkProductPairs(pairs: ProductPair[]): Promise<void> {
  if (!Array.isArray(pairs) || pairs.length === 0 || pairs.length > 500)
    throw new Error('Choose between 1 and 500 product pairs.');
  const path = getEntityJsonPath('products');
  await withJsonLock(path, () => {
    const store = readStore('products');
    const byId = new Map(store.entities.map((entity) => [entity.id, entity]));
    const used = new Set<string>();
    for (const pair of pairs) {
      if (!pair || typeof pair !== 'object') throw new Error('Invalid product pair.');
      validateProductFolderId(pair.primaryId);
      validateProductFolderId(pair.secondaryId);
      const primary = byId.get(pair.primaryId);
      const secondary = byId.get(pair.secondaryId);
      if (
        !primary ||
        !secondary ||
        primary.id === secondary.id ||
        primary.pairedWith ||
        store.entities.some((entity) => entity.pairedWith === secondary.id) ||
        (secondary.pairedWith && secondary.pairedWith !== primary.id) ||
        (primary.folderId ?? null) !== (secondary.folderId ?? null) ||
        secondary.name.trim().toLowerCase() !== `${primary.name.trim().toLowerCase()} 2` ||
        !Array.isArray(pair.primaryPhotos) ||
        !Array.isArray(pair.secondaryPhotos) ||
        pair.primaryPhotos.length !== primary.referenceImages.length ||
        pair.secondaryPhotos.length !== secondary.referenceImages.length ||
        !pair.primaryPhotos.every(
          (url, index) => typeof url === 'string' && url === primary.referenceImages[index],
        ) ||
        !pair.secondaryPhotos.every(
          (url, index) => typeof url === 'string' && url === secondary.referenceImages[index],
        ) ||
        !primary.referenceImages.length ||
        !secondary.referenceImages.length ||
        new Set([...primary.referenceImages, ...secondary.referenceImages]).size > 8 ||
        used.has(primary.id) ||
        used.has(secondary.id) ||
        store.entities.some(
          (entity) => entity.pairedWith === primary.id && entity.id !== secondary.id,
        )
      )
        throw new Error('Product pairs changed. Refresh and review the matches again.');
      used.add(primary.id);
      used.add(secondary.id);
    }
    if (pairs.every((pair) => byId.get(pair.secondaryId)?.pairedWith === pair.primaryId)) return;
    backupBeforePairs();
    for (const pair of pairs) {
      const secondary = byId.get(pair.secondaryId);
      if (secondary) secondary.pairedWith = pair.primaryId;
    }
    writeJsonAtomic(path, store);
  });
}

export async function unlinkProductPair(secondaryId: string): Promise<void> {
  validateProductFolderId(secondaryId);
  const path = getEntityJsonPath('products');
  await withJsonLock(path, () => {
    const store = readStore('products');
    const secondary = store.entities.find((entity) => entity.id === secondaryId);
    if (!secondary?.pairedWith) throw new Error('This product pair is no longer linked.');
    backupBeforePairs();
    delete secondary.pairedWith;
    writeJsonAtomic(path, store);
  });
}

export function listProductFolders(): ProductFolder[] {
  return readStore('products').productFolders ?? [];
}

export async function createProductFolder(name: string): Promise<ProductFolder> {
  name = normalizeProductFolderName(name);
  const path = getEntityJsonPath('products');
  return withJsonLock(path, () => {
    const store = readStore('products');
    const folders = store.productFolders ?? [];
    if (folders.some((folder) => folder.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new Error('Folder name already exists');
    }
    backupBeforeFolders(store);
    const folder = { id: randomUUID(), name, createdAt: new Date().toISOString() };
    store.productFolders = [...folders, folder];
    writeJsonAtomic(path, store);
    return folder;
  });
}

export async function renameProductFolder(id: string, name: string): Promise<ProductFolder> {
  validateProductFolderId(id);
  name = normalizeProductFolderName(name);
  const path = getEntityJsonPath('products');
  return withJsonLock(path, () => {
    const store = readStore('products');
    const folder = store.productFolders?.find((item) => item.id === id);
    if (!folder) throw new Error('Product folder not found');
    if (
      store.productFolders?.some(
        (item) => item.id !== id && item.name.trim().toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new Error('Folder name already exists');
    }
    folder.name = name;
    writeJsonAtomic(path, store);
    return folder;
  });
}

export async function moveProducts(productIds: string[], folderId: string | null): Promise<void> {
  validateProductFolderMove(productIds, folderId);
  const path = getEntityJsonPath('products');
  await withJsonLock(path, () => {
    const store = readStore('products');
    requireFolder(store, folderId);
    const ids = new Set(productIds);
    if (
      store.entities.some(
        (entity) => entity.pairedWith && ids.has(entity.id) !== ids.has(entity.pairedWith),
      )
    )
      throw new Error('Move both entries of a paired product together, or unlink them first.');
    const products = store.entities.filter((entity) => ids.has(entity.id));
    if (products.length !== ids.size) throw new Error('Product not found');
    backupBeforeFolders(store);
    for (const product of products) product.folderId = folderId;
    writeJsonAtomic(path, store);
  });
}

export function listEntities(entityType: string): StoredEntity[] {
  const store = readStore(entityType);
  return [...store.entities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getEntity(entityType: string, id: string): StoredEntity | undefined {
  const store = readStore(entityType);
  return store.entities.find((e) => e.id === id);
}

export function saveEntityImages(
  entityType: string,
  files: { name: string; buffer: Buffer }[],
): string[] {
  const dir = getEntityImagesDir(entityType);
  const urls: string[] = [];

  for (const file of files) {
    const ext = extname(file.name) || '.png';
    const filename = `${randomUUID()}${ext}`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, file.buffer);
    urls.push(`local-file:///entities/${entityType}/${filename}`);
  }

  return urls;
}

export async function addEntity(
  entityType: string,
  name: string,
  referenceImages: string[],
  productType?: string,
  folderId?: string | null,
  originalFilenames?: string[],
): Promise<StoredEntity> {
  if (folderId !== undefined && entityType !== 'products')
    throw new Error('Folders are product-only');
  if (
    originalFilenames &&
    (originalFilenames.length !== referenceImages.length ||
      originalFilenames.some((name) => typeof name !== 'string' || name.length > 255))
  )
    throw new Error('Invalid original filenames');
  const path = getEntityJsonPath(entityType);
  return withJsonLock(path, () => {
    const store = readStore(entityType);
    if (entityType === 'products') requireFolder(store, folderId);
    const entity: StoredEntity = {
      id: randomUUID(),
      name,
      referenceImages,
      thumbnailUrl: referenceImages[0] ?? null,
      createdAt: new Date().toISOString(),
      ...(productType ? { productType } : {}),
      ...(folderId !== undefined ? { folderId } : {}),
      ...(originalFilenames ? { originalFilenames } : {}),
    };
    store.entities.push(entity);
    writeJsonAtomic(path, store);
    return entity;
  });
}

export async function updateEntity(
  entityType: string,
  id: string,
  name: string,
  referenceImages: string[],
  productType?: string,
  newOriginalFilenames?: string[],
): Promise<StoredEntity | null> {
  if (newOriginalFilenames?.some((name) => typeof name !== 'string' || name.length > 255))
    throw new Error('Invalid original filenames');
  const path = getEntityJsonPath(entityType);
  return withJsonLock(path, () => {
    const store = readStore(entityType);
    const index = store.entities.findIndex((e) => e.id === id);
    const existing = index === -1 ? undefined : store.entities[index];
    if (!existing) return null;

    const originalNames = new Map(
      existing.referenceImages.map((url, index) => [
        url,
        existing.originalFilenames?.[index] ?? '',
      ]),
    );
    const addedNames = newOriginalFilenames ?? [];
    const oldUrls = referenceImages.length - addedNames.length;
    if (
      newOriginalFilenames &&
      (oldUrls < 0 || referenceImages.slice(0, oldUrls).some((url) => !originalNames.has(url)))
    )
      throw new Error('Existing product photos changed. Refresh and retry.');
    const updated: StoredEntity = {
      ...existing,
      name,
      referenceImages,
      originalFilenames: newOriginalFilenames
        ? [
            ...referenceImages.slice(0, oldUrls).map((url) => originalNames.get(url) ?? ''),
            ...addedNames,
          ]
        : referenceImages.map((url) => originalNames.get(url) ?? ''),
      thumbnailUrl: referenceImages[0] ?? null,
      ...(productType !== undefined ? { productType } : {}),
    };
    store.entities[index] = updated;
    writeJsonAtomic(path, store);
    return updated;
  });
}

export async function deleteEntity(entityType: string, id: string): Promise<boolean> {
  const path = getEntityJsonPath(entityType);
  return withJsonLock(path, () => {
    const store = readStore(entityType);
    const entity = store.entities.find((e) => e.id === id);
    if (!entity) return false;

    // Delete reference image files
    const dir = getEntityImagesDir(entityType);
    for (const imageUrl of entity.referenceImages) {
      // Extract filename from local-file:///entities/<type>/<filename>
      const parts = imageUrl.split('/');
      const filename = parts[parts.length - 1];
      if (!filename) continue;
      const filePath = join(dir, filename);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }

    store.entities = store.entities.filter((e) => e.id !== id);
    if (entityType === 'products') {
      for (const item of store.entities) {
        if (item.pairedWith === id) delete item.pairedWith;
      }
    }
    writeJsonAtomic(path, store);
    return true;
  });
}
