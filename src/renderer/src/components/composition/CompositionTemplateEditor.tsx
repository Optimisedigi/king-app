import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { readReferenceDimensions } from '../../../../shared/referenceImage';
import {
  SHOOT_ANGLES,
  SHOOT_ASPECTS,
  type CompositionGuides,
  type CropRect,
  type ShootAngle,
  type ShootAngleDraft,
  type ShootTemplate,
  type ShootTemplateDraft,
} from '../../../../shared/shootTemplates';

const control =
  'min-h-10 rounded-xl border border-[var(--base-color-brand--umber)] bg-[var(--base-color-brand--shell)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--base-color-brand--bean)] disabled:opacity-50';
const labels: Record<ShootAngle, string> = { 'eye-level': 'Eye level', 'elevated-45': '45° above' };
function initialDraft(template?: ShootTemplate): ShootTemplateDraft {
  const angles: ShootTemplateDraft['angles'] = {};
  for (const angle of SHOOT_ANGLES) {
    const settings = template?.angles[angle];
    if (settings)
      angles[angle] = {
        source: settings.sourceUrl,
        crop: { ...settings.crop },
        guides: { ...settings.guides },
      };
  }
  return { name: template?.name ?? '', aspectRatio: template?.aspectRatio ?? '1:1', angles };
}
function Percentage({
  label,
  value,
  min = 0,
  max = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <div className="grid grid-cols-[1fr_5rem] items-center gap-x-3 gap-y-1">
      <label className="col-span-2 text-sm">
        {label} (%)
        <input
          aria-label={`${label} percentage`}
          className={`${control} float-right w-20`}
          type="number"
          min={Number((min * 100).toFixed(1))}
          max={Number((max * 100).toFixed(1))}
          step="0.1"
          value={Number((value * 100).toFixed(1))}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber / 100;
            if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
          }}
        />
      </label>
      <input
        className="col-span-2 w-full accent-[var(--base-color-brand--bean)]"
        aria-label={`${label} slider`}
        type="range"
        min={min}
        max={max}
        step="0.001"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}
