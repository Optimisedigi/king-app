import type { EntityData } from '@/types/electron';
import type { ProductFolder } from '../../../shared/productFolders';
import type { GenerationTarget } from './generationJobs';
import { MAX_REFERENCE_IMAGES } from './constants/image-form';

export const ALL_PRODUCTS_VALUE = 'product:all';
export const UNFILED_PRODUCTS_VALUE = 'folder:unfiled';

export function isProductBatch(value: string): boolean {
  return value === ALL_PRODUCTS_VALUE || value.startsWith('folder:');
}

/** Resolve a fresh membership snapshot by ID, never by display name. */
export function snapshotProductFolderTargets(
  selection: string,
  products: readonly EntityData[],
  folders: readonly ProductFolder[],
  usesComposition: boolean,
): { scope: string; targets: GenerationTarget[] } {
  let members: readonly EntityData[];
  let scope: string;
  if (selection === ALL_PRODUCTS_VALUE) {
    members = products;
    scope = 'All products';
  } else if (selection === UNFILED_PRODUCTS_VALUE) {
    members = products.filter(
      (product) => product.folderId === null || product.folderId === undefined,
    );
    scope = 'Unfiled products';
  } else {
    const folder = selection.startsWith('folder:')
      ? folders.find((entry) => entry.id === selection.slice('folder:'.length))
      : undefined;
    if (!folder)
      throw new Error(
        'This product folder is unavailable or deleted. Refresh folders and choose another scope.',
      );
    members = products.filter((product) => product.folderId === folder.id);
    scope = `Folder: ${folder.name}`;
  }
  if (!members.length)
    throw new Error(`${scope} is empty. Add or move products into this scope first.`);
  const byId = new Map(members.map((product) => [product.id, product]));
  const secondaries = new Map<string, EntityData>();
  for (const member of members) {
    if (!member.pairedWith) continue;
    if (!byId.has(member.pairedWith) || secondaries.has(member.pairedWith))
      throw new Error(
        'Product pairing changed. Refresh products and review pairs before generating.',
      );
    secondaries.set(member.pairedWith, member);
  }
  const targets = members
    .filter((product) => !product.pairedWith)
    .filter(
      (product) =>
        usesComposition || product.referenceImages.length > 0 || secondaries.has(product.id),
    )
    .map((product) => {
      const secondary = secondaries.get(product.id);
      const referenceImages = secondary
        ? [...new Set([...product.referenceImages, ...secondary.referenceImages])]
        : [...product.referenceImages];
      if (
        secondary &&
        (!product.referenceImages.length ||
          !secondary.referenceImages.length ||
          referenceImages.length > (usesComposition ? 7 : MAX_REFERENCE_IMAGES))
      )
        throw new Error(
          `Paired product "${product.name}" needs photos from both entries and at most ${usesComposition ? 7 : MAX_REFERENCE_IMAGES} references. No images were queued.`,
        );
      return {
        key: product.id,
        label: product.name,
        referenceImages:
          secondary || usesComposition
            ? referenceImages
            : referenceImages.slice(0, MAX_REFERENCE_IMAGES),
      };
    });
  if (!targets.length)
    throw new Error(
      `${scope}: none of these products have reference photos yet. Add photos before generating.`,
    );
  return { scope, targets };
}
