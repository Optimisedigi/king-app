import { describe, it, expect } from 'vitest';
import {
  PRODUCT_ANGLES,
  ANGLE_SET_SIZE,
  CLOSE_UP_SOURCE_ANGLE_ID,
  CONSISTENCY_CLAUSE,
  buildAnglePrompt,
} from '@/lib/productAngles';

describe('product angles', () => {
  it('defines a unique id and non-empty instruction for every angle', () => {
    const ids = PRODUCT_ANGLES.map((angle) => angle.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const angle of PRODUCT_ANGLES) {
      expect(angle.label.trim()).not.toBe('');
      expect(angle.instruction.trim()).not.toBe('');
    }
  });

  it('counts the cropped close-up on top of the generated angles', () => {
    expect(ANGLE_SET_SIZE).toBe(PRODUCT_ANGLES.length + 1);
  });

  it('crops the close-up from an angle that is actually generated', () => {
    expect(PRODUCT_ANGLES.some((angle) => angle.id === CLOSE_UP_SOURCE_ANGLE_ID)).toBe(true);
  });

  it('does not generate a close-up angle, since it is cropped instead', () => {
    expect(PRODUCT_ANGLES.some((angle) => angle.id === 'close-up')).toBe(false);
  });
});

describe('buildAnglePrompt', () => {
  const base = 'A chocolate profiterole cake on a brown backdrop';

  it('keeps the user prompt and appends the angle instruction', () => {
    const angle = PRODUCT_ANGLES[0]!;
    const prompt = buildAnglePrompt(base, angle);
    expect(prompt).toContain(base);
    expect(prompt).toContain(angle.instruction);
  });

  it('applies the same consistency clause to every angle', () => {
    for (const angle of PRODUCT_ANGLES) {
      expect(buildAnglePrompt(base, angle)).toContain(CONSISTENCY_CLAUSE);
    }
  });

  it('differs between angles only by the camera instruction', () => {
    const prompts = PRODUCT_ANGLES.map((angle) => buildAnglePrompt(base, angle));
    expect(new Set(prompts).size).toBe(PRODUCT_ANGLES.length);

    const stripped = PRODUCT_ANGLES.map((angle, index) =>
      prompts[index]!.replace(angle.instruction, ''),
    );
    expect(new Set(stripped).size).toBe(1);
  });

  it('trims surrounding whitespace from the user prompt', () => {
    expect(buildAnglePrompt('  spaced out  ', PRODUCT_ANGLES[0]!)).toMatch(/^spaced out\n/);
  });
});
