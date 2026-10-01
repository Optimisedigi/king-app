import { describe, expect, it } from 'vitest';
import {
  buildCompositionRequest,
  preflightComposition,
} from '../../../src/renderer/src/lib/compositionPrompt';
import { buildGenerationJobs } from '../../../src/renderer/src/lib/generationJobs';
import {
  buildAngleShots,
  CLOSE_UP_SOURCE_ANGLE_ID,
} from '../../../src/renderer/src/lib/productAngles';
import type { ShootTemplate } from '../../../src/shared/shootTemplates';
function template(): ShootTemplate {
  const settings = {
    sourceUrl: 'local-file:///shoot-templates/11111111-1111-1111-1111-111111111111.png',
    referenceUrl: 'local-file:///shoot-templates/22222222-2222-2222-2222-222222222222.png',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    guides: { centreX: 0.5, baseY: 0.8, width: 0.6, boundaryY: 0.4 },
  };
  return {
    id: '33333333-3333-3333-3333-333333333333',
    schemaVersion: 1,
    revision: 1,
    name: 'Studio',
    aspectRatio: '1:1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    angles: {
      'eye-level': settings,
      'elevated-45': { ...settings, referenceUrl: settings.sourceUrl },
    },
  };
}
describe('composition requests', () => {
  it('numbers roles, preserves identity, formats guides and orders references', () => {
    const result = buildCompositionRequest('Cake', ['own-a', 'own-b'], template(), 'eye-level');
    expect(result.referenceImages).toEqual([
      'own-a',
      'own-b',
      template().angles['eye-level']?.referenceUrl,
    ]);
    expect(result.prompt).toContain('Images 1–2 define the product. Image 3 defines composition');
    expect(result.prompt).toContain('Do not copy its product, decoration, branding or text');
    expect(result.prompt).toContain('X 50.0%');
    expect(result.prompt).toContain('Y 40.0%');
    expect(result.prompt).toContain('never stretch');
  });
  it('omits optional wall boundary', () => {
    const value = template();
    delete value.angles['eye-level']?.guides.boundaryY;
    expect(buildCompositionRequest('', ['own'], value, 'eye-level').prompt).not.toContain(
      'wall/table boundary',
    );
  });
  it('describes an angled wall boundary by its left and right edges', () => {
    const value = template();
    const guides = value.angles['elevated-45']?.guides;
    if (guides) guides.boundaryRightY = 0.25;
    const prompt = buildCompositionRequest('', ['own'], value, 'elevated-45').prompt;
    expect(prompt).toContain('from Y 40.0% at the left edge to Y 25.0% at the right edge');
    expect(prompt).not.toContain('Place the wall/table boundary at Y');
  });
  it('states a level boundary explicitly when both edges match, overriding the 45° default slope', () => {
    const value = template();
    const guides = value.angles['elevated-45']?.guides;
    if (guides) guides.boundaryRightY = 0.4;
    const prompt = buildCompositionRequest('', ['own'], value, 'elevated-45').prompt;
    expect(prompt).toContain(
      'Run the wall/table boundary as a level, horizontal line at Y 40.0% measured from the top, not a diagonal.',
    );
    expect(prompt).not.toContain('right edge');
  });
  it('keeps the original wording for templates saved with a single boundary height', () => {
    const prompt = buildCompositionRequest('', ['own'], template(), 'elevated-45').prompt;
    expect(prompt).toContain('Place the wall/table boundary at Y 40.0% measured from the top.');
    expect(prompt).not.toContain('horizontal line');
  });
  it('preflights all products and missing angles', () => {
    expect(() =>
      preflightComposition({
        template: template(),
        aspectRatio: '1:1',
        targets: [{ label: 'Cake B', referenceImages: Array(8).fill('own') }],
        angles: ['eye-level'],
        basePrompt: '',
      }),
    ).toThrow('Cake B');
    const value = template();
    delete value.angles['elevated-45'];
    expect(() => buildCompositionRequest('', ['own'], value, 'elevated-45')).toThrow('elevated-45');
    expect(() =>
      buildCompositionRequest('x'.repeat(32000), ['own'], template(), 'eye-level'),
    ).toThrow('32,000');
  });
  it('maps each target and angle and snapshots results', () => {
    const value = template();
    const jobs = buildGenerationJobs({
      basePrompt: 'Cake',
      targets: [
        { key: 'a', label: 'A', referenceImages: ['a'] },
        { key: 'b', label: 'B', referenceImages: ['b', 'b2'] },
      ],
      count: 1,
      angleShots: buildAngleShots('Cake', true),
      composition: value,
      aspectRatio: '1:1',
      idPrefix: 'test',
    });
    expect(jobs.map((job) => job.referenceImages)).toEqual([
      ['a', value.angles['eye-level']?.referenceUrl],
      ['a', value.angles['elevated-45']?.referenceUrl],
      ['b', 'b2', value.angles['eye-level']?.referenceUrl],
      ['b', 'b2', value.angles['elevated-45']?.referenceUrl],
    ]);
    const prompt = jobs[0]?.prompt;
    if (value.angles['eye-level']) value.angles['eye-level'].guides.width = 0.2;
    expect(jobs[0]?.prompt).toBe(prompt);
    expect(jobs[0]?.prompt).not.toContain('generous negative space');
    expect(jobs[1]?.prompt).toContain('45-degree elevated');
    expect(CLOSE_UP_SOURCE_ANGLE_ID).toBe('elevated-45');
  });
  it('supports single shots and rejects mismatched aspect', () => {
    const options = {
      basePrompt: 'Cake',
      targets: [{ key: 'a', label: null, referenceImages: ['a'] }],
      count: 1,
      composition: template(),
      singleShotAngle: 'elevated-45' as const,
      aspectRatio: '1:1',
    };
    expect(buildGenerationJobs(options)[0]?.prompt).toContain('45-degree');
    expect(() => buildGenerationJobs({ ...options, aspectRatio: 'auto' })).toThrow('requires 1:1');
  });
});
