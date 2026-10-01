import { describe, expect, it } from 'vitest';
import {
  resolveCompositionAssignments,
  preflightCompositionAssignments,
  templatesForPreflight,
  type CompositionAssignments,
  type CompositionSelections,
} from '../../../src/renderer/src/lib/compositionAssignments';
import { buildCompositionRequest } from '../../../src/renderer/src/lib/compositionPrompt';
import { buildGenerationJobs } from '../../../src/renderer/src/lib/generationJobs';
import { angleSetAngles, buildAngleShots } from '../../../src/renderer/src/lib/productAngles';
import { SHOOT_ANGLES, type ShootTemplate } from '../../../src/shared/shootTemplates';

function template(digit: string, aspectRatio: ShootTemplate['aspectRatio']): ShootTemplate {
  const id = `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
  const url = `local-file:///shoot-templates/${id}.png`;
  return {
    id,
    schemaVersion: 1,
    revision: 1,
    name: 'Same misleading eye-level name',
    aspectRatio,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    angles: {
      'eye-level': {
        sourceUrl: url,
        referenceUrl: url,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        guides: { centreX: 0.5, baseY: 0.8, width: 0.6 },
      },
    },
  };
}
function fixture() {
  const templates = [template('1', '1:1'), template('2', '4:5')];
  const selections: CompositionSelections = {
    'eye-level': { templateId: templates[0]!.id, referenceAngle: 'eye-level' },
    'elevated-45': { templateId: templates[1]!.id, referenceAngle: 'eye-level' },
  };
  const assignments = resolveCompositionAssignments(templates, selections)!;
  const targets = Array.from({ length: 20 }, (_, i) => ({
    key: `p${i}`,
    label: `Product ${i}`,
    referenceImages: [`own-${i}`, `detail-${i}`],
  }));
  const options = {
    basePrompt: 'Natural product scene',
    targets,
    count: 9,
    angleShots: buildAngleShots('Natural product scene', true),
    compositions: assignments,
    aspectRatio: 'auto',
    idPrefix: 'test',
  };
  return { templates, selections, assignments, targets, options };
}

