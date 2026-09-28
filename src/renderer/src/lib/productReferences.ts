import type { EntityData } from '@/types/electron';

/** Explicitly selected entries describe one product, never an inferred batch or name-based pair. */
export function collectProductReferences(
  products: readonly EntityData[],
  selectedIds: readonly string[],
): string[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const references = new Set<string>();
  for (const id of selectedIds) {
    const product = byId.get(id);
    if (!product)
      throw new Error(
        'A selected product entry is unavailable. Refresh products and select it again.',
      );
    if (!product.referenceImages.length)
      throw new Error(`Product "${product.name}" has no reference photos.`);
    for (const url of product.referenceImages) references.add(url);
  }
  return [...references];
}
