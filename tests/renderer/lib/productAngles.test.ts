import { describe, it, expect } from 'vitest';
import {
  PRODUCT_ANGLES,
  ELEVATED_45_CAMERA,
  ANGLE_SET_SIZE,
  CLOSE_UP_SOURCE_ANGLE_ID,
  CONSISTENCY_CLAUSE,
  buildAnglePrompt,
  buildAngleShots,
} from '../../../src/renderer/src/lib/productAngles';
import { COMPOSITION_CAMERAS } from '../../../src/renderer/src/lib/compositionPrompt';

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

  it('asks for an oblique tabletop perspective only in the elevated shot', () => {
    const elevated = PRODUCT_ANGLES.find((angle) => angle.id === 'elevated-45');
    const eyeLevel = PRODUCT_ANGLES.find((angle) => angle.id === 'eye-level');
    expect(elevated?.instruction).toContain('slightly off-axis side position');
    expect(elevated?.instruction).toContain('boundary is visible');
    expect(elevated?.instruction).toContain('downward toward the right');
    expect(elevated?.instruction).toContain('Keep the product and tabletop physically level');
    expect(elevated?.instruction).toContain('follow that reference instead');
    expect(eyeLevel?.instruction).not.toContain('downward toward the right');
    expect(COMPOSITION_CAMERAS['elevated-45']).toBe(ELEVATED_45_CAMERA);
    expect(ELEVATED_45_CAMERA).toContain('downward toward the right');
  });
});

describe('template-aware angles', () => {
  it('leaves template camera and framing assembly to the role-aware builder', () => {
    expect(buildAngleShots('  Cake  ', true)).toEqual([
      { angleId: 'eye-level', prompt: 'Cake' },
      { angleId: 'elevated-45', prompt: 'Cake' },
    ]);
    expect(CLOSE_UP_SOURCE_ANGLE_ID).toBe('elevated-45');
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
