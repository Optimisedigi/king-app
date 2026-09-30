import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
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

/** Normal keyboard steps are half a unit; holding Shift gives micro steps. */
const KEY_STEP = 0.5;
const FINE_KEY_STEP = 0.1;
/** Holding Shift while dragging moves at a tenth of the pointer's speed. */
const FINE_DRAG_SCALE = 0.1;

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Arrow keys on a slider: 0.5 per press, or 0.1 with Shift.
 * Returns the new slider value, or null when the key is not an arrow.
 */
function nudgeSlider(
  event: ReactKeyboardEvent<HTMLInputElement>,
  value: number,
  min: number,
  max: number,
): number | null {
  const direction =
    event.key === 'ArrowUp' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
        ? -1
        : 0;
  if (direction === 0 || event.altKey || event.metaKey || event.ctrlKey) return null;
  event.preventDefault();
  return roundTenth(
    clamp(value + direction * (event.shiftKey ? FINE_KEY_STEP : KEY_STEP), min, max),
  );
}

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

interface BrushOverlayProps {
  /** Preview height divided by width. */
  aspect: number;
  strokes: ReadonlyArray<MaskStroke>;
  /** Brush radius as a fraction of the preview width, the same unit the mask uses. */
  radius: number;
  hover: { x: number; y: number } | null;
  point: { x: number; y: number };
}

/**
 * Display-only guide drawn over the preview while brushing: a tint over areas
 * already brushed, the brush outline under the pointer, and a dashed marker at
 * the slider position used by "Reveal at brush position". Never exported.
 */
