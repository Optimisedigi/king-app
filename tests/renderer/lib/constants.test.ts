import { describe, it, expect } from 'vitest';
import {
  MAX_REFERENCE_IMAGES,
  MAX_IMAGE_SIZE_MB,
  MAX_IMAGES_PER_GENERATION,
  aspectRatioOptions,
  qualityOptions,
  outputFormatOptions,
} from '@/lib/constants/image-form';

describe('image-form constants', () => {
  describe('numeric constants', () => {
    it('caps reference images at 8', () => {
      expect(MAX_REFERENCE_IMAGES).toBe(8);
    });

    it('caps each reference image at 30 MB', () => {
      expect(MAX_IMAGE_SIZE_MB).toBe(30);
    });

    it('caps each generation at 4 images', () => {
      expect(MAX_IMAGES_PER_GENERATION).toBe(4);
    });
  });

  describe('GPT Image options', () => {
    it('includes auto and the full supported preset ladder', () => {
      const values = aspectRatioOptions.map((option) => option.value);
      expect(values).toContain('auto');
      expect(values).toContain('1:1');
      expect(values).toContain('4:5');
      expect(values).toContain('21:9');
    });

    it('contains every GPT Image quality', () => {
      expect(qualityOptions.map((option) => option.value)).toEqual([
        'auto',
        'low',
        'medium',
        'high',
      ]);
    });
  });

  describe.each([
    ['aspect ratio', aspectRatioOptions],
    ['quality', qualityOptions],
    ['output format', outputFormatOptions],
  ])('%s options', (_name, options) => {
    it('is non-empty and contains labelled values', () => {
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        expect(typeof option.value).toBe('string');
        expect(typeof option.label).toBe('string');
      }
    });
  });

  it('supports every OpenAI output format exposed by the app', () => {
    expect(outputFormatOptions.map((option) => option.value)).toEqual(['png', 'jpeg', 'webp']);
  });
});
