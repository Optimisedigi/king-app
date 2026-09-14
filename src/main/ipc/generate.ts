import { readFileSync, statSync } from 'fs';
import { basename, extname } from 'path';
import OpenAI, { APIError, toFile } from 'openai';
import log from 'electron-log/main';
import { getApiKey } from '../services/apiKeyStore';
import { getValidAccessToken } from '../services/openaiOAuth';
import { resolveLocalFileUrl } from '../services/paths';
import { secureHandle } from './validateSender';

export type ImageProvider = 'openai-api' | 'openai-oauth' | 'fal';

/** Mirror of `ImageModel` in `src/renderer/src/stores/modelStore.ts`. */
export type ImageModelVariant =
  | 'nano_banana_pro'
  | 'gpt_image_2'
  | 'gpt_image_25_flare'
  | 'gpt_image_25_sunburst';

export interface GenerateImageInput {
  prompt: string;
  count?: number;
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: string;
  imageUrls?: string[];
  /** Which generation backend to use. Defaults to 'openai-api'. */
  provider?: ImageProvider;
  /**
   * Which image model to use. The fal path picks between all four variants;
   * both OpenAI paths honour the GPT Image 2.5 variants and otherwise fall
   * back to GPT Image 2.
   */
  modelVariant?: ImageModelVariant;
}

export interface GenerateImageResult {
  success: boolean;
  resultUrls?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const IMAGE_MODEL = 'gpt-image-2';
const OPENAI_MODEL_IDS: Record<string, string> = {
  gpt_image_25_flare: 'gpt-image-2.5-flare',
  gpt_image_25_sunburst: 'gpt-image-2.5-sunburst',
};

/**
 * The OpenAI image model id a variant maps to, or undefined when the variant
 * has no OpenAI equivalent (e.g. Nano Banana Pro). Callers either fall back
 * to `IMAGE_MODEL` or omit the field and let the backend default apply.
 */
function optionalOpenAIModel(variant: string | undefined): string | undefined {
  return variant ? OPENAI_MODEL_IDS[variant] : undefined;
}

const MAX_PROMPT_LENGTH = 32_000;
const MAX_REFERENCE_IMAGES = 8;
const MAX_REFERENCE_BYTES = 30 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TRUSTED_REMOTE_IMAGE_HOSTS = [
  'cdn.shopify.com',
  'shopifycdn.com',
  'media-amazon.com',
  'ssl-images-amazon.com',
  'shopee.com',
  'shopeemobile.com',
  'shopeeusercontent.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
];

function isTrustedRemoteImageHost(hostname: string): boolean {
  return TRUSTED_REMOTE_IMAGE_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

function mimeTypeFromExtension(path: string): string | null {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return null;
  }
}

function assertReferenceSize(size: number): void {
  if (size <= 0 || size > MAX_REFERENCE_BYTES) {
    throw new Error('Each reference image must be between 1 byte and 30 MB.');
  }
}

async function readReferenceResponse(response: Response): Promise<Buffer> {
  if (!response.body) throw new Error('Reference image response was empty.');
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const buffer = Buffer.from(value);
    size += buffer.byteLength;
    assertReferenceSize(size);
    chunks.push(buffer);
  }
  assertReferenceSize(size);
  return Buffer.concat(chunks, size);
}

