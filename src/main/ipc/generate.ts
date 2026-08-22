import { readFileSync, statSync } from 'fs';
import { basename, extname } from 'path';
import OpenAI, { APIError, toFile, type Uploadable } from 'openai';
import log from 'electron-log/main';
import { getApiKey } from '../services/apiKeyStore';
import { resolveLocalFileUrl } from '../services/paths';
import { secureHandle } from './validateSender';

const IMAGE_MODEL = 'gpt-image-2';
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

export interface GenerateImageInput {
  prompt: string;
  count?: number;
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: string;
  imageUrls?: string[];
}

export interface GenerateImageResult {
  success: boolean;
  resultUrls?: string[];
  error?: string;
}

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

async function referenceToFile(source: string, index: number): Promise<Uploadable> {
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
    {
      type: mimeType,
    },
  );
}

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

function normaliseInput(data: GenerateImageInput): Required<GenerateImageInput> {
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

  return { prompt, count, aspectRatio, resolution, outputFormat, imageUrls };
}

function friendlyError(error: unknown): string {
  if (error instanceof APIError) {
    if (error.status === 401) return 'OpenAI rejected the API key. Update it on the APIs page.';
    if (error.status === 429)
      return 'OpenAI rate limit or credit limit reached. Check your API billing.';
    if (error.status === 400) return error.message || 'OpenAI rejected this image request.';
    return `OpenAI image generation failed${error.status ? ` (${error.status})` : ''}.`;
  }
  return error instanceof Error ? error.message : 'Image generation failed.';
}

export function registerGenerateHandlers(): void {
  secureHandle(
    'generate:image',
    async (_event, rawData: GenerateImageInput): Promise<GenerateImageResult> => {
      try {
        const data = normaliseInput(rawData);
        const apiKey = getApiKey('openai');
        if (!apiKey) throw new Error('Add your OpenAI API key on the APIs page first.');

        const openai = new OpenAI({ apiKey });
        const common = {
          model: IMAGE_MODEL,
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
      } catch (error) {
        log.error('OpenAI image generation failed', {
          status: error instanceof APIError ? error.status : undefined,
          code: error instanceof APIError ? error.code : undefined,
        });
        return { success: false, error: friendlyError(error) };
      }
    },
  );
}
