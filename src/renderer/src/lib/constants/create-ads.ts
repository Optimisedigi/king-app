// Hardcoded configuration for the Create Ads page.
//
// The prompt gives GPT Image 2 explicit reference roles and concise identity,
// composition, and negative constraints. This improves product fidelity while
// keeping user-provided copy and the requested aspect ratio unambiguous.

export const CREATE_ADS_GENERATION_COUNT = 4;
export const CREATE_ADS_RESOLUTION = 'medium';
export const CREATE_ADS_OUTPUT_FORMAT = 'png';

/**
 * Build the prompt sent to GPT Image 2 for ad generation.
 *
 * @param productBrief  Free-text brief from the user. Any copy the user wants
 *   rendered verbatim into the image should already be wrapped in double
 *   quotes — the model honours literal text only when quoted.
 * @param aspectRatio   Target output aspect ratio (e.g. '1:1', '4:5'). It is
 *   restated in the prompt so the intended composition remains explicit.
 */
export function buildCreateAdsPrompt(productBrief: string, aspectRatio: string): string {
  const brief = productBrief.trim() || '(no additional context provided)';

  return `Recreate the ad concept from Image 1 as if it had been shot for the product in Image 2 onward. Output a single ${aspectRatio} photorealistic social ad creative, campaign-ready commercial photography quality.

[REFERENCES]
- Image 1 — REFERENCE AD: source for mood, lighting direction and quality, composition, subject framing and scale, camera angle, depth of field, color grading, and prop styling. Infer lens, focal length, and f-stop from this image.
- Image 2+ — USER PRODUCT: ground truth for the product's shape, proportions, colors, label typography, and logo placement.

[RELATIONSHIP]
Keep the product's silhouette, label, colors, and logo exactly the same as Image 2 onward. Match the reference ad's lighting, composition, framing, scale, and color grade. Place the user's product in the same region of the frame that the original product occupies in Image 1.

[NEW SCENARIO]
Adapt background, props, surfaces, and surrounding textures so they are contextually appropriate for the user's product category and the brief below. Props and surfaces are generic and unbranded unless the brief specifies otherwise.

BRIEF (informs scene, props, and any in-image copy):
${brief}

Render any text on the product packaging legibly and spelled correctly. Render ad copy from the brief only when it is enclosed in double quotes — render it verbatim in a font style that matches the reference ad's typography.

Output: ${aspectRatio} aspect ratio, photorealistic, natural shadows and reflections consistent with the inferred light direction. No competitor logos, no watermarks, no text other than what appears on the user's product or is quoted in the brief.`;
}