async function referenceToFile(source: string, index: number): Promise<File> {
  if (source.startsWith('data:')) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(source);
    if (!match?.[1] || !match[2] || !SUPPORTED_MIME_TYPES.has(match[1].toLowerCase())) {
      throw new Error('Reference images must be PNG, JPEG, or WebP.');
    }
    const buffer = Buffer.from(match[2], 'base64');
    assertReferenceSize(buffer.byteLength);
    const extension = match[1].toLowerCase() === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
    return toFile(buffer, `reference-${index}.${extension}`, { type: match[1].toLowerCase() });
  }

  if (source.startsWith('local-file://')) {
    const path = resolveLocalFileUrl(source);
    if (!path) throw new Error('Invalid local reference image path.');
    const mimeType = mimeTypeFromExtension(path);
    if (!mimeType) throw new Error('Reference images must be PNG, JPEG, or WebP.');
    assertReferenceSize(statSync(path).size);
    return toFile(readFileSync(path), basename(path), { type: mimeType });
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error('Invalid reference image URL.');
  }
  if (url.protocol !== 'https:' || !isTrustedRemoteImageHost(url.hostname)) {
    throw new Error('Remote reference image host is not supported; upload the image instead.');
  }

  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not download reference image (${response.status}).`);
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() ?? '';
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new Error('Reference images must be PNG, JPEG, or WebP.');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) assertReferenceSize(Number(contentLength));
  const buffer = await readReferenceResponse(response);
  return toFile(
    buffer,
    `reference-${index}.${mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]}`,
    { type: mimeType },
  );
}

async function referenceToDataUrl(source: string, index: number): Promise<string> {
  const file = await referenceToFile(source, index);
  return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

const MODEL_VARIANTS = new Set<string>([
  'nano_banana_pro',
  'gpt_image_2',
  'gpt_image_25_flare',
  'gpt_image_25_sunburst',
]);

const IMAGE_SIZES: Record<string, string> = {
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
  '3:4': '1152x1536',
  '4:3': '1536x1152',
  '4:5': '1216x1520',
  '5:4': '1520x1216',
  '9:16': '864x1536',
  '16:9': '1536x864',
  '21:9': '1680x720',
};

function normaliseInput(
  data: GenerateImageInput,
): Required<Omit<GenerateImageInput, 'modelVariant'>> & { modelVariant?: string } {
  const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error('Prompt must be between 1 and 32,000 characters.');
  }

  const count = Number.isInteger(data.count) ? Number(data.count) : 1;
  if (count < 1 || count > 4) throw new Error('Image count must be between 1 and 4.');

  const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls : [];
  if (imageUrls.length > MAX_REFERENCE_IMAGES || imageUrls.some((url) => typeof url !== 'string')) {
    throw new Error(`You can use up to ${MAX_REFERENCE_IMAGES} reference images.`);
  }

  const aspectRatio = data.aspectRatio ?? 'auto';
  if (aspectRatio !== 'auto' && !IMAGE_SIZES[aspectRatio])
    throw new Error('Unsupported aspect ratio.');

  const qualityMap: Record<string, string> = {
    auto: 'auto',
    low: 'low',
    medium: 'medium',
    high: 'high',
    '1K': 'low',
    '2K': 'medium',
    '4K': 'high',
  };
  const resolution = qualityMap[data.resolution ?? 'high'];
  if (!resolution) throw new Error('Unsupported image quality.');

  const outputFormat = data.outputFormat ?? 'png';
  if (!['png', 'jpeg', 'webp'].includes(outputFormat))
    throw new Error('Unsupported output format.');

  const provider: ImageProvider = data.provider ?? 'openai-api';
  if (!['openai-api', 'openai-oauth', 'fal'].includes(provider))
    throw new Error('Unsupported image provider.');

  const modelVariant = data.modelVariant;
  if (modelVariant !== undefined && !MODEL_VARIANTS.has(modelVariant)) {
    throw new Error('Unsupported image model.');
  }

  return {
    prompt,
    count,
    aspectRatio,
    resolution,
    outputFormat,
    imageUrls,
    provider,
    modelVariant,
  };
}

// ---------------------------------------------------------------------------
// Path 1: OpenAI API Key (existing)
// ---------------------------------------------------------------------------

function friendlyOpenAIError(error: unknown): string {
  if (error instanceof APIError) {
    if (error.status === 401) return 'OpenAI rejected the API key. Update it on the APIs page.';
    if (error.status === 429)
      return 'OpenAI rate limit or credit limit reached. Check your API billing.';
    if (error.status === 400) return error.message || 'OpenAI rejected this image request.';
    return `OpenAI image generation failed${error.status ? ` (${error.status})` : ''}.`;
  }
  return error instanceof Error ? error.message : 'Image generation failed.';
}

async function generateViaApiKey(
  data: ReturnType<typeof normaliseInput>,
): Promise<GenerateImageResult> {
  const apiKey = getApiKey('openai');
  if (!apiKey) throw new Error('Add your OpenAI API key on the APIs page first.');

  const openai = new OpenAI({ apiKey });
  const common = {
    model: optionalOpenAIModel(data.modelVariant) ?? IMAGE_MODEL,
    prompt: data.prompt,
    n: data.count,
    size: data.aspectRatio === 'auto' ? ('auto' as const) : IMAGE_SIZES[data.aspectRatio],
    quality: data.resolution as 'auto' | 'low' | 'medium' | 'high',
    output_format: data.outputFormat as 'png' | 'jpeg' | 'webp',
  };

  const response = data.imageUrls.length
    ? await openai.images.edit({
        ...common,
        image: await Promise.all(data.imageUrls.map(referenceToFile)),
        input_fidelity: 'high',
      })
    : await openai.images.generate(common);

  const resultUrls = (response.data ?? [])
    .map((image) => image.b64_json)
    .filter((image): image is string => Boolean(image))
    .map((image) => `data:image/${data.outputFormat};base64,${image}`);
  if (!resultUrls.length) throw new Error('OpenAI returned no images.');

  return { success: true, resultUrls };
}

// ---------------------------------------------------------------------------
// Path 2: OpenAI OAuth (Codex endpoint with image_generation tool)
// ---------------------------------------------------------------------------

/**
 * The text model that hosts the image_generation tool on the Codex endpoint.
 * This is not the image model — that is set on the tool itself. `gpt-5.4`
 * retired from Codex with ChatGPT sign-in on 2026-08-31 and now returns a 400,
 * so ChatGPT-account sign-in must use its replacement.
 */
const CODEX_HOST_MODEL = 'gpt-5.6-terra';

async function generateViaOAuth(
  data: ReturnType<typeof normaliseInput>,
  onProgress?: (message: string) => void,
): Promise<GenerateImageResult> {
  const accessToken = await getValidAccessToken();
  const referenceImageUrls = await Promise.all(data.imageUrls.map(referenceToDataUrl));
  const resultUrls: string[] = [];

  // The hosted image_generation tool accepts an explicit image model. Only
  // send one for the GPT Image 2.5 variants; otherwise let the backend pick
  // its default, as it did before model selection existed.
  const toolModel = optionalOpenAIModel(data.modelVariant);
  const imageTool = toolModel
    ? { type: 'image_generation', model: toolModel }
    : { type: 'image_generation' };

  for (let i = 0; i < data.count; i++) {
    if (data.count > 1) onProgress?.(`Generating ${i + 1}/${data.count}…`);

    const sizeHint = data.aspectRatio === 'auto' ? '' : ` Size: ${data.aspectRatio}.`;
    const qualityHint = data.resolution === 'auto' ? '' : ` Quality: ${data.resolution}.`;
    const formatHint = data.outputFormat === 'png' ? '' : ` Format: ${data.outputFormat}.`;
    const promptText = `Generate an image: ${data.prompt}.${sizeHint}${qualityHint}${formatHint}`;

    const res = await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        model: CODEX_HOST_MODEL,
        tools: [imageTool],
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: promptText },
              ...referenceImageUrls.map((image_url) => ({ type: 'input_image', image_url })),
            ],
          },
        ],
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI OAuth request failed (${res.status}): ${text}`);
    }

    // Parse SSE stream for image data
    const imageData = await parseOAuthSSEStream(res);
    if (!imageData) throw new Error('OpenAI OAuth returned no image.');
    resultUrls.push(imageData);
  }

  return { success: true, resultUrls };
}

