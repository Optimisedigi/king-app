import type { EntityData } from '@/types/electron';
import type { ProductFolder } from '../../../shared/productFolders';
import type { GenerationTarget } from './generationJobs';
import { MAX_REFERENCE_IMAGES } from './constants/image-form';

export const ALL_PRODUCTS_VALUE = 'product:all';
export const SELECTED_GROUPS_VALUE = 'group:selected';
export interface ManualProductGroup {
  ids: string[];
  referenceImages: string[];
}
export const UNFILED_PRODUCTS_VALUE = 'folder:unfiled';

export function isProductBatch(value: string): boolean {
  return (
    value === ALL_PRODUCTS_VALUE || value === SELECTED_GROUPS_VALUE || value.startsWith('folder:')
  );
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

/** Snapshot only explicitly selected primary groups, including their linked entries. */
export function snapshotSelectedProductTargets(
  selectedIds: readonly string[],
  products: readonly EntityData[],
  usesComposition: boolean,
  entryGroups: readonly ManualProductGroup[] = [],
): { scope: string; targets: GenerationTarget[] } {
  if (!selectedIds.length && !entryGroups.length)
    throw new Error('Select at least one product group before generating.');
  const selected = new Set(selectedIds);
  if (
    selected.size !== selectedIds.length ||
    selectedIds.some((id) => !products.some((p) => p.id === id && !p.pairedWith))
  )
    throw new Error('Selected product groups have changed. Refresh choices and select them again.');
  const members = products.filter(
    (product) =>
      selected.has(product.id) || (product.pairedWith && selected.has(product.pairedWith)),
  );
  const targets = selected.size
    ? snapshotProductFolderTargets(ALL_PRODUCTS_VALUE, members, [], usesComposition).targets
    : [];
  if (targets.length !== selected.size)
    throw new Error(
      'Selected product groups have changed or lack photos. Refresh choices before generating.',
    );
  const used = new Set(members.map((product) => product.id));
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const group of entryGroups) {
    if (!group.ids.length)
      throw new Error('A selected group has no entries. Remove it before generating.');
    const entries = group.ids.map((id) => {
      if (used.has(id)) throw new Error('An entry is already in another selected group.');
      const entry = byId.get(id);
      if (!entry)
        throw new Error('Selected product entries have changed. Refresh choices and regroup them.');
      used.add(id);
      return entry;
    });
    if (
      entries.some((entry) => entry.pairedWith && !group.ids.includes(entry.pairedWith)) ||
      entries.some((entry) =>
        products.some((other) => other.pairedWith === entry.id && !group.ids.includes(other.id)),
      )
    )
      throw new Error(
        'A linked entry is missing from its group. Refresh choices and regroup them.',
      );
    const available = new Set(entries.flatMap((entry) => entry.referenceImages));
    const referenceImages = [...new Set(group.referenceImages)];
    const max = usesComposition ? 7 : MAX_REFERENCE_IMAGES;
    if (!referenceImages.length || referenceImages.length > max)
      throw new Error(`Group "${entries[0]?.name}" needs 1–${max} photos. No images were queued.`);
    if (
      referenceImages.length !== group.referenceImages.length ||
      referenceImages.some((url) => !available.has(url))
    )
      throw new Error('Selected product photos have changed. Refresh choices and regroup them.');
    const first = entries[0];
    if (!first) throw new Error('A selected group has no entries.');
    targets.push({
      key: first.id,
      label: entries.map((entry) => entry.name).join(' + '),
      referenceImages,
    });
  }
  const count = selected.size + entryGroups.length;
  return {
    scope: `${count} selected product ${count === 1 ? 'group' : 'groups'}`,
    targets,
  };
}
