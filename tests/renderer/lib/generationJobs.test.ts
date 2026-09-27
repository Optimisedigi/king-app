import { describe, it, expect } from 'vitest';
import {
  buildGenerationJobs,
  defaultTarget,
  labelledPrompt,
  DEFAULT_TARGET_KEY,
  type GenerationTarget,
} from '../../../src/renderer/src/lib/generationJobs';
import { buildAngleShots, PRODUCT_ANGLES } from '../../../src/renderer/src/lib/productAngles';
import type { ShootTemplate } from '../../../src/shared/shootTemplates';

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

  it('keeps each product name so batch results stay identifiable', () => {
    const jobs = buildGenerationJobs({
      basePrompt: base,
      targets: [target('p1', 'Cake', ['cake.png']), target('p2', 'Tart', ['tart.png'])],
      count: 2,
      idPrefix: 'test',
    });
    expect(jobs.map((j) => j.targetLabel)).toEqual(['Cake', 'Cake', 'Tart', 'Tart']);
  });

  it('leaves a single run unlabelled', () => {
    const jobs = buildGenerationJobs({
      basePrompt: base,
      targets: [defaultTarget(['a.png'])],
      count: 2,
      idPrefix: 'test',
    });
    expect(jobs.every((j) => j.targetLabel === null)).toBe(true);
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

describe('composition batch preflight', () => {
  it('rejects the whole plan if a later target or required angle is invalid', () => {
    const asset = 'local-file:///shoot-templates/11111111-1111-1111-1111-111111111111.png';
    const composition: ShootTemplate = {
      id: '22222222-2222-2222-2222-222222222222',
      schemaVersion: 1,
      revision: 1,
      name: 'Studio',
      aspectRatio: '1:1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      angles: {
        'eye-level': {
          sourceUrl: asset,
          referenceUrl: asset,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          guides: { centreX: 0.5, baseY: 0.8, width: 0.6 },
        },
      },
    };
    const options = {
      basePrompt: base,
      count: 1,
      aspectRatio: '1:1',
      composition,
      targets: [
        target('a', 'Valid cake', ['a']),
        target('b', 'Too many photos', Array(8).fill('b')),
      ],
    };
    expect(() => buildGenerationJobs(options)).toThrow('Too many photos');
    expect(() =>
      buildGenerationJobs({
        ...options,
        targets: [target('a', 'Valid cake', ['a'])],
        angleShots: buildAngleShots(base, true),
      }),
    ).toThrow('elevated-45');
    expect(options.targets[1]?.referenceImages).toHaveLength(8);
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
