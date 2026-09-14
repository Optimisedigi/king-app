import type { AngleShot } from './productAngles';

/**
 * Planning for a generation run.
 *
 * A run can span several products (a batch) and several camera angles, so the
 * page works from a flat list of jobs rather than nested loops. Building the
 * list up front also means the progress placeholders match the work exactly.
 */

/** One product a run applies to, with the reference photos to send for it. */
export interface GenerationTarget {
  /** Stable identifier: a product id, or `default` for a one-off run. */
  key: string;
  /** Product name, or null when the run isn't tied to a saved product. */
  label: string | null;
  referenceImages: string[];
}

export interface GenerationJob {
  /** Placeholder id shown in the grid while this job runs. */
  id: string;
  targetKey: string;
  targetLabel: string | null;
  /** Which camera angle this is, or null outside an angle set. */
  angleId: string | null;
  prompt: string;
  referenceImages: string[];
}

/** The single unnamed target used when the run isn't a product batch. */
export const DEFAULT_TARGET_KEY = 'default';

export function defaultTarget(referenceImages: string[]): GenerationTarget {
  return { key: DEFAULT_TARGET_KEY, label: null, referenceImages };
}

/**
 * Expand a run into one job per image to generate.
 *
 * With `angleShots`, every target gets one job per angle and `count` is
 * ignored — the angle list defines the set. Without it, every target gets
 * `count` identical jobs.
 */
export function buildGenerationJobs(options: {
  basePrompt: string;
  targets: GenerationTarget[];
  count: number;
  angleShots?: AngleShot[];
  /** Injectable so tests get stable ids. */
  idPrefix?: string;
}): GenerationJob[] {
  const { basePrompt, targets, count, angleShots } = options;
  const prefix = options.idPrefix ?? `img-${Date.now()}`;
  const jobs: GenerationJob[] = [];

  for (const target of targets) {
    if (angleShots?.length) {
      for (const shot of angleShots) {
        jobs.push({
          id: `${prefix}-${target.key}-${shot.angleId}`,
          targetKey: target.key,
          targetLabel: target.label,
          angleId: shot.angleId,
          prompt: shot.prompt,
          referenceImages: target.referenceImages,
        });
      }
      continue;
    }

    for (let i = 0; i < count; i++) {
      jobs.push({
        id: `${prefix}-${target.key}-${i}`,
        targetKey: target.key,
        targetLabel: null,
        angleId: null,
        prompt: basePrompt,
        referenceImages: target.referenceImages,
      });
    }
  }

  return jobs;
}

/**
 * Prefix a prompt with the product it applies to, so a batch run doesn't save
 * many images under one indistinguishable prompt.
 */
export function labelledPrompt(prompt: string, targetLabel: string | null): string {
  return targetLabel ? `${targetLabel} — ${prompt}` : prompt;
}
