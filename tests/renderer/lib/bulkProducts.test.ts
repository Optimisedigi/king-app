import { describe, it, expect } from 'vitest';
import { nameFromFilename, uniqueName, planBulkProducts } from '@/lib/bulkProducts';

describe('nameFromFilename', () => {
  it('drops the extension', () => {
    expect(nameFromFilename('cheesecake.png')).toBe('Cheesecake');
  });

  it('turns separators into spaces and title-cases the result', () => {
    expect(nameFromFilename('blueberry_cheese-cake.jpg')).toBe('Blueberry Cheese Cake');
  });

  it('removes download and camera numbering', () => {
    expect(nameFromFilename('cake (1).png')).toBe('Cake');
    expect(nameFromFilename('cake copy.png')).toBe('Cake');
    expect(nameFromFilename('cake copy 2.png')).toBe('Cake');
  });

  it('falls back when the filename has no usable text', () => {
    expect(nameFromFilename('.png')).toBe('Untitled product');
    expect(nameFromFilename('___.png')).toBe('Untitled product');
  });

  it('handles names containing dots', () => {
    expect(nameFromFilename('cake v1.2.png')).toBe('Cake V1.2');
  });
});

describe('uniqueName', () => {
  it('returns the name unchanged when free', () => {
    expect(uniqueName('Cake', new Set())).toBe('Cake');
  });

  it('numbers collisions instead of overwriting', () => {
    const taken = new Set<string>();
    expect(uniqueName('Cake', taken)).toBe('Cake');
    expect(uniqueName('Cake', taken)).toBe('Cake 2');
    expect(uniqueName('Cake', taken)).toBe('Cake 3');
  });

  it('compares case-insensitively, matching duplicate rejection', () => {
    const taken = new Set(['cake']);
    expect(uniqueName('Cake', taken)).toBe('Cake 2');
  });
});

describe('planBulkProducts', () => {
  const file = (name: string) => new File(['x'], name, { type: 'image/png' });

  it('creates one product per file', () => {
    const planned = planBulkProducts([file('a.png'), file('b.png')], []);
    expect(planned).toHaveLength(2);
    expect(planned.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('avoids clashing with products that already exist', () => {
    const planned = planBulkProducts([file('cake.png')], ['Cake']);
    expect(planned[0]!.name).toBe('Cake 2');
  });

  it('keeps every planned name unique within one upload', () => {
    const planned = planBulkProducts([file('cake.png'), file('cake (1).png'), file('CAKE.png')], []);
    const names = planned.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(3);
  });

  it('pairs each plan with its own file', () => {
    const a = file('a.png');
    const b = file('b.png');
    const planned = planBulkProducts([a, b], []);
    expect(planned[0]!.file).toBe(a);
    expect(planned[1]!.file).toBe(b);
  });

  it('returns nothing for an empty selection', () => {
    expect(planBulkProducts([], [])).toEqual([]);
  });
});