async function parseOAuthSSEStream(response: Response): Promise<string | null> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let imageData: string | null = null;
  let outputFormat = 'png';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      if (jsonStr === '[DONE]') continue;

      try {
        const event = JSON.parse(jsonStr) as Record<string, unknown>;

        // Look for completed image_generation_call items
        if (event.type === 'response.output_item.done') {
          const item = event.item as Record<string, unknown> | undefined;
          if (item?.type === 'image_generation_call' && typeof item.result === 'string') {
            imageData = item.result;
            if (typeof item.output_format === 'string') outputFormat = item.output_format;
          }
        }

        // Also check for the added event in case result comes inline
        if (event.type === 'response.output_item.added') {
          const item = event.item as Record<string, unknown> | undefined;
          if (item?.type === 'image_generation_call' && typeof item.result === 'string') {
            imageData = item.result;
            if (typeof item.output_format === 'string') outputFormat = item.output_format;
          }
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }

  if (!imageData) return null;
  return `data:image/${outputFormat};base64,${imageData}`;
}

// ---------------------------------------------------------------------------
// Path 3: fal.ai (restored from git history)
// ---------------------------------------------------------------------------

// fal.ai model constants
const NANO_BANANA_PRO_MODEL = 'fal-ai/nano-banana-pro';
const NANO_BANANA_PRO_EDIT_MODEL = 'fal-ai/nano-banana-pro/edit';
const GPT_IMAGE_2_MODEL = 'openai/gpt-image-2';
const GPT_IMAGE_2_EDIT_MODEL = 'openai/gpt-image-2/edit';
// GPT Image 2.5 ships on fal as four variant endpoints under a shared
// `openai/gpt-image-2.5/<variant>/` prefix — there is no bare 2.5 endpoint.
const GPT_IMAGE_25_FLARE_MODEL = 'openai/gpt-image-2.5/flare/text-to-image';
const GPT_IMAGE_25_FLARE_EDIT_MODEL = 'openai/gpt-image-2.5/flare/edit';
const GPT_IMAGE_25_SUNBURST_MODEL = 'openai/gpt-image-2.5/sunburst/text-to-image';
const GPT_IMAGE_25_SUNBURST_EDIT_MODEL = 'openai/gpt-image-2.5/sunburst/edit';

