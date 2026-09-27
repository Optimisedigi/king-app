export const MAX_REFERENCE_BYTES = 30 * 1024 * 1024;
export const MAX_REFERENCE_PIXELS = 40_000_000;
export interface ReferenceDimensions {
  width: number;
  height: number;
}
const INVALID = 'Use a valid PNG, JPEG or WebP under 40 megapixels and 16,384 pixels per side.';
function bounded(width: number, height: number): ReferenceDimensions {
  if (!width || !height || width > 16384 || height > 16384 || width * height > MAX_REFERENCE_PIXELS)
    throw new Error(INVALID);
  return { width, height };
}
/** Header/chunk inspection only: never decode pixels to discover an upload's size.
 * Animated references are rejected so the bound also applies to decoded frames.
 * The platform decoder subsequently verifies the actual image encoding.
 */
export function readReferenceDimensions(bytes: Uint8Array): ReferenceDimensions {
  if (bytes.byteLength > MAX_REFERENCE_BYTES) throw new Error('Reference exceeds 30 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, count: number): string =>
    String.fromCharCode(...bytes.subarray(offset, offset + count));
  const u24 = (offset: number): number =>
    view.getUint16(offset, true) + view.getUint8(offset + 2) * 65536;
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  ) {
    // Check size before scanning any compressed payload, including truncated files.
    const dimensions = bounded(view.getUint32(16), view.getUint32(20));
    if (view.getUint32(8) !== 13 || text(12, 4) !== 'IHDR') throw new Error(INVALID);
    let offset = 8;
    let data = false;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset);
      const kind = text(offset + 4, 4);
      const next = offset + 12 + size;
      if (next > bytes.length) throw new Error(INVALID);
      if (kind === 'acTL') throw new Error('Use a still reference photo, not an animated image.');
      if (kind === 'IHDR' && offset !== 8) throw new Error(INVALID);
      if (kind === 'IDAT') data = true;
      if (kind === 'IEND') {
        if (size !== 0 || !data || next !== bytes.length) throw new Error(INVALID);
        return dimensions;
      }
      offset = next;
    }
    throw new Error(INVALID);
  }
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error(INVALID);
    let offset = 12;
    let canvas: ReferenceDimensions | undefined;
    let image: ReferenceDimensions | undefined;
    while (offset + 8 <= bytes.length) {
      const kind = text(offset, 4);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      const next = start + size + (size % 2);
      if (next > bytes.length) throw new Error(INVALID);
      if (kind === 'ANIM' || kind === 'ANMF')
        throw new Error('Use a still reference photo, not an animated image.');
      if (kind === 'VP8X') {
        if (size !== 10 || canvas || offset !== 12) throw new Error(INVALID);
        if (view.getUint8(start) & 2)
          throw new Error('Use a still reference photo, not an animated image.');
        canvas = bounded(u24(start + 4) + 1, u24(start + 7) + 1);
      } else if (kind === 'VP8 ') {
        if (image || size < 10 || text(start + 3, 3) !== '\u009d\u0001\u002a')
          throw new Error(INVALID);
        image = bounded(
          view.getUint16(start + 6, true) & 0x3fff,
          view.getUint16(start + 8, true) & 0x3fff,
        );
      } else if (kind === 'VP8L') {
        if (image || size < 5 || view.getUint8(start) !== 47) throw new Error(INVALID);
        const bits = view.getUint32(start + 1, true);
        image = bounded((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      offset = next;
    }
    if (
      offset !== bytes.length ||
      !image ||
      (canvas && (canvas.width !== image.width || canvas.height !== image.height))
    )
      throw new Error(INVALID);
    return image;
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      if (marker === 255) {
        offset++;
        continue;
      }
      if (marker === 218 || marker === 217) break;
      const size = view.getUint16(offset + 2);
      if (size < 2 || offset + 2 + size > bytes.length) break;
      if (marker !== undefined && [192, 193, 194].includes(marker) && size >= 8)
        return bounded(view.getUint16(offset + 7), view.getUint16(offset + 5));
      offset += size + 2;
    }
  }
  throw new Error(INVALID);
}
