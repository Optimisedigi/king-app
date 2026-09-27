export const SHOOT_TEMPLATE_VERSION = 1;
export const SHOOT_ANGLES = ['eye-level', 'elevated-45'] as const;
export type ShootAngle = (typeof SHOOT_ANGLES)[number];
export const SHOOT_ASPECTS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;
export type ShootAspect = (typeof SHOOT_ASPECTS)[number];
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CompositionGuides {
  boundaryY?: number;
  centreX: number;
  baseY: number;
  width: number;
}
export interface ShootAngleSettings {
  sourceUrl: string;
  referenceUrl: string;
  crop: CropRect;
  guides: CompositionGuides;
}
export interface ShootTemplate {
  id: string;
  schemaVersion: 1;
  revision: number;
  name: string;
  aspectRatio: ShootAspect;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  angles: Partial<Record<ShootAngle, ShootAngleSettings>>;
}
export interface ShootAngleDraft {
  source: string;
  crop: CropRect;
  guides: CompositionGuides;
}
export interface ShootTemplateDraft {
  name: string;
  aspectRatio: ShootAspect;
  angles: Partial<Record<ShootAngle, ShootAngleDraft>>;
}
export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
export function validCrop(value: unknown): value is CropRect {
  return (
    isRecord(value) &&
    unit(value.x) &&
    unit(value.y) &&
    unit(value.width) &&
    unit(value.height) &&
    value.width > 0 &&
    value.height > 0 &&
    value.x + value.width <= 1.000000001 &&
    value.y + value.height <= 1.000000001
  );
}
export function validGuides(value: unknown): value is CompositionGuides {
  return (
    isRecord(value) &&
    unit(value.centreX) &&
    unit(value.baseY) &&
    unit(value.width) &&
    value.width > 0 &&
    (value.boundaryY === undefined || unit(value.boundaryY)) &&
    value.centreX - value.width / 2 >= 0 &&
    value.centreX + value.width / 2 <= 1
  );
}
export function validTemplateId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
  );
}
export function validAssetUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^local-file:\/\/\/?shoot-templates\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.png$/.test(
      value,
    )
  );
}
function validBase(value: Record<string, unknown>): boolean {
  return (
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= 100 &&
    SHOOT_ASPECTS.some((aspect) => aspect === value.aspectRatio) &&
    isRecord(value.angles) &&
    Object.keys(value.angles).length > 0 &&
    Object.keys(value.angles).every((angle) => SHOOT_ANGLES.some((known) => known === angle))
  );
}
export function validateTemplateDraft(value: unknown): Validation<ShootTemplateDraft> {
  if (!isRecord(value) || !validBase(value) || !isRecord(value.angles))
    return { ok: false, error: 'Enter a name, fixed aspect and at least one reference.' };
  for (const angle of Object.values(value.angles)) {
    if (
      !isRecord(angle) ||
      typeof angle.source !== 'string' ||
      !angle.source ||
      !validCrop(angle.crop) ||
      !validGuides(angle.guides)
    )
      return { ok: false, error: 'Invalid angle reference, crop or guides.' };
  }
  return { ok: true, value: value as unknown as ShootTemplateDraft };
}
export function validateTemplate(value: unknown): Validation<ShootTemplate> {
  if (
    !isRecord(value) ||
    !validBase(value) ||
    !validTemplateId(value.id) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !isRecord(value.angles)
  )
    return { ok: false, error: 'Invalid composition template metadata.' };
  for (const field of [
    'createdAt',
    'updatedAt',
    ...(value.archivedAt === undefined ? [] : ['archivedAt']),
  ]) {
    if (typeof value[field] !== 'string' || !Number.isFinite(Date.parse(value[field])))
      return { ok: false, error: 'Invalid template timestamp.' };
  }
  for (const angle of Object.values(value.angles)) {
    if (
      !isRecord(angle) ||
      !validAssetUrl(angle.sourceUrl) ||
      !validAssetUrl(angle.referenceUrl) ||
      !validCrop(angle.crop) ||
      !validGuides(angle.guides)
    )
      return { ok: false, error: 'Invalid composition reference or guides.' };
  }
  return { ok: true, value: value as unknown as ShootTemplate };
}