const FAL_MISSING_KEY_MESSAGE =
  "Your image generator isn't connected yet. Open the APIs page and add your fal.ai key to get started.";
const FAL_INVALID_KEY_MESSAGE =
  "Your fal.ai key didn't work. Double-check it on the APIs page and save a fresh one if needed.";
const FAL_OUT_OF_CREDITS_MESSAGE =
  'Your fal.ai credits have run out. Top up at fal.ai/dashboard/billing and try again. If you just topped up, give it a minute to sync.';
const FAL_SAFETY_BLOCK_MESSAGE =
  'Google blocked this one as a safety precaution. The filter is probabilistic — hitting Try again often works.';
const FAL_VALIDATION_MESSAGE =
  "Something about this request wasn't accepted. Try a different image or prompt.";

function isSafetyBlock(message: string): boolean {
  return /\b(unsafe content|did not generate the expected output|prohibited[_ ]content|image[_ ]safety)\b/i.test(
    message,
  );
}

function extractFalMessage(err: { body?: unknown; message?: string }): string {
  const parts: string[] = [];
  if (typeof err.message === 'string') parts.push(err.message);
  const body = err.body as { detail?: unknown; message?: string; error?: string } | undefined;
  if (body) {
    if (typeof body.message === 'string') parts.push(body.message);
    if (typeof body.error === 'string') parts.push(body.error);
    if (typeof body.detail === 'string') parts.push(body.detail);
    if (Array.isArray(body.detail)) {
      for (const d of body.detail) {
        if (d && typeof d === 'object' && 'msg' in d && typeof d.msg === 'string') {
          parts.push(d.msg);
        }
      }
    }
  }
  return parts.join(' | ');
}

function isOutOfCredits(status: number | undefined, message: string): boolean {
  if (status === 402) return true;
  return /\b(insufficient (balance|credits|funds)|out of credits|exhausted|quota|top up|billing|payment required)\b/i.test(
    message,
  );
}

function isAuthFailure(status: number | undefined, message: string): boolean {
  if (status === 401 || status === 403) return true;
  return /\b(unauthorized|invalid api key|invalid key|forbidden)\b/i.test(message);
}

function selectFalModel(variant: string, hasReferenceImages: boolean): string {
  switch (variant) {
    case 'gpt_image_2':
      return hasReferenceImages ? GPT_IMAGE_2_EDIT_MODEL : GPT_IMAGE_2_MODEL;
    case 'gpt_image_25_flare':
      return hasReferenceImages ? GPT_IMAGE_25_FLARE_EDIT_MODEL : GPT_IMAGE_25_FLARE_MODEL;
    case 'gpt_image_25_sunburst':
      return hasReferenceImages ? GPT_IMAGE_25_SUNBURST_EDIT_MODEL : GPT_IMAGE_25_SUNBURST_MODEL;
    default:
      return hasReferenceImages ? NANO_BANANA_PRO_EDIT_MODEL : NANO_BANANA_PRO_MODEL;
  }
}

/** GPT Image family variants share the same fal input shape. */
function isGptImageVariant(variant: string): boolean {
  return variant.startsWith('gpt_image_');
}

