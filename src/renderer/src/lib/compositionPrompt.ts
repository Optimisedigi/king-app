import {
  validateTemplate,
  type ShootAngle,
  type ShootTemplate,
} from '../../../shared/shootTemplates';

export const COMPOSITION_CAMERAS: Record<ShootAngle, string> = {
  'eye-level':
    'Camera at eye level with the product, lens square to the front face and horizon level.',
  'elevated-45':
    'Camera raised to a 45-degree elevated angle looking down, showing the top surface and front side.',
};
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
export function buildCompositionRequest(
  basePrompt: string,
  productReferences: readonly string[],
  template: ShootTemplate,
  angle: ShootAngle,
  referenceAngle: ShootAngle = angle,
): { prompt: string; referenceImages: string[] } {
  const validated = validateTemplate(template);
  if (!validated.ok || template.archivedAt)
    throw new Error('Composition template is invalid or archived.');
  if (!productReferences.length)
    throw new Error('Add at least one product photo when using composition.');
  if (productReferences.length > 7)
    throw new Error('Composition allows at most 7 product photos plus one composition reference.');
  const settings = template.angles[referenceAngle];
  if (!settings)
    throw new Error(
      `Add a ${referenceAngle} composition reference, or explicitly use the same reference in the editor.`,
    );
  const { guides } = settings;
  const count = productReferences.length;
  const roles = `${count === 1 ? 'Image 1 defines' : `Images 1–${count} define`} the product. Image ${count + 1} defines composition, camera framing, background, surface and light only. Do not copy its product, decoration, branding or text.`;
  const framing = `In the final ${template.aspectRatio} frame, place the product centre at X ${percent(guides.centreX)}, its base at Y ${percent(guides.baseY)} measured from the top, and its apparent width at ${percent(guides.width)} of frame width.${guides.boundaryY === undefined ? '' : ` Place the wall/table boundary at Y ${percent(guides.boundaryY)} measured from the top.`}`;
  const prompt = `${basePrompt.trim()}\n\n${roles}\n\n${COMPOSITION_CAMERAS[angle]} ${framing}\n\nRender a natural full scene using the composition image as the source of the background, surface and lighting, with consistent lighting and realistic contact shadows. Preserve the target product's true shape, proportions, colour, details, decoration, packaging, text and logos from the product photos. Do not restyle, add or remove product details. These are framing targets: never stretch or distort the product to fit a rectangle. Keep the entire product in frame. Composition guides are approximate, not a pixel lock.`;
  if (prompt.length > 32000)
    throw new Error('The final composition prompt exceeds 32,000 characters. Shorten your prompt.');
  return { prompt, referenceImages: [...productReferences, settings.referenceUrl] };
}
export function preflightComposition(options: {
  template: ShootTemplate;
  aspectRatio: string;
  targets: { label: string | null; referenceImages: string[] }[];
  angles: ShootAngle[];
  basePrompt: string;
}): void {
  if (options.aspectRatio !== options.template.aspectRatio)
    throw new Error(`This composition requires ${options.template.aspectRatio}.`);
  const invalid = options.targets.filter(
    (target) => target.referenceImages.length > 7 || target.referenceImages.length === 0,
  );
  if (invalid.length)
    throw new Error(
      `Composition needs 1–7 product photos for: ${invalid.map((target) => target.label ?? 'Current product').join(', ')}. No images were queued.`,
    );
  for (const target of options.targets)
    for (const angle of options.angles)
      buildCompositionRequest(options.basePrompt, target.referenceImages, options.template, angle);
}
