import {
  SHOOT_ANGLES,
  validateTemplate,
  type ShootAngle,
  type ShootTemplate,
} from '../../../shared/shootTemplates';
import { buildCompositionRequest } from './compositionPrompt';

export interface CompositionAssignment {
  template: ShootTemplate;
  referenceAngle: ShootAngle;
}
export type CompositionAssignments = Partial<Record<ShootAngle, CompositionAssignment>>;
export interface CompositionSelection {
  templateId: string;
  referenceAngle: ShootAngle;
}
export type CompositionSelections = Partial<Record<ShootAngle, CompositionSelection | null>>;

function requireAssignment(
  assignments: CompositionAssignments,
  angle: ShootAngle,
): CompositionAssignment {
  const assignment = assignments[angle];
  if (!assignment) throw new Error(`Select a composition template and reference for ${angle}.`);
  const { template, referenceAngle } = assignment;
  const validation = validateTemplate(template);
  if (!validation.ok) throw new Error(`Fix the ${angle} composition template: ${validation.error}`);
  if (template.archivedAt)
    throw new Error(`The ${angle} composition template is archived. Select an active template.`);
  if (!SHOOT_ANGLES.includes(referenceAngle) || !template.angles[referenceAngle])
    throw new Error(
      `The ${angle} composition has no ${referenceAngle} reference. Select an available reference explicitly.`,
    );
  return assignment;
}

/** Resolve by id and explicit source slot only; never infer from template names. */
export function resolveCompositionAssignments(
  templates: ShootTemplate[],
  selections: CompositionSelections,
): CompositionAssignments | undefined {
  if (SHOOT_ANGLES.every((angle) => !selections[angle])) return undefined;
  const assignments: CompositionAssignments = {};
  for (const angle of SHOOT_ANGLES) {
    const selection = selections[angle];
    if (!selection) throw new Error(`Select a composition template and reference for ${angle}.`);
    const template = templates.find((value) => value.id === selection.templateId);
    if (!template)
      throw new Error(`The ${angle} composition template is missing. Select another template.`);
    assignments[angle] = { template, referenceAngle: selection.referenceAngle };
    requireAssignment(assignments, angle);
  }
  return structuredClone(assignments);
}

/** Validate the complete batch using each assignment's own fixed aspect. */
export function preflightCompositionAssignments(options: {
  assignments: CompositionAssignments;
  targets: { label: string | null; referenceImages: string[] }[];
  basePrompt: string;
}): void {
  for (const angle of SHOOT_ANGLES) requireAssignment(options.assignments, angle);
  const invalid = options.targets.filter(
    (target) => target.referenceImages.length === 0 || target.referenceImages.length > 7,
  );
  if (invalid.length)
    throw new Error(
      `Composition needs 1–7 product photos for: ${invalid.map((target) => target.label ?? 'Current product').join(', ')}. No images were queued.`,
    );
  for (const angle of SHOOT_ANGLES) {
    const { template, referenceAngle } = requireAssignment(options.assignments, angle);
    for (const target of options.targets)
      buildCompositionRequest(
        options.basePrompt,
        target.referenceImages,
        template,
        angle,
        referenceAngle,
      );
  }
}

/** Disk preflight needs only the explicitly selected source slots, not unused assets. */
export function templatesForPreflight(assignments: CompositionAssignments): ShootTemplate[] {
  return SHOOT_ANGLES.map((angle) => {
    const { template, referenceAngle } = requireAssignment(assignments, angle);
    return structuredClone({
      ...template,
      angles: { [referenceAngle]: template.angles[referenceAngle] },
    });
  });
}
