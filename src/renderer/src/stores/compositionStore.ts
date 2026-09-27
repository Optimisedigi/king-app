import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ShootAngle, ShootTemplate } from '../../../shared/shootTemplates';
import type { CompositionSelection, CompositionSelections } from '@/lib/compositionAssignments';
interface CompositionState {
  selectedId: string | null;
  singleShotAngle: ShootAngle;
  angleSelections: CompositionSelections;
  assignAngle: (angle: ShootAngle, selection: CompositionSelection | null) => void;
  templates: ShootTemplate[];
  loaded: boolean;
  error: string;
  notice: string;
  select: (id: string | null) => void;
  setAngle: (angle: ShootAngle) => void;
  reload: () => Promise<void>;
}
export const useCompositionStore = create<CompositionState>()(
  persist(
    (set, get) => ({
      selectedId: null,
      singleShotAngle: 'eye-level',
      angleSelections: {},
      assignAngle: (angle, selection) =>
        set((state) => ({ angleSelections: { ...state.angleSelections, [angle]: selection } })),
      templates: [],
      loaded: false,
      error: '',
      notice: '',
      select: (selectedId) => set({ selectedId, notice: '' }),
      setAngle: (singleShotAngle) => set({ singleShotAngle }),
      reload: async (): Promise<void> => {
        try {
          const templates = await window.api.shootTemplates.list();
          const selected = get().selectedId;
          const missing =
            selected !== null &&
            !templates.some((template) => template.id === selected && !template.archivedAt);
          set({
            templates,
            loaded: true,
            error: '',
            ...(missing
              ? {
                  selectedId: null,
                  notice: 'Saved composition is missing or archived. Composition is now None.',
                }
              : {}),
          });
        } catch (error) {
          set({
            loaded: true,
            error:
              error instanceof Error
                ? error.message
                : 'Could not load compositions. Retry before generating.',
          });
        }
      },
    }),
    {
      name: 'composition-preferences',
      partialize: (state) => ({
        selectedId: state.selectedId,
        singleShotAngle: state.singleShotAngle,
        angleSelections: state.angleSelections,
      }),
    },
  ),
);
