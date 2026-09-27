import { nativeImage } from 'electron';
import log from 'electron-log/main';
import { readFileSync, statSync } from 'fs';
import { secureHandle } from './validateSender';
import { resolveShootTemplateAsset, shootTemplateStore } from '../services/shootTemplateStore';
import {
  SHOOT_ANGLES,
  validateTemplateDraft,
  validateTemplate,
  validTemplateId,
  type ShootTemplate,
  type ShootTemplateDraft,
} from '../../shared/shootTemplates';

import {
  MAX_REFERENCE_BYTES as MAX_BYTES,
  MAX_REFERENCE_PIXELS as MAX_PIXELS,
  readReferenceDimensions,
} from '../../shared/referenceImage';

export function imageDimensions(bytes: Buffer): { width: number; height: number } {
  return readReferenceDimensions(bytes);
}
export function decodeReference(source: string): ReturnType<typeof nativeImage.createFromBuffer> {
  let bytes: Buffer;
  if (source.startsWith('local-file:')) {
    const path = resolveShootTemplateAsset(source);
    if (statSync(path).size > MAX_BYTES) throw new Error('Reference exceeds 30 MB.');
    bytes = readFileSync(path);
  } else {
    if (source.length > Math.ceil(MAX_BYTES / 3) * 4 + 40)
      throw new Error('Reference exceeds 30 MB.');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
    if (!match?.[2]) throw new Error('Upload a PNG, JPEG or WebP reference.');
    bytes = Buffer.from(match[2], 'base64');
  }
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Reference exceeds 30 MB.');
  const expected = imageDimensions(bytes);
  const image = nativeImage.createFromBuffer(bytes);
  const actual = image.getSize();
  if (
    image.isEmpty() ||
    actual.width * actual.height > MAX_PIXELS ||
    actual.width * actual.height !== expected.width * expected.height
  )
    throw new Error('Reference could not be decoded.');
  return image;
}
export function prepareTemplate(
  input: unknown,
): Pick<ShootTemplate, 'name' | 'aspectRatio' | 'angles'> {
  const parsed = validateTemplateDraft(input);
  if (!parsed.ok) throw new Error(parsed.error);
  const draft: ShootTemplateDraft = parsed.value;
  // Validate and decode every angle before writing any assets.
  const prepared = SHOOT_ANGLES.flatMap((angle) => {
    const settings = draft.angles[angle];
    if (!settings) return [];
    const image = decodeReference(settings.source);
    const size = image.getSize();
    const crop = {
      x: Math.floor(settings.crop.x * size.width),
      y: Math.floor(settings.crop.y * size.height),
      width: Math.round(settings.crop.width * size.width),
      height: Math.round(settings.crop.height * size.height),
    };
    const [a, b] = draft.aspectRatio.split(':').map(Number);
    if (
      !a ||
      !b ||
      crop.width < 16 ||
      crop.height < 16 ||
      crop.x + crop.width > size.width ||
      crop.y + crop.height > size.height ||
      Math.abs(crop.width / crop.height - a / b) > 2 / crop.height
    )
      throw new Error('Crop must match the template aspect and remain inside the reference.');
    const source = image.toPNG();
    const reference = image.crop(crop).toPNG();
    if (source.length > MAX_BYTES || reference.length > MAX_BYTES)
      throw new Error('Decoded reference exceeds 30 MB. Use a smaller photo.');
    return [{ angle, settings, source, reference }];
  });
  const angles: ShootTemplate['angles'] = {};
  for (const entry of prepared) {
    angles[entry.angle] = {
      crop: entry.settings.crop,
      guides: entry.settings.guides,
      sourceUrl: shootTemplateStore.saveAsset(entry.source),
      referenceUrl: shootTemplateStore.saveAsset(entry.reference),
    };
  }
  return { name: draft.name.trim(), aspectRatio: draft.aspectRatio, angles };
}
export function preflightTemplate(input: unknown): void {
  const parsed = validateTemplate(input);
  if (!parsed.ok || (parsed.ok && parsed.value.archivedAt))
    throw new Error('Composition template is invalid or archived.');
  const [a = 1, b = 1] = parsed.value.aspectRatio.split(':').map(Number);
  for (const settings of Object.values(parsed.value.angles)) {
    decodeReference(settings.sourceUrl);
    const { width, height } = decodeReference(settings.referenceUrl).getSize();
    if (Math.abs(width / height - a / b) > 2 / height)
      throw new Error(
        'Composition reference no longer matches the fixed aspect. Reopen the editor and save it again.',
      );
  }
}
export function registerShootTemplateHandlers(): void {
  secureHandle('shootTemplates:list', () => shootTemplateStore.list());
  secureHandle('shootTemplates:preview', (_event, source: unknown) => {
    if (typeof source !== 'string') throw new Error('Invalid composition asset.');
    resolveShootTemplateAsset(source);
    const image = decodeReference(source);
    const { width, height } = image.getSize();
    const scale = Math.min(1, 1200 / Math.max(width, height));
    return {
      dataUrl: image
        .resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
        })
        .toDataURL(),
      width,
      height,
    };
  });
  secureHandle('shootTemplates:get', (_event, id: string) => shootTemplateStore.get(id));
  secureHandle('shootTemplates:preflight', (_event, template: unknown) =>
    preflightTemplate(template),
  );
  secureHandle('shootTemplates:create', async (_event, input: unknown) => {
    const start = Date.now();
    try {
      const template = await shootTemplateStore.create(() => prepareTemplate(input));
      log.info('composition-save', {
        id: template.id,
        outcome: 'created',
        durationMs: Date.now() - start,
      });
      return template;
    } catch (error) {
      log.warn('composition-save', { outcome: 'failed', durationMs: Date.now() - start });
      throw error;
    }
  });
  secureHandle(
    'shootTemplates:update',
    async (_event, id: string, revision: number, input: unknown) => {
      if (!validTemplateId(id) || !Number.isSafeInteger(revision))
        throw new Error('Invalid template revision.');
      const previous = shootTemplateStore.get(id);
      if (!previous || previous.archivedAt || previous.revision !== revision)
        throw new Error('Template changed or is unavailable. Reopen it before saving.');
      return shootTemplateStore.update(id, revision, () => prepareTemplate(input));
    },
  );
  secureHandle('shootTemplates:archive', (_event, id: string, revision: number) =>
    shootTemplateStore.update(id, revision),
  );
}
