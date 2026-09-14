import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Which image model the app routes generations through. Applied on the fal
 * path, and on both OpenAI paths (API key and OAuth) for the GPT Image 2.5
 * variants. Switched from the Settings modal; persisted to localStorage so
 * the choice survives reloads.
 *
 *   - `nano_banana_pro` — Google Gemini 3 Pro Image (`fal-ai/nano-banana-pro`)
 *   - `gpt_image_2` — OpenAI GPT Image 2 (`openai/gpt-image-2`)
 *   - `gpt_image_25_flare` — OpenAI GPT Image 2.5 Flare, optimised for speed
 *   - `gpt_image_25_sunburst` — OpenAI GPT Image 2.5 Sunburst, optimised for
 *     quality and editing precision
 */
export type ImageModel =
  | 'nano_banana_pro'
  | 'gpt_image_2'
  | 'gpt_image_25_flare'
  | 'gpt_image_25_sunburst';

interface ModelStore {
  selectedModel: ImageModel;
  setSelectedModel: (model: ImageModel) => void;
}

export const useModelStore = create<ModelStore>()(
  persist(
    (set) => ({
      selectedModel: 'nano_banana_pro',
      setSelectedModel: (selectedModel) => set({ selectedModel }),
    }),
    {
      name: 'image-model',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
