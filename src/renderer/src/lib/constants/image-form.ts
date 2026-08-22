export const MAX_REFERENCE_IMAGES = 8;
export const MAX_IMAGE_SIZE_MB = 30;
export const MAX_IMAGES_PER_GENERATION = 4;

// GPT Image accepts PNG, JPEG, and WebP reference images up to 50 MB.
// Keep the app's lower 30 MB cap to limit IPC and main-process memory use.
export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
] as const;

/** HTML `<input accept=...>` value for file pickers. */
export const SUPPORTED_IMAGE_ACCEPT = SUPPORTED_IMAGE_MIME_TYPES.join(',');

/** Regex used to validate File.type values from user uploads. */
export const SUPPORTED_IMAGE_MIME_REGEX = /^image\/(jpeg|jpg|png|webp)$/i;

// gpt-image-2 supports arbitrary sizes between 1:3 and 3:1. These useful
// e-commerce presets map to explicit divisible-by-16 dimensions in main.
export const aspectRatioOptions = [
  { value: 'auto', label: 'Auto' },
  { value: '1:1', label: '1:1' },
  { value: '2:3', label: '2:3' },
  { value: '3:2', label: '3:2' },
  { value: '3:4', label: '3:4' },
  { value: '4:3', label: '4:3' },
  { value: '4:5', label: '4:5' },
  { value: '5:4', label: '5:4' },
  { value: '9:16', label: '9:16' },
  { value: '16:9', label: '16:9' },
  { value: '21:9', label: '21:9' },
];

export const qualityOptions = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const outputFormatOptions = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPG' },
  { value: 'webp', label: 'WebP' },
];
