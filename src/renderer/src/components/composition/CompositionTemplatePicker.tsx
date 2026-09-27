import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react';
import { useCompositionStore } from '@/stores/compositionStore';
import { ChevronDownIcon } from '@/components/icons';
import HelpTip from '@/components/ui/HelpTip';
import {
  SHOOT_ANGLES,
  type ShootAngle,
  type ShootTemplate,
} from '../../../../shared/shootTemplates';
const Editor = lazy(async () => ({
  default: (await import('./CompositionTemplateEditor')).CompositionTemplateEditor,
}));
const button =
  'min-h-10 rounded-full border border-[var(--base-color-brand--umber)] bg-[var(--base-color-brand--shell)] px-3 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--base-color-brand--bean)]';
const labels = { 'eye-level': 'Eye level', 'elevated-45': '45° above' };
export function CompositionTemplatePicker({ angleSet }: { angleSet: boolean }): ReactElement {
  const state = useCompositionStore();
  const [editing, setEditing] = useState<{
    template?: ShootTemplate;
    targetAngle?: ShootAngle;
    referenceAngle?: ShootAngle;
  } | null>(null);
  const [error, setError] = useState('');
  const selected = state.templates.find((template) => template.id === state.selectedId);
  const references = state.templates
    .filter((template) => !template.archivedAt)
    .flatMap((template) =>
      SHOOT_ANGLES.flatMap((referenceAngle) =>
        template.angles[referenceAngle]
          ? [{ template, referenceAngle, value: `${template.id}:${referenceAngle}` }]
          : [],
      ),
    );
  useEffect(() => {
    void useCompositionStore.getState().reload();
  }, []);
  async function saved(template: ShootTemplate): Promise<void> {
    await state.reload();
    if (editing?.targetAngle && editing.referenceAngle) {
      state.assignAngle(editing.targetAngle, {
        templateId: template.id,
        referenceAngle: editing.referenceAngle,
      });
    } else {
      state.select(template.id);
    }
    setEditing(null);
  }
  async function archive(): Promise<void> {
    if (!selected) return;
    try {
      await window.api.shootTemplates.archive(selected.id, selected.revision);
      await state.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not archive.');
    }
  }
  return (
    <>
      {angleSet ? (
        <details className="w-full min-w-0">
          <summary className="min-h-10 cursor-pointer rounded-lg py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--base-color-brand--bean)]">
            Compositions for 3 angles
            <span className="ml-2 text-xs font-normal">
              {
                SHOOT_ANGLES.filter((angle) => {
                  const selection = state.angleSelections[angle];
                  return (
                    selection &&
                    references.some(
                      (entry) =>
                        entry.value === `${selection.templateId}:${selection.referenceAngle}`,
                    )
                  );
                }).length
              }{' '}
              of 2 assigned
            </span>
          </summary>
          <fieldset className="min-w-0 space-y-2 pt-2">
            <legend className="sr-only">Angle compositions</legend>
            {SHOOT_ANGLES.map((angle) => {
              const selection = state.angleSelections[angle];
              const value = selection ? `${selection.templateId}:${selection.referenceAngle}` : '';
              const reference = references.find((entry) => entry.value === value);
              return (
                <div key={angle} className="flex min-w-0 flex-wrap items-center gap-2">
                  <label className="min-w-0 flex-1 basis-64 text-sm">
                    {labels[angle]} composition
                    <span className={`${button} relative mt-1 flex w-full min-w-0 items-center`}>
                      <select
                        aria-label={`${labels[angle]} composition`}
                        value={value}
                        disabled={!state.loaded || !!state.error}
                        className="h-10 w-full min-w-0 appearance-none bg-transparent pr-6 focus-visible:outline-2"
                        onChange={(event) => {
                          const entry = references.find(
                            (item) => item.value === event.target.value,
                          );
                          state.assignAngle(
                            angle,
                            entry
                              ? {
                                  templateId: entry.template.id,
                                  referenceAngle: entry.referenceAngle,
                                }
                              : null,
                          );
                        }}
                      >
                        <option value="">None</option>
                        {selection && !reference && (
                          <option value={value}>Unavailable reference: choose another</option>
                        )}
                        {references.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {entry.template.name} · {labels[entry.referenceAngle]} reference ·{' '}
                            {entry.template.aspectRatio}
                          </option>
                        ))}
                      </select>
                      <span aria-hidden="true" className="pointer-events-none absolute right-3">
                        <ChevronDownIcon />
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    className={button}
                    onClick={() => setEditing({ targetAngle: angle, referenceAngle: angle })}
                  >
                    New {labels[angle]} composition
                  </button>
                  {reference && (
                    <button
                      type="button"
                      className={button}
                      onClick={() =>
                        setEditing({
                          template: reference.template,
                          targetAngle: angle,
                          referenceAngle: reference.referenceAngle,
                        })
                      }
                    >
                      Edit {labels[angle]} composition
                    </button>
                  )}
                </div>
              );
            })}
            <p className="text-xs">
              Close-up: cropped from the 45° image. Assign both compositions, or leave both None for
              prompt-only generation.
            </p>
          </fieldset>
        </details>
      ) : (
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5">
          <label className={`${button} relative flex max-w-full min-w-0 items-center gap-2`}>
            Composition
            <select
              aria-label="Composition"
              value={state.selectedId ?? ''}
              className="h-9 max-w-48 min-w-0 appearance-none bg-transparent pr-6 focus-visible:outline-2"
              onChange={(event) => state.select(event.target.value || null)}
            >
              <option value="">None</option>
              {state.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <span aria-hidden="true" className="pointer-events-none absolute right-3">
              <ChevronDownIcon />
            </span>
          </label>
          <HelpTip
            label="How to use compositions"
            text="1. Choose New composition, name it and pick an output aspect. 2. Upload a clean scene photo, adjust its crop, then set the wall/table line, product centre, base and width. For 3 angles, assign each saved composition to its shot in the two selectors. 3. Save, select a product or All products, then Generate. Product photos define the product; the composition photo guides the scene. Results may vary. Editing stays local until Generate."
          />
          <button type="button" className={button} onClick={() => setEditing({})}>
            New composition
          </button>
          {selected && (
            <>
              <button
                type="button"
                className={button}
                onClick={() => setEditing({ template: selected })}
              >
                Edit composition
              </button>
              <button
                type="button"
                className={button}
                onClick={() => {
                  void archive();
                }}
              >
                Archive composition
              </button>
              <label className={`${button} flex items-center gap-2`}>
                Shot
                <select
                  aria-label="Composition shot angle"
                  value={state.singleShotAngle}
                  onChange={(event) =>
                    state.setAngle(
                      event.target.value === 'elevated-45' ? 'elevated-45' : 'eye-level',
                    )
                  }
                >
                  <option value="eye-level">Eye level</option>
                  <option value="elevated-45">45° above</option>
                </select>
              </label>
            </>
          )}
        </div>
      )}
      {(state.error || error) && (
        <p role="alert" className="w-full text-sm">
          {state.error || error}{' '}
          <button
            type="button"
            className={button}
            onClick={() => {
              setError('');
              void state.reload();
            }}
          >
            Retry compositions
          </button>
        </p>
      )}
      {state.notice && !angleSet && (
        <p role="status" className="w-full text-sm">
          {state.notice}
        </p>
      )}
      {editing && (
        <Suspense fallback={<span role="status">Opening composition editor…</span>}>
          <Editor
            template={editing.template}
            referenceAngle={editing.referenceAngle}
            onClose={() => setEditing(null)}
            onSaved={(template) => {
              void saved(template);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
