export interface ProductFolder {
  id: string;
  name: string;
  createdAt: string;
}

export const MAX_PRODUCT_FOLDER_NAME_LENGTH = 80;
export const MAX_PRODUCT_FOLDER_MOVE = 1000;

export function validateProductFolderId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !id.trim() || id.length > 200) {
    throw new Error('Invalid product folder or product id');
  }
}

export function validateProductFolderTarget(id: unknown): asserts id is string | null {
  if (id !== null) validateProductFolderId(id);
}

export function normalizeProductFolderName(name: unknown): string {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.trim().length > MAX_PRODUCT_FOLDER_NAME_LENGTH
  ) {
    throw new Error('Folder name must contain 1–80 characters');
  }
  return name.trim();
}

export function validateProductFolderMove(
  ids: unknown,
  folderId: unknown,
): asserts ids is string[] {
  validateProductFolderTarget(folderId);
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_PRODUCT_FOLDER_MOVE) {
    throw new Error('Move requires 1–1000 product ids');
  }
  ids.forEach(validateProductFolderId);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate product ids');
}
