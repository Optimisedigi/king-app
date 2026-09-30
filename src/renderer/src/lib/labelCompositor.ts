export interface MaskStroke {
  points: ReadonlyArray<{ x: number; y: number }>;
  radius: number;
}

export interface LabelFeather {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface LabelPlacement {
  x: number;
  y: number;
  width: number;
  heightRatio: number;
  rotation: number;
}

function featherLabelEdges(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  feather: Readonly<LabelFeather>,
): void {
  function fadeEdge(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    x: number,
    y: number,
    edgeWidth: number,
    edgeHeight: number,
  ): void {
    if (edgeWidth <= 0 || edgeHeight <= 0) return;
    const gradient = context.createLinearGradient(fromX, fromY, toX, toY);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(x, y, edgeWidth, edgeHeight);
  }
  const left = (width * feather.left) / 100;
  const right = (width * feather.right) / 100;
  const top = (height * feather.top) / 100;
  const bottom = (height * feather.bottom) / 100;
  fadeEdge(-width / 2, 0, -width / 2 + left, 0, -width / 2, -height / 2, left, height);
  fadeEdge(width / 2, 0, width / 2 - right, 0, width / 2 - right, -height / 2, right, height);
  fadeEdge(0, -height / 2, 0, -height / 2 + top, -width / 2, -height / 2, width, top);
  fadeEdge(0, height / 2, 0, height / 2 - bottom, -width / 2, height / 2 - bottom, width, bottom);
}

/** Draw at preview or original resolution using the same normalized placement. */
export function drawApprovedLabel(
  canvas: HTMLCanvasElement,
  background: HTMLImageElement,
  label: HTMLImageElement,
  placement: LabelPlacement,
  maxEdge?: number,
  erased: ReadonlyArray<MaskStroke> = [],
  feather: Readonly<LabelFeather> = { left: 0, right: 0, top: 0, bottom: 0 },
): void {
  const scale = maxEdge
    ? Math.min(1, maxEdge / Math.max(background.naturalWidth, background.naturalHeight))
    : 1;
  canvas.width = Math.round(background.naturalWidth * scale);
  canvas.height = Math.round(background.naturalHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image editing is unavailable.');
  context.drawImage(background, 0, 0, canvas.width, canvas.height);
  if (!placement.width) return;
  if (!erased.length && !Object.values(feather).some((percent) => percent > 0)) {
    const width = canvas.width * placement.width;
    const height = width * (label.naturalHeight / label.naturalWidth) * placement.heightRatio;
    context.save();
    context.translate(canvas.width * placement.x, canvas.height * placement.y);
    context.rotate((placement.rotation * Math.PI) / 180);
    context.drawImage(label, -width / 2, -height / 2, width, height);
    context.restore();
    return;
  }
  const layer = document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  const layerContext = layer.getContext('2d');
  if (!layerContext) throw new Error('Image editing is unavailable.');
  const width = canvas.width * placement.width;
  const height = width * (label.naturalHeight / label.naturalWidth) * placement.heightRatio;
  layerContext.translate(canvas.width * placement.x, canvas.height * placement.y);
  layerContext.rotate((placement.rotation * Math.PI) / 180);
  layerContext.drawImage(label, -width / 2, -height / 2, width, height);
  layerContext.globalCompositeOperation = 'destination-out';
  featherLabelEdges(layerContext, width, height, feather);
  layerContext.setTransform(1, 0, 0, 1, 0, 0);
  layerContext.fillStyle = '#000';
  layerContext.lineCap = 'round';
  layerContext.lineJoin = 'round';
  for (const stroke of erased) {
    const first = stroke.points[0];
    if (!first) continue;
    layerContext.lineWidth = stroke.radius * 2 * canvas.width;
    layerContext.beginPath();
    layerContext.moveTo(first.x * canvas.width, first.y * canvas.height);
    for (const point of stroke.points)
      layerContext.lineTo(point.x * canvas.width, point.y * canvas.height);
    if (stroke.points.length === 1) {
      layerContext.arc(
        first.x * canvas.width,
        first.y * canvas.height,
        stroke.radius * canvas.width,
        0,
        Math.PI * 2,
      );
      layerContext.fill();
    } else layerContext.stroke();
  }
  context.drawImage(layer, 0, 0);
}

export function cropRectangleLabel(
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const cropWidth = image.naturalWidth * width;
  const cropHeight = image.naturalHeight * height;
  const left = image.naturalWidth * x - cropWidth / 2;
  const top = image.naturalHeight * y - cropHeight / 2;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    cropWidth <= 0 ||
    cropHeight <= 0 ||
    left < 0 ||
    top < 0 ||
    left + cropWidth > image.naturalWidth ||
    top + cropHeight > image.naturalHeight
  )
    throw new Error('Keep the full rectangle inside the source photo.');
  const canvas = document.createElement('canvas');
  const scale = 1024 / Math.max(cropWidth, cropHeight);
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image editing is unavailable.');
  context.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function cropRoundLabel(
  image: HTMLImageElement,
  x: number,
  y: number,
  size: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image editing is unavailable.');
  const side = Math.min(image.naturalWidth, image.naturalHeight) * size;
  const left = image.naturalWidth * x - side / 2;
  const top = image.naturalHeight * y - side / 2;
  if (
    side <= 0 ||
    left < 0 ||
    top < 0 ||
    left + side > image.naturalWidth ||
    top + side > image.naturalHeight
  )
    throw new Error('Keep the full circle inside the source photo.');
  context.beginPath();
  context.arc(512, 512, 509, 0, 2 * Math.PI);
  context.clip();
  context.drawImage(image, left, top, side, side, 0, 0, 1024, 1024);
  return canvas.toDataURL('image/png');
}
