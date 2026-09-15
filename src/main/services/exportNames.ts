import { extname } from 'path';

/**
 * Filenames for a bulk export.
 *
 * Each file is named from the caller-supplied label — currently the image's
 * prompt, which for batch and angle-set runs already begins with the product
 * name. That text is user data, so it is sanitised into a safe, flat filename
 * with no path separators before it reaches the filesystem.
 */

/** Windows reserves these device names regardless of extension. */
const RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

const MAX_STEM_LENGTH = 80;

/**
 * Reduce arbitrary text to a safe filename stem: no separators, no control
 * characters, no leading dots, and never a reserved device name.
 */
export function safeFileStem(value: string, fallback = 'image'): string {
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- strip control characters
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Trailing dots and spaces are stripped by Windows; do it ourselves so the
    // name we report matches the name on disk.
    .replace(/[. ]+$/, '')
    .slice(0, MAX_STEM_LENGTH)
    .replace(/[. ]+$/, '');

  if (!cleaned || /^\.+$/.test(cleaned)) return fallback;
  if (RESERVED.has(cleaned.toLowerCase())) return `${cleaned}-file`;
  return cleaned;
}

/** Extension from a stored filename, defaulting to .png. */
export function extensionFor(filename: string | undefined): string {
  const ext = filename ? extname(filename).toLowerCase() : '';
  return /^\.(png|jpe?g|webp)$/.test(ext) ? ext : '.png';
}

/**
 * Pick a filename that isn't already used in this export, appending -2, -3 …
 * `used` is mutated so repeated calls stay unique within one run.
 */
export function uniqueFilename(stem: string, extension: string, used: Set<string>): string {
  const key = (name: string) => name.toLowerCase();

  let candidate = `${stem}${extension}`;
  if (!used.has(key(candidate))) {
    used.add(key(candidate));
    return candidate;
  }

  for (let suffix = 2; ; suffix++) {
    candidate = `${stem}-${suffix}${extension}`;
    if (!used.has(key(candidate))) {
      used.add(key(candidate));
      return candidate;
    }
  }
}
