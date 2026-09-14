import { describe, it, expect } from 'vitest';
import {
  buildGenerationJobs,
  defaultTarget,
  labelledPrompt,
  DEFAULT_TARGET_KEY,
  type GenerationTarget,
} from '@/lib/generationJobs';
import { buildAngleShots, PRODUCT_ANGLES } from '@/lib/productAngles';

const base = 'A chocolate cake on a brown backdrop';

function target(key: string, label: string, images: string[]): GenerationTarget {
  return { key, label, referenceImages: images };
}

describe('defaultTarget', () => {
  it('carries the uploaded photos under the default key with no label', () => {
    const t = defaultTarget(['a.png', 'b.png']);
    expect(t.key).toBe(DEFAULT_TARGET_KEY);
    expect(t.label).toBeNull();
    expect(t.referenceImages).toEqual(['a.png', 'b.png']);
  });
});

describe('buildGenerationJobs', () => {
  it('creates `count` jobs for a single target', () => {
    const jobs = buildGenerationJobs({
      basePrompt: base,
      targets: [defaultTarget(['a.png'])],
      count: 3,
      idPrefix: 'test',
    });
    expect(jobs).toHaveLength(3);
    expect(jobs.every((j) => j.prompt === base)).toBe(true);
    expect(jobs.every((j) => j.angleId === null)).toBe(true);
  });

  it('runs the same prompt once per product in a batch', () => {
    const jobs = buildGenerationJobs({
      basePrompt: base,
      targets: [
        target('p1', 'Cake', ['cake.png']),
        target('p2', 'Tart', ['tart.png']),
        target('p3', 'Pie', ['pie.png']),
      ],
      count: 1,
      idPrefix: 'test',
    });
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => j.targetKey)).toEqual(['p1', 'p2', 'p3']);
    expect(new Set(jobs.map((j) => j.prompt))).toEqual(new Set([base]));
  });

  it('sends each product only its own reference photos', () => {
    const jobs = buildGenerationJobs({
      basePrompt: base,
      targets: [target('p1', 'Cake', ['cake.png']), target('p2', 'Tart', ['tart.png'])],
      count: 1,
      idPrefix: 'test',
    });
    expect(jobs[0]!.referenceImages).toEqual(['cake.png']);
    expect(jobs[1]!.referenceImages).toEqual(['tart.png']);
  });

  it('multiplies angles across every product in a batch', () => {
    const targets = [target('p1', 'Cake', ['cake.png']), target('p2', 'Tart', ['tart.png'])];
    const jobs = buildGenerationJobs({
      basePrompt: base,
      targets,
      count: 1,
      angleShots: buildAngleShots(base),
      idPrefix: 'test',
    });
    expect(jobs).toHaveLength(targets.length * PRODUCT_ANGLES.length);
    for (const t of targets) {
      const forTarget = jobs.filter((j) => j.targetKey === t.key);
      expect(forTarget.map((j) => j.angleId)).toEqual(PRODUCT_ANGLES.map((a) => a.id));
    }
  });

  it('lets the angle list override count', () => {
    const jobs = buildGenerationJobs({
      basePrompt: base,
      targets: [defaultTarget(['a.png'])],
      count: 4,
      angleShots: buildAngleShots(base),
      idPrefix: 'test',
    });
    expect(jobs).toHaveLength(PRODUCT_ANGLES.length);
  });

  it('gives every job a unique placeholder id', () => {
    const jobs = buildGenerationJobs({
      basePrompt: base,
      targets: [target('p1', 'Cake', ['c.png']), target('p2', 'Tart', ['t.png'])],
      count: 3,
      idPrefix: 'test',
    });
    expect(new Set(jobs.map((j) => j.id)).size).toBe(jobs.length);
  });

  it('produces no jobs when there are no targets', () => {
    expect(
      buildGenerationJobs({ basePrompt: base, targets: [], count: 3, idPrefix: 'test' }),
    ).toEqual([]);
  });
});

describe('labelledPrompt', () => {
  it('prefixes the product name in a batch', () => {
    expect(labelledPrompt('shot it', 'Cake')).toBe('Cake — shot it');
  });

  it('leaves a single run untouched', () => {
    expect(labelledPrompt('shot it', null)).toBe('shot it');
  });
});
