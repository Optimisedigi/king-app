import { describe, expect, it } from 'vitest';
import { MAX_REFERENCE_BYTES, readReferenceDimensions } from '../../../src/shared/referenceImage';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=',
  'base64',
);
function webp(kind: string, payload: Buffer): Buffer {
  const chunk = Buffer.alloc(8 + payload.length + (payload.length % 2));
  chunk.write(kind);
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  const header = Buffer.alloc(12);
  header.write('RIFF');
  header.writeUInt32LE(chunk.length + 4, 4);
  header.write('WEBP', 8);
  return Buffer.concat([header, chunk]);
}
describe('pre-decode reference bounds', () => {
  it('reads PNG dimensions without decoding', () => {
    expect(readReferenceDimensions(png)).toEqual({ width: 1, height: 1 });
  });
  it('reads a JPEG frame header', () => {
    const header = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 24, 0, 32, 1, 1, 17, 0]);
    expect(readReferenceDimensions(header)).toEqual({ width: 32, height: 24 });
  });
  it('reads lossy and lossless WebP frame headers', () => {
    const lossy = Buffer.from([0, 0, 0, 157, 1, 42, 32, 0, 24, 0]);
    expect(readReferenceDimensions(webp('VP8 ', lossy))).toEqual({ width: 32, height: 24 });
    const lossless = Buffer.alloc(5);
    lossless[0] = 47;
    lossless.writeUInt32LE(31 | (23 << 14), 1);
    expect(readReferenceDimensions(webp('VP8L', lossless))).toEqual({ width: 32, height: 24 });
  });
  it.each([
    [100000, 100000],
    [10000, 10000],
    [16385, 1],
  ])('rejects excessive dimensions %s × %s from headers', (width, height) => {
    const bytes = Buffer.from(png);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    expect(() => readReferenceDimensions(bytes)).toThrow('40 megapixels');
  });
  it('rejects truncated or unsupported bytes and bounds byte count', () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from('not an image'), png.subarray(0, 24)])
      expect(() => readReferenceDimensions(bytes)).toThrow();
    expect(() => readReferenceDimensions(new Uint8Array(MAX_REFERENCE_BYTES + 1))).toThrow('30 MB');
  });
  it('rejects animations before a decoder can allocate multiple frames', () => {
    const chunk = Buffer.alloc(20);
    chunk.writeUInt32BE(8);
    chunk.write('acTL', 4);
    expect(() =>
      readReferenceDimensions(Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)])),
    ).toThrow('still reference');
    const extended = Buffer.alloc(10);
    extended[0] = 2;
    expect(() => readReferenceDimensions(webp('VP8X', extended))).toThrow('still reference');
  });
  it('does not trust WebP canvas dimensions without a matching bitstream', () => {
    const canvas = webp('VP8X', Buffer.alloc(10));
    const data = webp('VP8 ', Buffer.from([0, 0, 0, 157, 1, 42, 32, 0, 24, 0]));
    const combined = Buffer.concat([canvas, data.subarray(12)]);
    combined.writeUInt32LE(combined.length - 8, 4);
    expect(() => readReferenceDimensions(combined)).toThrow();
  });
});
