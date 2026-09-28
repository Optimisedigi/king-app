/**
 * Fixed camera angles for shooting one product from several viewpoints.
 *
 * Each angle is generated independently from the original product references.
 * References and instructions guide identity, but cannot guarantee consistency.
 * Composition templates optionally supply a separate framing reference.
 *
 * The close-up is not in this list: it is cropped from a generated shot, which
 * guarantees an identical product instead of merely asking for one.
 */
export interface ProductAngle {
  id: string;
  /** Short label shown in the UI. */
  label: string;
  /** Camera instruction appended to the user's prompt. */
  instruction: string;
}

export const ELEVATED_45_CAMERA =
  'Camera raised to a 45-degree elevated angle above the tabletop plane, halfway between eye level and directly overhead, aimed down at the product centre. ' +
  'Show both the top surface and front face with consistent elevation across products, even when their heights or decorations differ. ' +
  'Do not substitute an eye-level or overhead view. Product reference photos define identity, not camera elevation.';

export const PRODUCT_ANGLES: ProductAngle[] = [
  {
    id: 'eye-level',
    label: 'Eye level',
    instruction:
      'Camera at eye level with the product, lens square to the front face and the horizon line level. ' +
      'Full product in frame, centred, with generous negative space around it. ' +
      'The product sits on a completely flat surface.',
  },
  {
    id: 'elevated-45',
    label: '45° above',
    instruction:
      ELEVATED_45_CAMERA +
      ' ' +
      'Full product in frame, centred, with generous negative space around it, ' +
      'showing both the top surface and the front side of the product.',
  },
];

/**
 * The close-up is produced by cropping the 45-degree shot rather than by
 * generating a third image: a crop is pixel-identical to the wider shot, so
 * the product cannot drift, and the sources are large enough to stay sharp.
 */
export const CLOSE_UP_SOURCE_ANGLE_ID = 'elevated-45';
export const CLOSE_UP_LABEL = 'Close-up (cropped)';

/** Total images an angle set produces: one per generated angle, plus the crop. */
export const ANGLE_SET_SIZE = PRODUCT_ANGLES.length + 1;

/**
 * Default guidance for an angle set without a composition template.
 * This requests consistency; independent model calls may still vary.
 */
export const CONSISTENCY_CLAUSE =
  'This is the exact same physical product as the reference image in every shot: ' +
  'identical shape, proportions, colour, finish, decoration, packaging and any ' +
  'text or logo, reproduced exactly as shown. Keep the same lighting setup, ' +
  'background, surface and colour grading. Change only the camera position and ' +
  'framing described above. Do not restyle, redesign, garnish, add or remove anything.';

/**
 * One request in an angle set. Carrying the angle id alongside the prompt
 * means the caller can tell which shot came back without relying on the two
 * lists staying in the same order.
 */
export interface AngleShot {
  angleId: string;
  prompt: string;
}

/**
 * Build the full prompt for one angle: the user's creative direction, then the
 * camera move, then consistency guidance.
 */
export function buildAnglePrompt(
  basePrompt: string,
  angle: ProductAngle,
  composition = false,
): string {
  if (composition) return basePrompt.trim(); // Template assembly supplies camera, identity and framing together.
  return `${basePrompt.trim()}\n\n${angle.instruction}\n\n${CONSISTENCY_CLAUSE}`;
}

/** Build the full ordered set of shots for one product photo. */
export function buildAngleShots(basePrompt: string, composition = false): AngleShot[] {
  return PRODUCT_ANGLES.map((angle) => ({
    angleId: angle.id,
    prompt: buildAnglePrompt(basePrompt, angle, composition),
  }));
}
