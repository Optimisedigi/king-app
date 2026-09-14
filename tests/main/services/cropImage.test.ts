import { describe, it, expect, vi } from 'vitest';

// `closeUpRegion` is pure geometry, but the module it lives in imports
// `nativeImage` for the actual crop.
vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: vi.fn() },
}));

import { closeUpRegion } from '../../../src/main/services/cropImage';

describe('closeUpRegion', () => {
  const sizes: Array<[number, number]> = [
    [1024, 1024],
    [1536, 1024],
    [1024, 1536],
    [3840, 2160],
    [2160, 3840],
    [17, 9],
    [1, 1],
  ];

  it('always stays inside the source bounds', () => {
    for (const [width, height] of sizes) {
      const { x, y, size } = closeUpRegion(width, height);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + size).toBeLessThanOrEqual(width);
      expect(y + size).toBeLessThanOrEqual(height);
    }
  });

  it('produces a square of at least one pixel', () => {
    for (const [width, height] of sizes) {
      const { size } = closeUpRegion(width, height);
      expect(size).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(size)).toBe(true);
    }
  });

  it('crops a zoomed-in region, never the whole image', () => {
    const { size } = closeUpRegion(2000, 2000);
    expect(size).toBeLessThan(2000);
    expect(size / 2000).toBeCloseTo(0.55, 2);
  });

  it('centres the crop horizontally', () => {
    const width = 2000;
    const { x, size } = closeUpRegion(width, 1000);
    expect(x).toBe(Math.round((width - size) / 2));
  });

  it('biases the crop above centre so surface detail stays in frame', () => {
    const height = 2000;
    const { y, size } = closeUpRegion(2000, height);
    expect(y).toBeLessThan(Math.round((height - size) / 2));
  });

  it('keeps the crop on-image for extreme aspect ratios', () => {
    for (const [width, height] of [
      [4000, 500],
      [500, 4000],
      [10000, 64],
    ] as Array<[number, number]>) {
      const { x, y, size } = closeUpRegion(width, height);
      expect(size).toBeLessThanOrEqual(Math.min(width, height));
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + size).toBeLessThanOrEqual(height);
      expect(x + size).toBeLessThanOrEqual(width);
    }
  });

  it('returns integer coordinates a pixel crop can use', () => {
    for (const [width, height] of sizes) {
      const { x, y } = closeUpRegion(width, height);
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    }
  });
});
