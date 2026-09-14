/**
 * Crop a region out of an already-generated image.
 *
 * Used for the close-up in an angle set: cropping guarantees the product is
 * pixel-identical to the wider shot, which no amount of prompting can. Source
 * images are large (multi-megapixel), so a crop still lands at a usable size.
 */

/** Fraction of the source's shorter edge used for the close-up crop. */
const CLOSE_UP_SCALE = 0.55;

/**
 * Cut a square close-up from the upper-middle of the image, where the product
 * detail usually sits, and return it as a PNG data URL.
 *
 * Resolves to null if the image can't be loaded or the browser refuses to
 * export the canvas — callers should treat that as "no close-up" rather than
 * failing the whole set.
 */
export async function cropCloseUp(source: string): Promise<string | null> {
  const image = await loadImage(source);
  if (!image) return null;

  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height) return null;

  const size = Math.round(Math.min(width, height) * CLOSE_UP_SCALE);
  // Horizontally centred; biased above centre so a product sitting on a
  // surface keeps its detail in frame rather than the empty foreground.
  const sourceX = Math.round((width - size) / 2);
  const sourceY = Math.round(Math.max(0, (height - size) / 2 - height * 0.08));

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sourceX, sourceY, size, size, 0, 0, size, size);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function loadImage(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}