describe('per-angle composition assignments', () => {
  it('returns undefined only when neither angle is selected', () => {
    expect(resolveCompositionAssignments([], {})).toBeUndefined();
    expect(
      resolveCompositionAssignments([], { 'eye-level': null, 'elevated-45': null }),
    ).toBeUndefined();
  });

  it.each(SHOOT_ANGLES)('requires an explicit selection for %s', (angle) => {
    const { templates, selections } = fixture();
    selections[angle] = null;
    expect(() => resolveCompositionAssignments(templates, selections)).toThrow(angle);
  });

  it.each(['missing', 'archived', 'invalid', 'reference'] as const)(
    'rejects %s selections with a target-angle label',
    (failure) => {
      const { templates, selections } = fixture();
      if (failure === 'missing') selections['elevated-45']!.templateId = 'missing';
      if (failure === 'archived') templates[1]!.archivedAt = '2026-01-02';
      if (failure === 'invalid') templates[1]!.angles['eye-level']!.guides.width = 2;
      if (failure === 'reference') selections['elevated-45']!.referenceAngle = 'elevated-45';
      expect(() => resolveCompositionAssignments(templates, selections)).toThrow('elevated-45');
    },
  );

  it('maps 20 products to 40 jobs with separate templates and fixed aspects', () => {
    const { options, assignments, targets } = fixture();
    const jobs = buildGenerationJobs(options);
    expect(jobs).toHaveLength(40);
    expect(new Set(jobs.map((job) => job.id)).size).toBe(40);
    for (const target of targets) {
      for (const angle of SHOOT_ANGLES) {
        const job = jobs.find(
          (value) => value.targetKey === target.key && value.angleId === angle,
        )!;
        const assignment = assignments[angle]!;
        expect(job.referenceImages).toEqual([
          ...target.referenceImages,
          assignment.template.angles['eye-level']!.referenceUrl,
        ]);
        expect(job.aspectRatio).toBe(assignment.template.aspectRatio);
        expect(job.prompt).toContain(`final ${assignment.template.aspectRatio} frame`);
        expect(job.prompt).toContain(
          angle === 'eye-level' ? 'Camera at eye level' : '45-degree elevated',
        );
        expect(job.prompt).not.toContain('generous negative space');
        expect(job.prompt).not.toContain('Same misleading');
      }
    }
  });

  it('uses the explicit source slot but always the target camera, defaulting the source to target', () => {
    const value = template('1', '1:1');
    expect(() => buildCompositionRequest('', ['own'], value, 'elevated-45')).toThrow('elevated-45');
    const request = buildCompositionRequest('', ['own'], value, 'elevated-45', 'eye-level');
    expect(request.prompt).toContain('45-degree elevated');
    expect(request.prompt).not.toContain('Camera at eye level');
    expect(request.referenceImages[1]).toBe(value.angles['eye-level']!.referenceUrl);
  });

  it('isolates resolved assignments, jobs, and disk-preflight snapshots from mutations', () => {
    const { templates, selections, assignments, options } = fixture();
    const before = structuredClone(assignments);
    templates[0]!.angles['eye-level']!.guides.width = 0.2;
    selections['eye-level']!.referenceAngle = 'elevated-45';
    expect(assignments).toEqual(before);
    const jobs = buildGenerationJobs(options);
    const saved = structuredClone(jobs);
    const disk = templatesForPreflight(assignments);
    disk[0]!.angles['eye-level']!.guides.width = 0.1;
    expect(assignments).toEqual(before);
    assignments['eye-level']!.template.aspectRatio = '16:9';
    assignments['eye-level']!.template.angles['eye-level']!.referenceUrl = 'changed';
    options.targets[0]!.referenceImages.push('later');
    expect(jobs).toEqual(saved);
  });

  it('returns two selected-slot-only snapshots even for the same template', () => {
    const value = template('1', '1:1');
    value.angles['elevated-45'] = structuredClone(value.angles['eye-level']!);
    const assignments: CompositionAssignments = {
      'eye-level': { template: value, referenceAngle: 'eye-level' },
      'elevated-45': { template: value, referenceAngle: 'elevated-45' },
    };
    const result = templatesForPreflight(assignments);
    expect(result.map((item) => Object.keys(item.angles))).toEqual([
      ['eye-level'],
      ['elevated-45'],
    ]);
    expect(result.map((item) => item.id)).toEqual([value.id, value.id]);
    expect(result[0]!.angles['eye-level']).not.toBe(value.angles['eye-level']);
  });

  it.each([0, 8])('rejects the whole batch for a later target with %i photos', (count) => {
    const { options } = fixture();
    options.targets[19]!.referenceImages = Array(count).fill('own');
    expect(() => buildGenerationJobs(options)).toThrow('Product 19');
  });

  it('accepts seven photos plus exactly one composition reference', () => {
    const { options } = fixture();
    options.targets[19]!.referenceImages = Array(7).fill('own');
    expect(buildGenerationJobs(options)[39]!.referenceImages).toHaveLength(8);
  });

  it('validates both assignments even with no targets', () => {
    const { assignments } = fixture();
    delete assignments['elevated-45'];
    expect(() =>
      preflightCompositionAssignments({ assignments, targets: [], basePrompt: '' }),
    ).toThrow('elevated-45');
    expect(() => templatesForPreflight(assignments)).toThrow('elevated-45');
  });

  it('rejects invalid direct assignments and final overlong prompts', () => {
    const { options } = fixture();
    expect(() => buildGenerationJobs({ ...options, basePrompt: 'x'.repeat(32000) })).toThrow(
      '32,000',
    );
    options.compositions['elevated-45']!.template.aspectRatio =
      'auto' as ShootTemplate['aspectRatio'];
    expect(() => buildGenerationJobs(options)).toThrow('elevated-45');
  });

  it('requires angle sets and rejects conflicting APIs', () => {
    const { options, templates } = fixture();
    expect(() => buildGenerationJobs({ ...options, composition: templates[0] })).toThrow(
      'not both',
    );
    expect(() => buildGenerationJobs({ ...options, angleShots: undefined })).toThrow('angle set');
    expect(() => buildGenerationJobs({ ...options, angleShots: [] })).toThrow('angle set');
    expect(() => buildGenerationJobs({ ...options, compositions: {} })).toThrow('eye-level');
  });

  it('uses only the 45° composition for a 45° and close-up set', () => {
    const { templates, selections, targets } = fixture();
    selections['eye-level'] = null;
    const assignments = resolveCompositionAssignments(templates, selections, ['elevated-45'])!;
    expect(Object.keys(assignments)).toEqual(['elevated-45']);
    expect(templatesForPreflight(assignments, ['elevated-45']).map((item) => item.id)).toEqual([
      templates[1]!.id,
    ]);
    // Without the set's angles, both shots are still required.
    expect(() => templatesForPreflight(assignments)).toThrow('eye-level');
    const jobs = buildGenerationJobs({
      basePrompt: 'Natural product scene',
      targets,
      count: 9,
      angleShots: buildAngleShots('Natural product scene', true, angleSetAngles('two')),
      compositions: assignments,
      idPrefix: 'test',
    });
    expect(jobs).toHaveLength(20);
    expect(jobs.every((job) => job.angleId === 'elevated-45')).toBe(true);
    expect(jobs.every((job) => job.aspectRatio === '4:5')).toBe(true);
    expect(jobs[0]!.prompt).toContain('45-degree elevated');
  });

  it('ignores an eye-level choice when the set has no eye-level shot', () => {
    const { templates, selections } = fixture();
    expect(
      Object.keys(resolveCompositionAssignments(templates, selections, ['elevated-45'])!),
    ).toEqual(['elevated-45']);
    selections['elevated-45'] = null;
    expect(resolveCompositionAssignments(templates, selections, ['elevated-45'])).toBeUndefined();
  });

  it('rejects compositions that do not match the angle set', () => {
    const { options } = fixture();
    expect(() =>
      buildGenerationJobs({
        ...options,
        angleShots: buildAngleShots('Natural product scene', true, angleSetAngles('two')),
      }),
    ).toThrow('angle set');
  });

  it('leaves no-template angle and single-shot jobs unchanged', () => {
    const { options } = fixture();
    const jobs = buildGenerationJobs({ ...options, compositions: undefined });
    expect(jobs).toHaveLength(40);
    expect(jobs[0]!.prompt).toBe(options.angleShots[0]!.prompt);
    expect(jobs[0]!.referenceImages).toEqual(options.targets[0]!.referenceImages);
    expect(jobs[0]).not.toHaveProperty('aspectRatio');
    const single = buildGenerationJobs({
      ...options,
      compositions: undefined,
      angleShots: undefined,
      count: 1,
    });
    expect(single).toHaveLength(20);
    expect(single[0]!.prompt).toBe(options.basePrompt);
    expect(single[0]!.angleId).toBeNull();
  });
});
