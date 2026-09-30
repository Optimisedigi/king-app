import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  drawApprovedLabel,
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
    fill: vi.fn(),
    stroke: vi.fn(),
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    globalCompositeOperation: 'source-over',
  };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

afterEach(() => vi.unstubAllGlobals());

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
