import { describe, expect, it } from 'vitest';
import { validCrop, validGuides, validateTemplateDraft } from '../../../src/shared/shootTemplates';

describe('composition geometry', () => {
  it('accepts normalized guides and optional boundary', () => {
    expect(validGuides({ centreX: 0.5, baseY: 0.8, width: 0.6 })).toBe(true);
    expect(validGuides({ centreX: 0.5, baseY: 0.8, width: 0.6, boundaryY: 0.4 })).toBe(true);
  });
  it('accepts an angled boundary only alongside its left edge', () => {
    const base = { centreX: 0.5, baseY: 0.8, width: 0.6 };
    expect(validGuides({ ...base, boundaryY: 0.5, boundaryRightY: 0.3 })).toBe(true);
    expect(validGuides({ ...base, boundaryRightY: 0.3 })).toBe(false);
    expect(validGuides({ ...base, boundaryY: 0.5, boundaryRightY: 1.2 })).toBe(false);
    expect(validGuides({ ...base, boundaryY: 0.5, boundaryRightY: NaN })).toBe(false);
  });
  it.each([NaN, Infinity, -0.1, 1.1])('rejects invalid coordinates %s', (value) => {
    expect(validGuides({ centreX: value, baseY: 0.8, width: 0.6 })).toBe(false);
    expect(validCrop({ x: value, y: 0, width: 0.5, height: 1 })).toBe(false);
  });
  it('rejects guides and crops outside the frame', () => {
    expect(validGuides({ centreX: 0.1, baseY: 0.8, width: 0.6 })).toBe(false);
    expect(validCrop({ x: 0.6, y: 0, width: 0.5, height: 1 })).toBe(false);
    expect(validCrop({ x: 0, y: 0, width: 0, height: 1 })).toBe(false);
  });
  it('rejects unsupported angles and automatic aspect', () => {
    expect(validateTemplateDraft({ name: 'Test', aspectRatio: 'auto', angles: {} }).ok).toBe(false);
    expect(
      validateTemplateDraft({ name: 'Test', aspectRatio: '1:1', angles: { overhead: {} } }).ok,
    ).toBe(false);
  });
});
