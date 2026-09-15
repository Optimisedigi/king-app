/**
 * Turning a folder of photos into one product per photo.
 *
 * The product name comes from the filename, since that is the only label a
 * bulk upload carries. Names must be unique because the rest of the app keys
 * products by name for the user, and duplicates are rejected on create.
 */

/** Strip the extension, tidy separators and trailing numbering. */
export function nameFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, '');
  const spaced = withoutExtension
    .replace(/[_-]+/g, ' ')
    // "cake (1)" / "cake 1" / "cake copy" are camera or download artefacts.
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+copy\s*\d*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!spaced) return 'Untitled product';

  // Title-case each word so "blueberry cheesecake" reads as a product name.
  return spaced
    .split(' ')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * Append " 2", " 3" … to a name that is already taken, comparing
 * case-insensitively to match how duplicates are rejected on create.
 */
export function uniqueName(desired: string, taken: Set<string>): string {
  const key = (value: string) => value.trim().toLowerCase();
  if (!taken.has(key(desired))) {
    taken.add(key(desired));
    return desired;
  }

  for (let suffix = 2; ; suffix++) {
    const candidate = `${desired} ${suffix}`;
    if (!taken.has(key(candidate))) {
      taken.add(key(candidate));
      return candidate;
    }
  }
}

export interface PlannedProduct {
  name: string;
  file: File;
}

/**
 * Plan one product per file, skipping names that would collide with products
 * that already exist.
 */
export function planBulkProducts(files: File[], existingNames: string[]): PlannedProduct[] {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return files.map((file) => ({
    name: uniqueName(nameFromFilename(file.name), taken),
    file,
  }));
}