function AngleEditor({
  angle,
  settings,
  aspect,
  onChange,
  onError,
  onBusy,
}: {
  angle: ShootAngle;
  settings?: ShootAngleDraft;
  aspect: string;
  onChange: (settings: ShootAngleDraft) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}): ReactElement {
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(
    null,
  );
  const previewRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<FileReader | null>(null);
  const uploadImageRef = useRef<HTMLImageElement | null>(null);
  const uploadUrlRef = useRef<string | null>(null);
  const [drag, setDrag] = useState<keyof CompositionGuides | null>(null);
  const errorRef = useRef(onError);
  useEffect(() => {
    errorRef.current = onError;
  }, [onError]);
  useEffect(
    () => () => {
      readerRef.current?.abort();
      readerRef.current = null;
      if (uploadUrlRef.current) {
        URL.revokeObjectURL(uploadUrlRef.current);
        uploadUrlRef.current = null;
      }
      if (uploadImageRef.current) {
        uploadImageRef.current.onload = null;
        uploadImageRef.current.onerror = null;
        uploadImageRef.current.src = '';
        uploadImageRef.current = null;
      }
      onBusy(false);
    },
    [onBusy],
  );
  useEffect(() => {
    if (!settings?.source) return;
    let disposed = false;
    let url: string | undefined;
    let sourceSize: { width: number; height: number } | undefined;
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      if (image.naturalWidth * image.naturalHeight > 40_000_000) {
        errorRef.current('Reference exceeds 40 megapixels.');
        return;
      }
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (disposed || !blob) return;
        url = URL.createObjectURL(blob);
        setPreview({
          url,
          width: sourceSize?.width ?? image.naturalWidth,
          height: sourceSize?.height ?? image.naturalHeight,
        });
        image.onload = null;
        image.onerror = null;
        image.src = '';
      }, 'image/png');
    };
    image.onerror = () => {
      if (!disposed) {
        setPreview(null);
        errorRef.current('Reference cannot be opened. Upload it again.');
      }
    };
    if (settings.source.startsWith('local-file:')) {
      const source = settings.source;
      void (async (): Promise<void> => {
        try {
          const bounded = await window.api.shootTemplates.preview(source);
          if (disposed) return;
          sourceSize = bounded;
          image.src = bounded.dataUrl;
        } catch {
          if (!disposed) {
            setPreview(null);
            errorRef.current('Reference cannot be opened. Upload it again.');
          }
        }
      })();
    } else image.src = settings.source;
    return () => {
      disposed = true;
      image.onload = null;
      image.onerror = null;
      image.src = '';
      if (url) URL.revokeObjectURL(url);
    };
  }, [settings?.source]);
  function upload(file?: File): void {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 30 * 1024 * 1024) {
      onError('Choose a PNG, JPEG or WebP no larger than 30 MB.');
      return;
    }
    readerRef.current?.abort();
    if (uploadUrlRef.current) {
      URL.revokeObjectURL(uploadUrlRef.current);
      uploadUrlRef.current = null;
    }
    if (uploadImageRef.current) {
      uploadImageRef.current.onload = null;
      uploadImageRef.current.onerror = null;
      uploadImageRef.current.src = '';
      uploadImageRef.current = null;
    }
    onBusy(true);
    const fail = (message: string): void => {
      onBusy(false);
      onError(message);
    };
    const reader = new FileReader();
    readerRef.current = reader;
    reader.onerror = () => fail('The photo could not be read. Try again.');
    reader.onload = () => {
      if (readerRef.current !== reader || !(reader.result instanceof ArrayBuffer)) return;
      let expected: { width: number; height: number };
      try {
        expected = readReferenceDimensions(new Uint8Array(reader.result));
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : 'The reference could not be inspected.');
        return;
      }
      const source = URL.createObjectURL(file);
      uploadUrlRef.current = source;
      const image = new Image();
      uploadImageRef.current = image;
      image.onload = () => {
        URL.revokeObjectURL(source);
        if (uploadUrlRef.current === source) uploadUrlRef.current = null;
        if (readerRef.current !== reader) return;
        if (
          image.naturalWidth * image.naturalHeight !== expected.width * expected.height ||
          image.naturalWidth * image.naturalHeight > 40_000_000
        ) {
          fail('Reference exceeds 40 megapixels.');
          return;
        }
        const [a = 1, b = 1] = aspect.split(':').map(Number);
        const ratio = a / b / (image.naturalWidth / image.naturalHeight);
        const width = Math.min(1, ratio);
        const height = Math.min(1, 1 / ratio);
        // Normalize locally: nativeImage only guarantees PNG/JPEG support and
        // does not honor EXIF orientation. Keep the full-resolution clean source.
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          fail('Image preview is unavailable. Try reopening the editor.');
          return;
        }
        context.drawImage(image, 0, 0);
        image.onload = null;
        image.onerror = null;
        image.src = '';
        uploadImageRef.current = null;
        canvas.toBlob((blob) => {
          if (readerRef.current !== reader) return;
          if (!blob || blob.size > 30 * 1024 * 1024) {
            fail('The clean reference exceeds 30 MB. Use a smaller photo.');
            return;
          }
          const normalized = new FileReader();
          readerRef.current = normalized;
          normalized.onerror = () => fail('The clean reference could not be read. Try again.');
          normalized.onload = () => {
            if (readerRef.current !== normalized || typeof normalized.result !== 'string') return;
            onBusy(false);
            onChange({
              source: normalized.result,
              crop: { x: (1 - width) / 2, y: (1 - height) / 2, width, height },
              guides: {
                centreX: 0.5,
                baseY: 0.8,
                width: 0.6,
                boundaryY: 0.45,
                boundaryRightY: 0.45,
              },
            });
          };
          normalized.readAsDataURL(blob);
        }, 'image/png');
      };
      image.onerror = () => {
        URL.revokeObjectURL(source);
        if (uploadUrlRef.current === source) uploadUrlRef.current = null;
        if (readerRef.current === reader) fail('The photo is not a readable image.');
      };
      image.src = source;
    };
    reader.readAsArrayBuffer(file);
  }
  function guide(key: keyof CompositionGuides, value: number): void {
    const current = settings;
    if (!current) return;
    const guides = { ...current.guides, [key]: value };
    // A single-height line follows its left edge; pin the right end so moving the left tilts it.
    if (key === 'boundaryY' && current.guides.boundaryRightY === undefined)
      guides.boundaryRightY = current.guides.boundaryY ?? value;
    if (key === 'centreX')
      guides.centreX = Math.max(guides.width / 2, Math.min(1 - guides.width / 2, value));
    if (key === 'width')
      guides.width = Math.max(
        0.01,
        Math.min(value, 2 * Math.min(guides.centreX, 1 - guides.centreX)),
      );
    onChange({ ...current, guides });
  }
  // Without a right edge the boundary is level, as in templates saved before angled lines.
  const boundaryLeft = settings?.guides.boundaryY;
  const boundary =
    boundaryLeft === undefined
      ? null
      : { left: boundaryLeft, right: settings?.guides.boundaryRightY ?? boundaryLeft };
  function crop(update: Partial<CropRect>): void {
    if (settings) onChange({ ...settings, crop: { ...settings.crop, ...update } });
  }
  return (
    <section className="space-y-3">
      <label className="block text-sm">
        {labels[angle]} reference
        <input
          className={`${control} mt-2 block w-full py-2`}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            upload(event.currentTarget.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </label>
      {settings && preview && (
        <>
          <div
            ref={previewRef}
            className="relative mx-auto w-full max-w-sm touch-none overflow-hidden rounded-xl border border-[var(--base-color-brand--bean)] bg-[var(--base-color-brand--shell)]"
            style={{ aspectRatio: aspect.replace(':', '/') }}
            onPointerMove={(event) => {
              if (!drag || !previewRef.current) return;
              const rect = previewRef.current.getBoundingClientRect();
              const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
              const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
              guide(
                drag,
                drag === 'width'
                  ? Math.abs(x - settings.guides.centreX) * 2
                  : drag === 'centreX'
                    ? x
                    : y,
              );
            }}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
          >
            <img
              alt={`${labels[angle]} cropped composition preview`}
              src={preview.url}
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{
                width: `${100 / settings.crop.width}%`,
                height: `${100 / settings.crop.height}%`,
                left: `${(-settings.crop.x / settings.crop.width) * 100}%`,
                top: `${(-settings.crop.y / settings.crop.height) * 100}%`,
              }}
            />
            <svg
              aria-hidden="true"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
            >
              {(['centreX', 'baseY', 'width'] as const).map((key) => {
                const vertical = key === 'centreX' || key === 'width';
                const position =
                  key === 'width'
                    ? settings.guides.centreX + settings.guides.width / 2
                    : settings.guides[key];
                const props = vertical
                  ? { x1: position * 100, x2: position * 100, y1: 0, y2: 100 }
                  : { x1: 0, x2: 100, y1: position * 100, y2: position * 100 };
                return (
                  <g key={key}>
                    <line {...props} stroke="white" strokeWidth="1" />
                    <line {...props} stroke="black" strokeWidth="0.4" />
                    <line
                      {...props}
                      stroke="transparent"
                      strokeWidth="6"
                      className="cursor-move"
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setDrag(key);
                      }}
                    />
                  </g>
                );
              })}
              {boundary && (
                <g>
                  <line
                    x1={0}
                    x2={100}
                    y1={boundary.left * 100}
                    y2={boundary.right * 100}
                    stroke="white"
                    strokeWidth="1"
                  />
                  <line
                    x1={0}
                    x2={100}
                    y1={boundary.left * 100}
                    y2={boundary.right * 100}
                    stroke="black"
                    strokeWidth="0.4"
                    strokeDasharray="2 2"
                  />
                  {/* Each half of the line moves its own edge, so the slope can be dragged. */}
                  {(
                    [
                      ['boundaryY', 0, 50],
                      ['boundaryRightY', 50, 100],
                    ] as const
                  ).map(([key, x1, x2]) => {
                    const at = (x: number): number =>
                      (boundary.left + ((boundary.right - boundary.left) * x) / 100) * 100;
                    return (
                      <line
                        key={key}
                        x1={x1}
                        x2={x2}
                        y1={at(x1)}
                        y2={at(x2)}
                        stroke="transparent"
                        strokeWidth="6"
                        className="cursor-ns-resize"
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          setDrag(key);
                        }}
                      />
                    );
                  })}
                </g>
              )}
            </svg>
          </div>
          <p className="text-xs">
            Drag the guides or use the percentage controls. Y is measured from the top. Dashed line:
            wall/table boundary. Drag its left or right half to tilt it for an angled background.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Percentage
              label="Product centre X"
              value={settings.guides.centreX}
              min={settings.guides.width / 2}
              max={1 - settings.guides.width / 2}
              onChange={(value) => guide('centreX', value)}
            />
            <Percentage
              label="Product base Y"
              value={settings.guides.baseY}
              onChange={(value) => guide('baseY', value)}
            />
            <Percentage
              label="Product width"
              value={settings.guides.width}
              min={0.01}
              max={2 * Math.min(settings.guides.centreX, 1 - settings.guides.centreX)}
              onChange={(value) => guide('width', value)}
            />
            <div>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={boundary !== null}
                  onChange={(event) => {
                    const guides = { ...settings.guides };
                    if (event.target.checked) {
                      guides.boundaryY = 0.45;
                      guides.boundaryRightY = 0.45;
                    } else {
                      delete guides.boundaryY;
                      delete guides.boundaryRightY;
                    }
                    onChange({ ...settings, guides });
                  }}
                />
                Wall/table boundary
              </label>
              {boundary && (
                <div className="space-y-3">
                  <Percentage
                    label="Boundary at left edge Y"
                    value={boundary.left}
                    onChange={(value) => guide('boundaryY', value)}
                  />
                  <Percentage
                    label="Boundary at right edge Y"
                    value={boundary.right}
                    onChange={(value) => guide('boundaryRightY', value)}
                  />
                </div>
              )}
            </div>
          </div>
          <details className="rounded-xl border border-[var(--base-color-brand--umber)] p-3">
            <summary className="cursor-pointer text-sm">Adjust reference crop</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Percentage
                label="Crop width"
                value={settings.crop.width}
                min={0.05}
                max={Math.min(
                  1,
                  Number(aspect.split(':')[0]) /
                    Number(aspect.split(':')[1]) /
                    (preview.width / preview.height),
                )}
                onChange={(width) => {
                  const height =
                    (width * (preview.width / preview.height)) /
                    (Number(aspect.split(':')[0]) / Number(aspect.split(':')[1]));
                  crop({
                    width,
                    height,
                    x: Math.min(settings.crop.x, 1 - width),
                    y: Math.min(settings.crop.y, 1 - height),
                  });
                }}
              />
              <Percentage
                label="Crop left"
                value={settings.crop.x}
                max={1 - settings.crop.width}
                onChange={(x) => crop({ x })}
              />
              <Percentage
                label="Crop top"
                value={settings.crop.y}
                max={1 - settings.crop.height}
                onChange={(y) => crop({ y })}
              />
            </div>
          </details>
        </>
      )}
    </section>
  );
}
export function CompositionTemplateEditor({
  template,
  referenceAngle,
  onClose,
  onSaved,
}: {
  template?: ShootTemplate;
  referenceAngle?: ShootAngle;
  onClose: () => void;
  onSaved: (template: ShootTemplate) => void;
}): ReactElement {
  const [draft, setDraft] = useState(() => initialDraft(template));
  const [angle, setAngle] = useState<ShootAngle>(referenceAngle ?? 'eye-level');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  async function save(): Promise<void> {
    if (saving || uploading) return;
    setSaving(true);
    setError('');
    try {
      const result = template
        ? await window.api.shootTemplates.update(template.id, template.revision, draft)
        : await window.api.shootTemplates.create(draft);
      onSaved(result);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save. Your draft is still open.',
      );
    } finally {
      setSaving(false);
    }
  }
  const other: ShootAngle = angle === 'eye-level' ? 'elevated-45' : 'eye-level';
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby="composition-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      className="m-auto max-h-[90dvh] w-[min(44rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-[var(--base-color-brand--umber)] bg-[var(--base-color-brand--champagne)] p-6 text-[var(--text-color--text-primary)] shadow-xl backdrop:bg-black/50"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void save();
        }}
        className="space-y-4"
      >
        <h2 id="composition-title" className="text-xl font-semibold">
          {template ? 'Edit composition' : 'New composition'}
        </h2>
        <p className="text-sm">Guides framing and background alignment. Results may vary.</p>
        <fieldset
          disabled={saving || uploading}
          aria-busy={saving || uploading}
          className={`space-y-4 ${saving || uploading ? 'pointer-events-none' : ''}`}
        >
          <label className="block text-sm">
            Template name
            <input
              autoFocus
              required
              maxLength={100}
              className={`${control} mt-1 block w-full`}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
            />
          </label>
          <fieldset>
            <legend className="mb-2 text-sm">Fixed output aspect</legend>
            {Object.keys(draft.angles).length > 0 ? (
              <p className="text-sm">
                {draft.aspectRatio} · Remove all references to change aspect.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {SHOOT_ASPECTS.map((aspect) => (
                  <label key={aspect} className={`${control} flex items-center gap-2`}>
                    <input
                      type="radio"
                      name="composition-aspect"
                      checked={draft.aspectRatio === aspect}
                      disabled={Object.keys(draft.angles).length > 0}
                      onChange={() => setDraft({ ...draft, aspectRatio: aspect })}
                    />
                    {aspect}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {referenceAngle ? (
            <p className="text-sm font-semibold">{labels[referenceAngle]} reference</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {SHOOT_ANGLES.map((value) => (
                <button
                  className={control}
                  type="button"
                  key={value}
                  aria-pressed={angle === value}
                  style={
                    angle === value
                      ? {
                          background: 'var(--base-color-brand--bean)',
                          color: 'var(--base-color-brand--shell)',
                        }
                      : undefined
                  }
                  onClick={() => setAngle(value)}
                >
                  {labels[value]}
                  {draft.angles[value] ? ' · Ready' : ' · No reference'}
                </button>
              ))}
            </div>
          )}
          <AngleEditor
            key={`${angle}:${draft.aspectRatio}`}
            angle={angle}
            settings={draft.angles[angle]}
            aspect={draft.aspectRatio}
            onError={setError}
            onBusy={setUploading}
            onChange={(settings) => {
              setError('');
              setDraft((current) => ({
                ...current,
                angles: { ...current.angles, [angle]: settings },
              }));
            }}
          />
          <div className="flex flex-wrap gap-2">
            {!referenceAngle && draft.angles[other] && (
              <button
                type="button"
                className={control}
                onClick={() => {
                  const source = draft.angles[other];
                  if (source)
                    setDraft({
                      ...draft,
                      angles: { ...draft.angles, [angle]: structuredClone(source) },
                    });
                }}
              >
                Use same reference as {labels[other]}
              </button>
            )}
            {draft.angles[angle] && (
              <button
                type="button"
                className={control}
                onClick={() => {
                  const angles = { ...draft.angles };
                  delete angles[angle];
                  setDraft({ ...draft, angles });
                }}
              >
                Remove this reference
              </button>
            )}
          </div>
        </fieldset>
        <p className="text-xs">
          Use photos you own or have permission to use. Editing stays local. When you click
          Generate, composition images are sent with product photos to your selected provider.
        </p>
        {error && (
          <p role="alert" className="text-sm font-semibold">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={saving} className={control} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || uploading}
            className={`${control} font-semibold`}
          >
            {uploading ? 'Preparing photo…' : saving ? 'Saving…' : 'Save composition'}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
