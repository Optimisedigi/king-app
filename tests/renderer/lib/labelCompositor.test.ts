import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  drawApprovedLabel,
  cropRoundLabel,
  cropRectangleLabel,
  type LabelPlacement,
} from '../../../src/renderer/src/lib/labelCompositor';

const placement: LabelPlacement = { x: 0.7, y: 0.4, width: 0.2, heightRatio: 0.8, rotation: 0 };
const image = { naturalWidth: 2000, naturalHeight: 1000 } as HTMLImageElement;
const label = { naturalWidth: 1024, naturalHeight: 1024 } as HTMLImageElement;

function createCanvas() {
  const context = {
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: vi.fn(() => 'data:image/png;base64,test'),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

afterEach(() => vi.unstubAllGlobals());

describe('approved label cropping', () => {
  it('keeps circle crops clipped and square', () => {
    const output = createCanvas();
    vi.stubGlobal('document', { createElement: () => output.canvas });
    expect(cropRoundLabel(image, 0.5, 0.5, 0.4)).toBe('data:image/png;base64,test');
    expect([output.canvas.width, output.canvas.height]).toEqual([1024, 1024]);
    expect(output.context.clip).toHaveBeenCalledOnce();
    expect(output.context.drawImage).toHaveBeenCalledWith(
      image,
      800,
      300,
      400,
      400,
      0,
      0,
      1024,
      1024,
    );
  });

  it('keeps rectangle proportions without clipping the corners', () => {
    const output = createCanvas();
    vi.stubGlobal('document', { createElement: () => output.canvas });
    cropRectangleLabel(image, 0.5, 0.5, 0.4, 0.4);
    expect([output.canvas.width, output.canvas.height]).toEqual([1024, 512]);
    expect(output.context.clip).not.toHaveBeenCalled();
    expect(output.context.drawImage).toHaveBeenCalledWith(
      image,
      600,
      300,
      800,
      400,
      0,
      0,
      1024,
      512,
    );
  });

  it.each([
    [0, 0.5, 0.4, 0.4],
    [1, 0.5, 0.4, 0.4],
    [0.5, 0, 0.4, 0.4],
    [0.5, 0.5, 0, 0.4],
    [0.5, 0.5, 0.4, -1],
    [NaN, 0.5, 0.4, 0.4],
  ])('rejects invalid or out-of-bounds rectangle %j', (x, y, width, height) => {
    expect(() => cropRectangleLabel(image, x, y, width, height)).toThrow(
      'Keep the full rectangle inside the source photo.',
    );
  });
});

describe('approved label composition', () => {
  it('uses the same placement at preview and original resolution', () => {
    const preview = createCanvas();
    drawApprovedLabel(preview.canvas, image, label, placement, 500);
    expect([preview.canvas.width, preview.canvas.height]).toEqual([500, 250]);
    expect(preview.context.translate).toHaveBeenCalledWith(350, 100);
    expect(preview.context.drawImage).toHaveBeenCalledWith(label, -50, -40, 100, 80);

    const original = createCanvas();
    drawApprovedLabel(original.canvas, image, label, placement);
    expect([original.canvas.width, original.canvas.height]).toEqual([2000, 1000]);
    expect(original.context.translate).toHaveBeenCalledWith(1400, 400);
    expect(original.context.drawImage).toHaveBeenCalledWith(label, -200, -160, 400, 320);
  });

  it.each([false, true])('preserves a rectangular label aspect ratio with masking=%s', (masked) => {
    const output = createCanvas();
    const layer = createCanvas();
    const rectangle = { naturalWidth: 1024, naturalHeight: 512 } as HTMLImageElement;
    vi.stubGlobal('document', { createElement: () => layer.canvas });
    drawApprovedLabel(
      output.canvas,
      image,
      rectangle,
      placement,
      500,
      masked ? [{ radius: 0.01, points: [{ x: 0.5, y: 0.5 }] }] : [],
    );
    const context = masked ? layer.context : output.context;
    expect(context.drawImage).toHaveBeenCalledWith(rectangle, -50, -20, 100, 40);
  });

  it.each([
    ['left', [-50, 0, -25, 0], [-50, -20, 25, 40]],
    ['right', [50, 0, 25, 0], [25, -20, 25, 40]],
    ['top', [0, -20, 0, -10], [-50, -20, 100, 10]],
    ['bottom', [0, 20, 0, 10], [-50, 10, 100, 10]],
  ] as const)('feathers only the %s edge inward', (edge, gradient, region) => {
    const output = createCanvas();
    const layer = createCanvas();
    const rectangle = { naturalWidth: 1024, naturalHeight: 512 } as HTMLImageElement;
    vi.stubGlobal('document', { createElement: () => layer.canvas });
    drawApprovedLabel(output.canvas, image, rectangle, placement, 500, [], {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      [edge]: 25,
    });
    expect(layer.context.createLinearGradient).toHaveBeenCalledExactlyOnceWith(...gradient);
    expect(layer.context.fillRect).toHaveBeenCalledExactlyOnceWith(...region);
    const stops = layer.context.createLinearGradient.mock.results[0]?.value.addColorStop;
    expect(stops).toHaveBeenNthCalledWith(1, 0, 'rgba(0,0,0,1)');
    expect(stops).toHaveBeenNthCalledWith(2, 1, 'rgba(0,0,0,0)');
    expect(output.context.drawImage).toHaveBeenNthCalledWith(1, image, 0, 0, 500, 250);
  });

  it('scales feather percentages consistently for preview and export', () => {
    const preview = createCanvas();
    const previewLayer = createCanvas();
    const original = createCanvas();
    const originalLayer = createCanvas();
    const feather = { left: 25, right: 0, top: 0, bottom: 0 };
    vi.stubGlobal('document', { createElement: () => previewLayer.canvas });
    drawApprovedLabel(preview.canvas, image, label, placement, 500, [], feather);
    vi.stubGlobal('document', { createElement: () => originalLayer.canvas });
    drawApprovedLabel(original.canvas, image, label, placement, undefined, [], feather);
    expect(previewLayer.context.createLinearGradient).toHaveBeenCalledWith(-50, 0, -25, 0);
    expect(originalLayer.context.createLinearGradient).toHaveBeenCalledWith(-200, 0, -100, 0);
  });

  it('rotates feathering with the label and keeps brush erasing solid', () => {
    const output = createCanvas();
    const layer = createCanvas();
    vi.stubGlobal('document', { createElement: () => layer.canvas });
    drawApprovedLabel(
      output.canvas,
      image,
      label,
      { ...placement, rotation: 45 },
      500,
      [{ radius: 0.01, points: [{ x: 0.7, y: 0.4 }] }],
      { left: 25, right: 0, top: 0, bottom: 0 },
    );
    expect(layer.context.rotate).toHaveBeenCalledWith(Math.PI / 4);
    expect(layer.context.createLinearGradient.mock.invocationCallOrder[0]).toBeLessThan(
      layer.context.setTransform.mock.invocationCallOrder[0] ?? 0,
    );
    expect(layer.context.fillStyle).toBe('#000');
    expect(layer.context.fill).toHaveBeenCalledOnce();
  });

  it('removes brush strokes from the label layer, not the original image', () => {
    const output = createCanvas();
    const layer = createCanvas();
    vi.stubGlobal('document', { createElement: () => layer.canvas });
    drawApprovedLabel(output.canvas, image, label, placement, 500, [
      {
        radius: 0.01,
        points: [
          { x: 0.5, y: 0.6 },
          { x: 0.6, y: 0.6 },
        ],
      },
    ]);
    expect(layer.context.globalCompositeOperation).toBe('destination-out');
    expect(layer.context.lineWidth).toBe(10);
    expect(layer.context.stroke).toHaveBeenCalledOnce();
    expect(output.context.drawImage).toHaveBeenNthCalledWith(1, image, 0, 0, 500, 250);
    expect(output.context.drawImage).toHaveBeenNthCalledWith(2, layer.canvas, 0, 0);
  });
});
