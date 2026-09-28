import { readFileSync } from 'fs';
import { nativeImage } from 'electron';

/**
 * Crop a close-up out of an already-saved image.
 *
 * This runs in the main process on purpose. Doing it in the renderer would
 * mean drawing the image into a canvas, and any image from a remote provider
 * (fal.ai serves generated images from its own CDN) taints that canvas, making
 * the export throw. Reading the file straight off disk avoids the whole
 * cross-origin question and works identically for every provider.
 */

/** Fraction of the source's shorter edge used for the close-up crop. */
const CLOSE_UP_SCALE = 0.68;
/** How far left of centre to bias the crop, as a fraction of source width. */
const CLOSE_UP_HORIZONTAL_BIAS = 0.16;
/** How far below centre to bias the crop, keeping the front side in frame. */
const CLOSE_UP_VERTICAL_BIAS = 0.03;

export interface CropRegion {
  x: number;
  y: number;
  size: number;
}

/**
 * Square close-up biased left and slightly below centre to show both top detail
 * and the product's front-left side. Always stays inside the source bounds.
 */
export function closeUpRegion(width: number, height: number): CropRegion {
  const size = Math.max(1, Math.round(Math.min(width, height) * CLOSE_UP_SCALE));
  const leftBiased = Math.round((width - size) / 2 - width * CLOSE_UP_HORIZONTAL_BIAS);
  const x = Math.min(Math.max(0, leftBiased), width - size);
  const biased = Math.round((height - size) / 2 + height * CLOSE_UP_VERTICAL_BIAS);
  const y = Math.min(Math.max(0, biased), height - size);
  return { x, y, size };
}

/**
 * Crop a close-up from the image at `path` and return it as a PNG data URL,
 * or null when the file can't be decoded. Callers treat null as "no close-up"
 * rather than failing the whole angle set.
 */
export function cropCloseUpFromFile(path: string): string | null {
  const image = nativeImage.createFromBuffer(readFileSync(path));
  if (image.isEmpty()) return null;

  const { width, height } = image.getSize();
  if (!width || !height) return null;

  const { x, y, size } = closeUpRegion(width, height);
  const cropped = image.crop({ x, y, width: size, height: size });
  if (cropped.isEmpty()) return null;

  return `data:image/png;base64,${cropped.toPNG().toString('base64')}`;
}