function BrushOverlay({ aspect, strokes, radius, hover, point }: BrushOverlayProps): ReactElement {
  const toView = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: p.x,
    y: p.y * aspect,
  });
  return (
    <svg
      aria-hidden="true"
      data-testid="brush-overlay"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 1 ${aspect}`}
      preserveAspectRatio="none"
    >
      <g opacity={0.4} fill="#d63a5a" stroke="#d63a5a" strokeLinecap="round" strokeLinejoin="round">
        {strokes.map((stroke, index) => {
          const points = stroke.points.map(toView);
          const first = points[0];
          if (!first) return null;
          return points.length === 1 ? (
            <circle key={index} cx={first.x} cy={first.y} r={stroke.radius} stroke="none" />
          ) : (
            <polyline
              key={index}
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              strokeWidth={stroke.radius * 2}
            />
          );
        })}
      </g>
      <circle
        data-testid="brush-point"
        cx={point.x}
        cy={point.y * aspect}
        r={radius}
        fill="none"
        stroke="white"
        strokeWidth={0.003}
        strokeDasharray="0.008 0.006"
      />
      {hover && (
        <g data-testid="brush-cursor">
          <circle
            cx={hover.x}
            cy={hover.y * aspect}
            r={radius}
            fill="none"
            stroke="black"
            strokeWidth={0.005}
          />
          <circle
            cx={hover.x}
            cy={hover.y * aspect}
            r={radius}
            fill="none"
            stroke="white"
            strokeWidth={0.0025}
          />
        </g>
      )}
    </svg>
  );
}

interface SavedLabel {
  id: string;
  image: HTMLImageElement;
}

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
  /** Last pointer position during a crop or label drag, for relative (and Shift-slowed) moves. */
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const [background, setBackground] = useState<HTMLImageElement | null>(null);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  /** Saved label library, oldest first. */
  const [labels, setLabels] = useState<SavedLabel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The most recently removed label, so its removal can be undone. */
  const [removedLabel, setRemovedLabel] = useState<SavedLabel | null>(null);
  const label = labels.find((item) => item.id === selectedId)?.image ?? null;
  const [placement, setPlacement] = useState<LabelPlacement>(initialPlacement);
  const [feather, setFeather] = useState<LabelFeather>({ left: 0, right: 0, top: 0, bottom: 0 });
  const [eraseMode, setEraseMode] = useState(false);
  const [brushRadius, setBrushRadius] = useState(0.012);
  const [brushPoint, setBrushPoint] = useState({ x: 0.5, y: 0.5 });
  /** Pointer position over the preview while brushing, to draw the brush outline. */
  const [brushHover, setBrushHover] = useState<{ x: number; y: number } | null>(null);
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
      window.api.images.approvedLabels().catch(() => {
        if (active) toast.error('Saved labels could not be opened. Add a new label photo.');
        return [];
      }),
    ])
      .then(async ([preview, approved]) => {
        const [base, ...loaded] = await Promise.all([
          loadImage(preview),
          ...approved.map(async (item) => {
            try {
              return { id: item.id, image: await loadImage(item.dataUrl) };
            } catch {
              return null;
            }
          }),
        ]);
        const usable = loaded.filter((item): item is SavedLabel => item !== null);
        if (!active) return;
        if (usable.length < approved.length)
          toast.error('Some saved labels could not be opened and are hidden.');
        setBackground(base);
        setLabels(usable);
        setSelectedId(usable.at(-1)?.id ?? null);
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
      const saved = await window.api.images.saveApprovedLabel(png);
      const image = await loadImage(saved.dataUrl);
      setLabels((current) => [...current, { id: saved.id, image }]);
      setSelectedId(saved.id);
      setErased([]);
      setSource(null);
      clearUndo();
      toast.success('Label saved. It is now selected and can be reused on any cake.');
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

  function selectLabel(id: string): void {
    if (busy || id === selectedId) return;
    setSelectedId(id);
    setErased([]);
    // Brush strokes belong to one label; undo must not bring them back on another.
    clearUndo();
  }

  async function removeLabel(): Promise<void> {
    const index = labels.findIndex((item) => item.id === selectedId);
    const target = labels[index];
    if (!target || busy) return;
    setBusy(true);
    try {
      await window.api.images.removeApprovedLabel(target.id);
      const remaining = labels.filter((item) => item.id !== target.id);
      setLabels(remaining);
      // Select the neighbour so the next removal or save works without an extra click.
      setSelectedId((remaining[index] ?? remaining[index - 1])?.id ?? null);
      setRemovedLabel(target);
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
      await window.api.images.restoreApprovedLabel(removedLabel.id);
      setLabels((current) =>
        [...current, removedLabel].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      );
      setSelectedId(removedLabel.id);
      setRemovedLabel(null);
      setErased([]);
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
        // A corrected copy keeps the original photo's name for exports.
        ...(image.sourceName ? { sourceName: image.sourceName } : {}),
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
            ) : source ? (
              <div
                className="relative cursor-crosshair touch-none select-none"
                style={{
                  // Fill the panel width, scaling small photos up, but never exceed 70% of screen height.
                  width: `min(100%, calc(70vh * ${source.naturalWidth / source.naturalHeight}))`,
                }}
                onPointerDown={(event) => {
                  if (busy) return;
                  event.preventDefault();
                  rememberEdit();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  lastPointer.current = { x: event.clientX, y: event.clientY };
                  // Shift keeps the crop where it is so fine drags start from its current spot.
                  if (event.shiftKey) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  setCrop((current) => ({
                    ...current,
                    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
                    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
                  }));
                }}
                onPointerMove={(event) => {
                  const last = lastPointer.current;
                  if (!last || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const scale = event.shiftKey ? FINE_DRAG_SCALE : 1;
                  const dx = ((event.clientX - last.x) / rect.width) * scale;
                  const dy = ((event.clientY - last.y) / rect.height) * scale;
                  lastPointer.current = { x: event.clientX, y: event.clientY };
                  setCrop((current) => ({
                    ...current,
                    x: clamp(current.x + dx, 0, 1),
                    y: clamp(current.y + dy, 0, 1),
                  }));
                }}
                onPointerUp={() => {
                  lastPointer.current = null;
                }}
                onPointerCancel={() => {
                  lastPointer.current = null;
                }}
              >
                <img
                  src={source.src}
                  alt="Source photo for label crop"
                  draggable={false}
                  className="block"
                  style={{ width: '100%', height: 'auto' }}
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
            ) : background ? (
              <div className="relative w-fit max-w-full">
                <canvas
                  ref={canvasRef}
                  role="img"
                  aria-label="Preview of the corrected image. Review the label and any overlapping decorations before saving."
                  className={`block max-h-[70vh] max-w-full touch-none object-contain ${eraseMode && label ? 'cursor-none' : ''}`}
                  onPointerLeave={() => setBrushHover(null)}
                  onPointerDown={(event) => {
                    if (!label || busy) return;
                    rememberEdit();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    lastPointer.current = { x: event.clientX, y: event.clientY };
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
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
                    if (eraseMode) setBrushHover({ x, y });
                    if (!label || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                    if (eraseMode)
                      setErased((current) =>
                        current.map((stroke, index) =>
                          index === current.length - 1
                            ? { ...stroke, points: [...stroke.points, { x, y }] }
                            : stroke,
                        ),
                      );
                    else {
                      const last = lastPointer.current ?? { x: event.clientX, y: event.clientY };
                      const scale = event.shiftKey ? FINE_DRAG_SCALE : 1;
                      const dx = ((event.clientX - last.x) / rect.width) * scale;
                      const dy = ((event.clientY - last.y) / rect.height) * scale;
                      lastPointer.current = { x: event.clientX, y: event.clientY };
                      setPlacement((current) => ({
                        ...current,
                        x: clamp(current.x + dx, 0, 1),
                        y: clamp(current.y + dy, 0, 1),
                      }));
                      setErased([]);
                    }
                  }}
                  onPointerUp={() => {
                    lastPointer.current = null;
                  }}
                  onPointerCancel={() => {
                    lastPointer.current = null;
                  }}
                />
                {eraseMode && label && (
                  <BrushOverlay
                    aspect={background.naturalHeight / background.naturalWidth}
                    strokes={erased}
                    radius={brushRadius}
                    hover={brushHover}
                    point={brushPoint}
                  />
                )}
              </div>
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
                  : labels.length
                    ? 'Add another label'
                    : 'Choose label photo'}
              </button>
              {label && !source && (
                <button
                  type="button"
                  className="btn-cinamon btn-sm w-full"
                  disabled={busy || loading}
                  onClick={() => void removeLabel()}
                >
                  Remove selected label
                </button>
              )}
              {removedLabel && !source && (
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
                <p className="text-sm">
                  Drag on the large photo to centre the crop. Hold Shift while dragging for fine
                  moves. Slider arrow keys move 0.5%, or 0.1% with Shift.
                </p>
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
                    : {roundTenth(crop[key] * 100)}%
                    <input
                      className={control}
                      type="range"
                      min={key === 'x' || key === 'y' ? 0 : 1}
                      max={100}
                      step={0.1}
                      value={roundTenth(crop[key] * 100)}
                      disabled={busy}
                      onKeyDown={(event) => {
                        const min = key === 'x' || key === 'y' ? 0 : 1;
                        const next = nudgeSlider(event, roundTenth(crop[key] * 100), min, 100);
                        if (next === null) return;
                        rememberEdit();
                        setCrop((current) => ({ ...current, [key]: next / 100 }));
                      }}
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
                  Save label for reuse
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
            {labels.length > 0 && !source && (
              <fieldset className="space-y-2" disabled={busy}>
                <legend className="text-sm font-semibold">
                  Saved labels ({labels.length}) — pick one for this cake
                </legend>
                <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto p-1">
                  {labels.map((item, index) => (
                    <label
                      key={item.id}
                      className={`flex cursor-pointer items-center justify-center rounded-lg border-2 bg-white p-1 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 ${
                        item.id === selectedId
                          ? 'border-[var(--base-color-brand--cinamon)]'
                          : 'border-transparent'
                      }`}
                    >
                      <input
                        type="radio"
                        name="saved-label"
                        className="sr-only"
                        value={item.id}
                        checked={item.id === selectedId}
                        onChange={() => selectLabel(item.id)}
                      />
                      <img
                        src={item.image.src}
                        alt={`Saved label ${index + 1}`}
                        className="h-14 w-full object-contain"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {label && !source && (
              <>
                <p className="text-sm">
                  Check the selected label matches this client&rsquo;s cake before saving.
                </p>
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
                  Drag the label or use the controls; hold Shift for fine moves. Turn on the brush
                  to reveal decorations in front; review the text before saving.
                </p>
                {(
                  [
                    ['x', 'Left / right', 0, 100, 100],
                    ['y', 'Up / down', 0, 100, 100],
                    ['width', 'Size', 1, 60, 100],
                    ['heightRatio', 'Height', 60, 130, 100],
                    ['rotation', 'Rotation', -45, 45, 1],
                  ] as const
                ).map(([key, text, min, max, factor]) => (
                  <label key={key} className="block text-sm">
                    {text}: {roundTenth(placement[key] * factor)}
                    {key === 'rotation' ? '°' : '%'}
                    <input
                      className={control}
                      type="range"
                      min={min}
                      max={max}
                      step={0.1}
                      value={roundTenth(placement[key] * factor)}
                      onKeyDown={(event) => {
                        const next = nudgeSlider(
                          event,
                          roundTenth(placement[key] * factor),
                          min,
                          max,
                        );
                        if (next === null) return;
                        rememberEdit();
                        setPlacement((current) => ({ ...current, [key]: next / factor }));
                        setErased([]);
                      }}
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
