import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import type { GeneratedImage } from './types';
import {
  cropRoundLabel,
  cropRectangleLabel,
  drawApprovedLabel,
  type LabelPlacement,
  type LabelFeather,
  type MaskStroke,
} from '@/lib/labelCompositor';
import { cleanIpcError } from '@/lib/ipcError';

const control = 'w-full accent-[var(--base-color-brand--cinamon)]';
const initialPlacement: LabelPlacement = {
  x: 0.72,
  y: 0.42,
  width: 0.22,
  heightRatio: 1,
  rotation: 0,
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be opened.'));
    image.src = url;
  });
}

interface LabelCrop {
  shape: 'circle' | 'rectangle';
  x: number;
  y: number;
  size: number;
  width: number;
  height: number;
}

interface EditSnapshot {
  crop: LabelCrop;
  placement: LabelPlacement;
  feather: LabelFeather;
  erased: MaskStroke[];
  eraseMode: boolean;
  brushRadius: number;
  brushPoint: { x: number; y: number };
}

const initialCrop: LabelCrop = {
  shape: 'circle',
  x: 0.5,
  y: 0.5,
  size: 0.4,
  width: 0.4,
  height: 0.4,
};

interface ApprovedLabelEditorProps {
  image: GeneratedImage;
  onClose: () => void;
  onSaved: (image: GeneratedImage) => void;
}

