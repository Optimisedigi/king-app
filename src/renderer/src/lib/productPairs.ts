import type { EntityData } from '@/types/electron';

export interface ProductPair {
  primaryId: string;
  secondaryId: string;
  primaryPhotos: string[];
  secondaryPhotos: string[];
}

/** Suggestions only. A person must approve them before they affect a batch. */
export function suggestProductPairs(products: readonly EntityData[]): ProductPair[] {
  const available = products.filter((product) => !product.pairedWith);
  const linkedPrimaries = new Set(products.map((product) => product.pairedWith).filter(Boolean));
  const byId = new Map(products.map((product) => [product.id, product]));
  const byName = new Map<string, EntityData[]>();
  for (const product of available) {
    const key = product.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), product]);
  }
  const suggestions: ProductPair[] = [];
  for (const secondary of available) {
    const match = /^(.+?) 2$/i.exec(secondary.name.trim());
    if (!match) continue;
    const candidates = byName.get(match[1]!.toLowerCase()) ?? [];
    if (candidates.length !== 1) continue;
    const primary = candidates[0];
    if (
      !primary ||
      primary.id === secondary.id ||
      linkedPrimaries.has(primary.id) ||
      linkedPrimaries.has(secondary.id) ||
      (primary.folderId ?? null) !== (secondary.folderId ?? null) ||
      !primary.referenceImages.length ||
      !secondary.referenceImages.length
    )
      continue;
    suggestions.push({
      primaryId: primary.id,
      secondaryId: secondary.id,
      primaryPhotos: [...primary.referenceImages],
      secondaryPhotos: [...secondary.referenceImages],
    });
  }
  const used = new Set<string>();
  return suggestions
    .sort(
      (a, b) =>
        (byId.get(a.primaryId)?.name.length ?? 0) - (byId.get(b.primaryId)?.name.length ?? 0) ||
        a.primaryId.localeCompare(b.primaryId),
    )
    .filter((pair) => {
      if (used.has(pair.primaryId) || used.has(pair.secondaryId)) return false;
      used.add(pair.primaryId);
      used.add(pair.secondaryId);
      return true;
    });
}