function mapAspectToGptImageSize(aspectRatio: string): string {
  switch (aspectRatio) {
    case '1:1':
      return 'square_hd';
    case '4:3':
      return 'landscape_4_3';
    case '3:4':
      return 'portrait_4_3';
    case '16:9':
      return 'landscape_16_9';
    case '9:16':
      return 'portrait_16_9';
    case 'auto':
      return 'auto';
    default:
      return 'auto';
  }
}

function mapResolutionToGptQuality(resolution: string): 'low' | 'high' {
  return resolution === 'low' || resolution === '1K' ? 'low' : 'high';
}

// fal.ai uses HEIC/HEIF for Gemini inputs
const FAL_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

function resolveFalImageUrl(url: string): string {
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  if (url.startsWith('local-file://')) {
    const filePath = resolveLocalFileUrl(url);
    if (!filePath) return url;
    const buffer = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    const mime = FAL_MIME_TYPES[ext] || 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }
  return url;
}

async function generateViaFal(
  data: ReturnType<typeof normaliseInput>,
): Promise<GenerateImageResult> {
  if (!process.env.FAL_KEY) throw new Error(FAL_MISSING_KEY_MESSAGE);

  const { fal } = await import('@fal-ai/client');

  const resolvedUrls = data.imageUrls
    .map(resolveFalImageUrl)
    .filter((u) => u.startsWith('data:') || u.startsWith('http'));

  const hasReferenceImages = resolvedUrls.length > 0;
  const variant = data.modelVariant ?? 'nano_banana_pro';
  const model = selectFalModel(variant, hasReferenceImages);

  let input: Record<string, unknown>;
  if (isGptImageVariant(variant)) {
    input = {
      prompt: data.prompt,
      image_size: mapAspectToGptImageSize(data.aspectRatio),
      quality: mapResolutionToGptQuality(data.resolution),
      output_format: data.outputFormat,
      num_images: 1,
    };
  } else {
    input = {
      prompt: data.prompt,
      aspect_ratio: data.aspectRatio || '1:1',
      resolution: data.resolution || '1K',
      output_format: data.outputFormat,
      num_images: 1,
      safety_tolerance: '6',
    };
  }
  if (resolvedUrls.length > 0) {
    input.image_urls = resolvedUrls;
  }

  try {
    const result = await fal.subscribe(model, { input, logs: true });
    const resultData = result.data as { images?: Array<{ url: string }> };
    const resultUrls = resultData.images?.map((img) => img.url) ?? [];
    if (!resultUrls.length) throw new Error('fal.ai returned no images.');
    return { success: true, resultUrls };
  } catch (err) {
    const e = err as { status?: number; body?: unknown; message?: string };
    const falMessage = extractFalMessage(e);

    log.error('[generate:fal] error', { status: e?.status, message: e?.message });

    if (isOutOfCredits(e?.status, falMessage)) throw new Error(FAL_OUT_OF_CREDITS_MESSAGE);
    if (isAuthFailure(e?.status, falMessage)) throw new Error(FAL_INVALID_KEY_MESSAGE);

    if (e?.status === 422) {
      if (isSafetyBlock(falMessage)) throw new Error(FAL_SAFETY_BLOCK_MESSAGE);
      throw new Error(FAL_VALIDATION_MESSAGE);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerGenerateHandlers(): void {
  secureHandle(
    'generate:image',
    async (_event, rawData: GenerateImageInput): Promise<GenerateImageResult> => {
      try {
        const data = normaliseInput(rawData);

        switch (data.provider) {
          case 'openai-api':
            return await generateViaApiKey(data);
          case 'openai-oauth':
            return await generateViaOAuth(data);
          case 'fal':
            return await generateViaFal(data);
          default:
            throw new Error(`Unknown provider: ${data.provider}`);
        }
      } catch (error) {
        const provider = rawData.provider ?? 'openai-api';
        log.error(`Image generation failed (provider: ${provider})`, {
          status: error instanceof APIError ? error.status : undefined,
          message: error instanceof Error ? error.message : String(error),
        });

        // Use provider-specific friendly errors
        if (provider === 'openai-api') {
          return { success: false, error: friendlyOpenAIError(error) };
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Image generation failed.',
        };
      }
    },
  );
}
