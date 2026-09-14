/**
 * Fixed camera angles for shooting one product from several viewpoints.
 *
 * Each angle is generated as its own request from the SAME reference photo —
 * never by chaining a generated image — so the product can't drift between
 * shots. Only the camera instruction changes; everything else in the prompt,
 * including `CONSISTENCY_CLAUSE`, is identical across the set.
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
      'Camera raised to a 45-degree elevated angle looking down towards the product. ' +
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
 * Appended to every angle in a set. This is what actually keeps the product
 * identical between shots — the angle instructions only move the camera.
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
 * camera move, then the consistency lock.
 */
export function buildAnglePrompt(basePrompt: string, angle: ProductAngle): string {
  return `${basePrompt.trim()}\n\n${angle.instruction}\n\n${CONSISTENCY_CLAUSE}`;
}

/** Build the full ordered set of shots for one product photo. */
export function buildAngleShots(basePrompt: string): AngleShot[] {
  return PRODUCT_ANGLES.map((angle) => ({
    angleId: angle.id,
    prompt: buildAnglePrompt(basePrompt, angle),
  }));
}
