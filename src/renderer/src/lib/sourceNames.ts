/**
 * The name of the photo a generated image was made from, so an export can be
 * named after the file the user originally added rather than a prompt.
 */

/** The parts of a saved product (or character) this needs. */
export interface NamedReferenceSource {
  name: string;
  referenceImages: string[];
  /** Original file names, parallel to `referenceImages`; '' where unknown. */
  originalFilenames?: string[];
}

/**
 * Browsers give a copied screenshot or web image a stand-in name such as
 * "image.png" rather than a real file name. Those aren't worth keeping.
 */
export function isGenericClipboardName(filename: string): boolean {
  return /^(image|blob|clipboard|pasted[ -]?image)(\s*\(\d+\))?\.[a-z0-9]+$/i.test(filename.trim());
}

/** "blueberry cheesecake.webp" → "blueberry cheesecake". Keeps dotfiles intact. */
export function fileStem(filename: string): string {
  const trimmed = filename.trim();
  const stem = trimmed.replace(/\.[^./\\]+$/, '');
  return stem || trimmed;
}

/**
 * Name for the first reference photo that can be identified:
 * - a photo added in the prompt box → its file name;
 * - a saved product photo → its stored original file name, or, when none was
 *   recorded, the product's own name.
 * Returns undefined when no reference photo can be identified.
 */
export function sourceNameForReferences(
  referenceUrls: readonly string[],
  sources: readonly NamedReferenceSource[],
  addedFileNames: ReadonlyMap<string, string> = new Map(),
): string | undefined {
  for (const url of referenceUrls) {
    const added = addedFileNames.get(url);
    if (added && fileStem(added)) return fileStem(added);

    for (const source of sources) {
      const index = source.referenceImages.indexOf(url);
      if (index === -1) continue;
      const original = source.originalFilenames?.[index];
      if (original && fileStem(original)) return fileStem(original);
      if (source.name.trim()) return source.name.trim();
    }
  }
  return undefined;
}