export function ApprovedLabelEditor({
  image,
  onClose,
  onSaved,
}: ApprovedLabelEditorProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [background, setBackground] = useState<HTMLImageElement | null>(null);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [label, setLabel] = useState<HTMLImageElement | null>(null);
  const [removedLabel, setRemovedLabel] = useState<HTMLImageElement | null>(null);
  const [placement, setPlacement] = useState<LabelPlacement>(initialPlacement);
  const [feather, setFeather] = useState<LabelFeather>({ left: 0, right: 0, top: 0, bottom: 0 });
  const [eraseMode, setEraseMode] = useState(false);
  const [brushRadius, setBrushRadius] = useState(0.012);
  const [brushPoint, setBrushPoint] = useState({ x: 0.5, y: 0.5 });
  const [erased, setErased] = useState<MaskStroke[]>([]);
  const [crop, setCrop] = useState<LabelCrop>(initialCrop);
  const undoHistory = useRef<EditSnapshot[]>([]);
  const sliderGesture = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  function rememberEdit(): void {
    if (sliderGesture.current) return;
    undoHistory.current = [
      ...undoHistory.current.slice(-49),
      {
        crop,
        placement,
        feather,
        erased,
        eraseMode,
        brushRadius,
        brushPoint,
      },
    ];
    setCanUndo(true);
  }

  function clearUndo(): void {
    undoHistory.current = [];
    setCanUndo(false);
  }

  const undoEdit = useCallback((): void => {
    const previous = undoHistory.current.pop();
    if (!previous) return;
    setCrop(previous.crop);
    setPlacement(previous.placement);
    setFeather(previous.feather);
    setErased(previous.erased);
    setEraseMode(previous.eraseMode);
    setBrushRadius(previous.brushRadius);
    setBrushPoint(previous.brushPoint);
    setCanUndo(undoHistory.current.length > 0);
  }, []);

  useEffect(() => {
    const handleUndo = (event: KeyboardEvent): void => {
      if (!dialogRef.current?.open || busy || event.defaultPrevented) return;
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'z'
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target.closest(
            'textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])',
          ))
      )
        return;
      event.preventDefault();
      undoEdit();
    };
    document.addEventListener('keydown', handleUndo);
    return () => document.removeEventListener('keydown', handleUndo);
  }, [busy, undoEdit]);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      window.api.images.preview(image.id),
      window.api.images.approvedLabel().catch(() => {
        if (active) toast.error('Saved label could not be opened. Choose a new label photo.');
        return null;
      }),
    ])
      .then(async ([preview, approved]) => {
        const [base, savedLabel] = await Promise.all([
          loadImage(preview),
          approved
            ? loadImage(approved).catch(() => {
                if (active)
                  toast.error('Saved label could not be opened. Choose a new label photo.');
                return null;
              })
            : Promise.resolve(null),
        ]);
        if (active) {
          setBackground(base);
          setLabel(savedLabel);
        }
      })
      .catch((error: unknown) => {
        if (active) toast.error(cleanIpcError(error, 'Could not open this image.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    };
  }, [image.id]);

  useEffect(() => {
    if (!canvasRef.current || !background) return;
    try {
      drawApprovedLabel(
        canvasRef.current,
        background,
        label ?? background,
        label && !source ? placement : { ...placement, width: 0 },
        760,
        erased,
        feather,
      );
    } catch {
      toast.error('Could not draw the preview.');
    }
  }, [background, label, source, placement, erased, feather]);

  async function selectFile(file?: File): Promise<void> {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024) {
      toast.error('Choose a PNG, JPEG or WebP photo under 20 MB.');
      return;
    }
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    const url = URL.createObjectURL(file);
    sourceUrlRef.current = url;
    try {
      const loaded = await loadImage(url);
      if (sourceUrlRef.current !== url) return;
      if (loaded.naturalWidth * loaded.naturalHeight > 40_000_000)
        throw new Error('Choose a photo under 40 megapixels.');
      setSource(loaded);
      setCrop(initialCrop);
      clearUndo();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the photo.');
    }
  }

  async function saveCrop(): Promise<void> {
    if (!source || busy) return;
    setBusy(true);
    try {
      const png =
        crop.shape === 'circle'
          ? cropRoundLabel(source, crop.x, crop.y, crop.size)
          : cropRectangleLabel(source, crop.x, crop.y, crop.width, crop.height);
      await window.api.images.saveApprovedLabel(png);
      setLabel(await loadImage(png));
      setErased([]);
      setRemovedLabel(null);
      setSource(null);
      clearUndo();
      toast.success('Approved label saved for reuse.');
    } catch (error) {
      toast.error(cleanIpcError(error, 'Could not save the label.'));
    } finally {
      setBusy(false);
    }
  }

  function cancelCrop(): void {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = null;
    setSource(null);
    clearUndo();
  }

  async function removeLabel(): Promise<void> {
    if (!label || busy) return;
    setBusy(true);
    try {
      await window.api.images.removeApprovedLabel();
      setRemovedLabel(label);
      setLabel(null);
      setErased([]);
      clearUndo();
      toast.success('Saved label removed. Your cake images are unchanged.');
    } catch (error) {
      toast.error(cleanIpcError(error, 'Could not remove the label.'));
    } finally {
      setBusy(false);
    }
  }

  async function restoreLabel(): Promise<void> {
    if (!removedLabel || busy) return;
    setBusy(true);
    try {
      await window.api.images.saveApprovedLabel(removedLabel.src);
      setLabel(removedLabel);
      setRemovedLabel(null);
      clearUndo();
    } catch (error) {
      toast.error(cleanIpcError(error, 'Could not restore the label.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveImage(): Promise<void> {
    if (!background || !label || busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      drawApprovedLabel(canvas, background, label, placement, undefined, erased, feather);
      const saved = await window.api.images.save({
        url: canvas.toDataURL('image/png'),
        prompt: `${image.prompt} (approved label)`,
        aspectRatio: image.aspectRatio,
        model: image.model,
      });
      onSaved(saved);
      toast.success('Saved a corrected copy. The original is unchanged.');
      onClose();
    } catch (error) {
      toast.error(cleanIpcError(error, 'Could not save the corrected image.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto max-h-[100vh] w-[min(96vw,72rem)] max-w-[100vw] overflow-y-auto border-0 bg-transparent p-4 text-[var(--base-color-brand--bean)] backdrop:bg-[var(--base-color-brand--bean)]/90"
      aria-labelledby="approved-label-title"
      onPointerDownCapture={(event) => {
        if (!busy && event.target instanceof HTMLInputElement && event.target.type === 'range') {
          rememberEdit();
          sliderGesture.current = true;
        }
      }}
      onPointerUpCapture={() => {
        sliderGesture.current = false;
      }}
      onPointerCancelCapture={() => {
        sliderGesture.current = false;
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 rounded-2xl bg-[var(--base-color-brand--champagne)] p-4 sm:p-6">
        <header className="flex items-center justify-between gap-4">
          <h2 id="approved-label-title" className="text-xl font-semibold">
            Correct cake label
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-cinamon btn-sm"
              onClick={undoEdit}
              disabled={busy || !canUndo}
              title="Undo (⌘Z / Ctrl+Z)"
            >
              Undo
            </button>
            <button type="button" className="btn-cinamon btn-sm" onClick={onClose} disabled={busy}>
              Close
            </button>
          </div>
        </header>
        <div className="grid min-h-0 gap-6 lg:grid-cols-[minmax(0,1fr)_270px]">
          <div className="flex min-h-0 items-center justify-center rounded-xl bg-[var(--base-color-brand--bean)] p-2 lg:sticky lg:top-0 lg:self-start">
            {loading ? (
              <p className="text-white" role="status">
                Opening image…
              </p>
            ) : background ? (
              <canvas
                ref={canvasRef}
                role="img"
                aria-label="Preview of the corrected image. Review the label and any overlapping decorations before saving."
                className="max-h-[70vh] max-w-full touch-none object-contain"
                onPointerDown={(event) => {
                  if (!label || busy) return;
                  rememberEdit();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  if (eraseMode) {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setErased((current) => [
                      ...current,
                      {
                        radius: brushRadius,
                        points: [
                          {
                            x: (event.clientX - rect.left) / rect.width,
                            y: (event.clientY - rect.top) / rect.height,
                          },
                        ],
                      },
                    ]);
                  }
                }}
                onPointerMove={(event) => {
                  if (!label || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
                  if (eraseMode)
                    setErased((current) =>
                      current.map((stroke, index) =>
                        index === current.length - 1
                          ? { ...stroke, points: [...stroke.points, { x, y }] }
                          : stroke,
                      ),
                    );
                  else {
                    setPlacement((current) => ({ ...current, x, y }));
                    setErased([]);
                  }
                }}
              />
            ) : (
              <p className="text-white">This image could not be opened. Close and retry.</p>
            )}
          </div>
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                aria-label="Choose real label photo"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                tabIndex={-1}
                disabled={busy || loading}
                onChange={(event) => {
                  void selectFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                className="btn-cinamon btn-sm w-full"
                disabled={busy || loading}
                onClick={() => fileInputRef.current?.click()}
              >
                {source
                  ? 'Choose another photo'
                  : label
                    ? 'Replace saved label'
                    : 'Choose label photo'}
              </button>
              {label && !source && (
                <button
                  type="button"
                  className="btn-cinamon btn-sm w-full"
                  disabled={busy || loading}
                  onClick={() => void removeLabel()}
                >
                  Remove saved label
                </button>
              )}
              {removedLabel && !label && !source && (
                <button
                  type="button"
                  className="btn-cinamon btn-sm w-full"
                  disabled={busy}
                  onClick={() => void restoreLabel()}
                >
                  Undo removal
                </button>
              )}
            </div>
            {source && (
              <section className="space-y-2 rounded-xl border border-[var(--base-color-brand--umber)]/50 p-3">
                <h3 className="font-semibold">Crop the label</h3>
                <fieldset className="flex items-center gap-3 text-sm" disabled={busy}>
                  <legend className="sr-only">Crop shape</legend>
                  {(['circle', 'rectangle'] as const).map((shape) => (
                    <label key={shape} className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="label-crop-shape"
                        value={shape}
                        checked={crop.shape === shape}
                        onChange={() => {
                          rememberEdit();
                          setCrop((current) => ({ ...current, shape }));
                        }}
                      />
                      {shape === 'circle' ? 'Circle' : 'Rectangle'}
                    </label>
                  ))}
                </fieldset>
                <div
                  className="relative mx-auto w-fit max-w-full cursor-crosshair touch-none select-none"
                  onPointerDown={(event) => {
                    if (busy) return;
                    event.preventDefault();
                    rememberEdit();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const rect = event.currentTarget.getBoundingClientRect();
                    setCrop((current) => ({
                      ...current,
                      x: (event.clientX - rect.left) / rect.width,
                      y: (event.clientY - rect.top) / rect.height,
                    }));
                  }}
                  onPointerMove={(event) => {
                    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    setCrop((current) => ({
                      ...current,
                      x: (event.clientX - rect.left) / rect.width,
                      y: (event.clientY - rect.top) / rect.height,
                    }));
                  }}
                >
                  <img
                    src={source.src}
                    alt="Source photo for label crop"
                    draggable={false}
                    className="max-h-52 max-w-full"
                  />
                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute border-2 border-white shadow-[0_0_0_1px_black] ${crop.shape === 'circle' ? 'rounded-full' : ''}`}
                    style={{
                      left: `${(crop.x - (crop.shape === 'rectangle' ? crop.width : (crop.size * Math.min(source.naturalWidth, source.naturalHeight)) / source.naturalWidth) / 2) * 100}%`,
                      top: `${(crop.y - (crop.shape === 'rectangle' ? crop.height : (crop.size * Math.min(source.naturalWidth, source.naturalHeight)) / source.naturalHeight) / 2) * 100}%`,
                      width: `${(crop.shape === 'rectangle' ? crop.width : (crop.size * Math.min(source.naturalWidth, source.naturalHeight)) / source.naturalWidth) * 100}%`,
                      height: `${(crop.shape === 'rectangle' ? crop.height : (crop.size * Math.min(source.naturalWidth, source.naturalHeight)) / source.naturalHeight) * 100}%`,
                    }}
                  />
                </div>
                {(crop.shape === 'circle'
                  ? (['x', 'y', 'size'] as const)
                  : (['x', 'y', 'width', 'height'] as const)
                ).map((key) => (
                  <label key={key} className="block text-sm">
                    {key === 'x'
                      ? 'Centre left/right'
                      : key === 'y'
                        ? 'Centre up/down'
                        : key === 'size'
                          ? 'Circle size'
                          : key === 'width'
                            ? 'Crop width'
                            : 'Crop height'}
                    : {Math.round(crop[key] * 100)}%
                    <input
                      className={control}
                      type="range"
                      min={key === 'x' || key === 'y' ? 0 : 5}
                      max={100}
                      value={Math.round(crop[key] * 100)}
                      disabled={busy}
                      onChange={(event) => {
                        rememberEdit();
                        setCrop((current) => ({
                          ...current,
                          [key]: Number(event.target.value) / 100,
                        }));
                      }}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  className="btn-cinamon btn-sm"
                  onClick={() => void saveCrop()}
                  disabled={busy}
                >
                  {label ? 'Replace saved label with crop' : 'Save label for reuse'}
                </button>
                <button
                  type="button"
                  className="btn-cinamon btn-sm"
                  disabled={busy}
                  onClick={cancelCrop}
                >
                  Cancel crop
                </button>
              </section>
            )}
            {label && !source && (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <img
                    src={label.src}
                    alt="Saved approved label"
                    className="h-16 w-16 object-contain"
                  />
                  <span>
                    This label is reused until you replace it. Apply it only to cakes from this
                    client.
                  </span>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={eraseMode}
                    onChange={(event) => {
                      rememberEdit();
                      setEraseMode(event.target.checked);
                    }}
                  />
                  Reveal decorations in front of the label
                </label>
                {eraseMode && (
                  <>
                    <label className="text-sm">
                      Brush size{' '}
                      <input
                        className={control}
                        type="range"
                        min="0.004"
                        max="0.05"
                        step="0.002"
                        value={brushRadius}
                        onChange={(event) => {
                          rememberEdit();
                          setBrushRadius(Number(event.target.value));
                        }}
                      />
                    </label>
                    {(['x', 'y'] as const).map((axis) => (
                      <label key={axis} className="text-sm">
                        Brush {axis === 'x' ? 'left / right' : 'up / down'}:{' '}
                        {Math.round(brushPoint[axis] * 100)}%
                        <input
                          className={control}
                          type="range"
                          min="0"
                          max="100"
                          value={Math.round(brushPoint[axis] * 100)}
                          onChange={(event) => {
                            rememberEdit();
                            setBrushPoint((current) => ({
                              ...current,
                              [axis]: Number(event.target.value) / 100,
                            }));
                          }}
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      className="btn-cinamon btn-sm"
                      onClick={() => {
                        rememberEdit();
                        setErased((current) => [
                          ...current,
                          { radius: brushRadius, points: [brushPoint] },
                        ]);
                      }}
                    >
                      Reveal at brush position
                    </button>
                    <button
                      type="button"
                      className="btn-cinamon btn-sm"
                      disabled={!erased.length}
                      onClick={() => {
                        rememberEdit();
                        setErased((current) => current.slice(0, -1));
                      }}
                    >
                      Undo last brush stroke
                    </button>
                  </>
                )}
                <p className="text-sm">
                  Drag the label or use the controls. Turn on the brush to reveal decorations in
                  front; review the text before saving.
                </p>
                {(
                  [
                    ['x', 'Left / right', 0, 100, 100],
                    ['y', 'Up / down', 0, 100, 100],
                    ['width', 'Size', 5, 60, 100],
                    ['heightRatio', 'Height', 60, 130, 100],
                    ['rotation', 'Rotation', -45, 45, 1],
                  ] as const
                ).map(([key, text, min, max, factor]) => (
                  <label key={key} className="block text-sm">
                    {text}: {Math.round(placement[key] * factor)}
                    {key === 'rotation' ? '°' : '%'}
                    <input
                      className={control}
                      type="range"
                      min={min}
                      max={max}
                      value={Math.round(placement[key] * factor)}
                      onChange={(event) => {
                        rememberEdit();
                        setPlacement((current) => ({
                          ...current,
                          [key]: Number(event.target.value) / factor,
                        }));
                        setErased([]);
                      }}
                    />
                  </label>
                ))}
                <fieldset className="space-y-2" disabled={busy}>
                  <legend className="font-semibold">Edge feather</legend>
                  <p className="text-sm">Fade inward from each edge; 0% keeps it sharp.</p>
                  {(['left', 'right', 'top', 'bottom'] as const).map((edge) => (
                    <label key={edge} className="block text-sm">
                      Feather {edge}: {feather[edge]}%
                      <input
                        type="range"
                        className={control}
                        min={0}
                        max={50}
                        step={1}
                        value={feather[edge]}
                        onChange={(event) => {
                          rememberEdit();
                          setFeather((current) => ({
                            ...current,
                            [edge]: Number(event.target.value),
                          }));
                        }}
                      />
                    </label>
                  ))}
                </fieldset>
                <button
                  type="button"
                  className="btn-cinamon btn-sm"
                  disabled={busy || !background}
                  onClick={() => void saveImage()}
                >
                  {busy ? 'Saving…' : 'Save corrected copy'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
