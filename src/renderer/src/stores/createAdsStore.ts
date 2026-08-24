import { create } from 'zustand';
import { toast } from 'sonner';
import {
  CREATE_ADS_GENERATION_COUNT,
  CREATE_ADS_OUTPUT_FORMAT,
  CREATE_ADS_RESOLUTION,
  buildCreateAdsPrompt,
} from '@/lib/constants/create-ads';
import { pickVariant, type AdReference } from '@/lib/adReferences';
import { useImagesStore } from '@/stores/imagesStore';
import { cleanIpcError } from '@/lib/ipcError';
import type { EntityData, GeneratedImageData } from '@/types/electron';

export type StepId = 'ad' | 'product' | 'brief' | 'format' | 'results';

export interface ResultSlot {
  id: string;
  status: 'pending' | 'success' | 'error';
  image?: GeneratedImageData;
  error?: string;
}

// Four product angles plus the ad-style reference stay under the app's
// eight-reference request cap without bloating the IPC payload.
const MAX_PRODUCT_REFERENCES = 4;

/**
 * passed through IPC to the main process as a data URL.
 */
async function bundledAssetToDataUrl(assetUrl: string): Promise<string> {
  const response = await fetch(assetUrl);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read asset'));
    reader.readAsDataURL(blob);
  });
}

interface CreateAdsStore {
  // Wizard state — every field here persists across page navigation so a
  // user can leave and come back to exactly where they were.
  step: StepId;
  selectedAdId: string | null;
  selectedProductId: string | null;
  productBrief: string;
  aspectRatio: string;

  // Generation state. Lives in the store so OpenAI requests started before
  // navigation continue updating the slots after the user returns.
  results: ResultSlot[];
  isGenerating: boolean;

  // Monotonic counter bumped on every run. In-flight requests capture it and
  // discard their wizard result if a newer run has started; the remote request
  // itself may already be billable and cannot be cancelled here.
  generationId: number;

  // Cached inputs from the current run — used to retry an individual
  // failed slot without re-fetching the bundled reference ad or rebuilding
  // the prompt. Cleared on `startNewAd`.
  lastGenerationInputs: {
    prompt: string;
    imageUrls: string[];
    aspectRatio: string;
  } | null;

  setStep: (step: StepId) => void;
  setSelectedAdId: (id: string | null) => void;
  setSelectedProductId: (id: string | null) => void;
  setProductBrief: (brief: string) => void;
  setAspectRatio: (ratio: string) => void;
  removeResultByImageId: (imageId: string) => void;
  startNewAd: () => void;

  runGeneration: (ad: AdReference, product: EntityData) => Promise<void>;
  /** Re-run a single failed slot using the cached generation inputs. */
  retrySlot: (slotId: string) => Promise<void>;
}

const INITIAL_STATE = {
  step: 'ad' as StepId,
  selectedAdId: null,
  selectedProductId: null,
  productBrief: '',
  aspectRatio: '1:1',
  results: [] as ResultSlot[],
  isGenerating: false,
  generationId: 0,
  lastGenerationInputs: null as CreateAdsStore['lastGenerationInputs'],
};

export const useCreateAdsStore = create<CreateAdsStore>()((set, get) => ({
  ...INITIAL_STATE,

  setStep: (step) => set({ step }),
  setSelectedAdId: (selectedAdId) => set({ selectedAdId }),
  setSelectedProductId: (selectedProductId) => set({ selectedProductId }),
  setProductBrief: (productBrief) => set({ productBrief }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),

  removeResultByImageId: (imageId) =>
    set((state) => ({
      results: state.results.filter((slot) => slot.image?.id !== imageId),
    })),

  // Clear any prior results and return to the first step — used by the
  // "Create another" button on the results screen.
  startNewAd: () => set({ ...INITIAL_STATE }),

  runGeneration: async (ad, product) => {
    const { productBrief, aspectRatio } = get();

    if (productBrief.trim().length === 0) {
      toast.error('Add a short description of your product first.');
      return;
    }

    // Bump the cancellation nonce so stragglers from a previous run get
    // discarded when they eventually resolve.
    const thisGenId = get().generationId + 1;

    // Immediately switch to the results step with empty pending slots so
    // the UI renders skeletons the instant the user clicks Generate.
    const slotIds = Array.from(
      { length: CREATE_ADS_GENERATION_COUNT },
      (_, i) => `ad-${Date.now()}-${i}`,
    );
    set({
      step: 'results',
      isGenerating: true,
      generationId: thisGenId,
      results: slotIds.map((id) => ({ id, status: 'pending' })),
    });

    // Pick the variant of the selected ad that best matches the user's
    // chosen output aspect ratio (falls back to the ad's default variant).
    const variant = pickVariant(ad, aspectRatio);

    // Custom ad references are already saved on disk and exposed as
    // `local-file://` URLs — the main process resolves those to a base64
    // data URL inside `generate.image`. Bundled defaults are vite-served
    // assets, so we still have to inline them as data URLs ourselves.
    let adReferenceUrl: string;
    if (variant.imageUrl.startsWith('local-file://') || variant.imageUrl.startsWith('http')) {
      adReferenceUrl = variant.imageUrl;
    } else {
      try {
        adReferenceUrl = await bundledAssetToDataUrl(variant.imageUrl);
      } catch {
        toast.error("Couldn't load the reference ad. Please try again.");
        set({ isGenerating: false, results: [], step: 'format' });
        return;
      }
    }

    const productUrls = product.referenceImages.slice(0, MAX_PRODUCT_REFERENCES);
    if (productUrls.length === 0) {
      toast.error('This product has no images yet. Add at least one on the Products page.');
      set({ isGenerating: false, results: [], step: 'format' });
      return;
    }

    const prompt = buildCreateAdsPrompt(productBrief, aspectRatio);
    const imageUrls = [adReferenceUrl, ...productUrls];

    // Cache inputs so individual slot retries don't rebuild them.
    set({ lastGenerationInputs: { prompt, imageUrls, aspectRatio } });

    // Fire all N generations in parallel. Each slot updates independently
    // so results stream in as they complete — including across navigation
    // back to the page, since the store outlives the component.
    await Promise.all(slotIds.map((slotId) => generateSingleSlot(slotId, set, thisGenId)));

    // If the user has started a fresh wizard session while we were
    // waiting, this run no longer owns the UI — skip the summary state
    // update and toast. Outputs have already been saved to the gallery
    // by each individual slot, so nothing is lost.
    if (useCreateAdsStore.getState().generationId !== thisGenId) return;

    set({ isGenerating: false });

    const { results } = get();
    const successCount = results.filter((s) => s.status === 'success').length;
    if (successCount === 0) {
      toast.error('None of the ads generated successfully. Please try again.');
    } else if (successCount < results.length) {
      toast.success(`Generated ${successCount} of ${results.length} ads.`);
    } else {
      toast.success(`Generated ${successCount} ads.`);
    }
  },

  retrySlot: async (slotId) => {
    const { lastGenerationInputs, results, generationId } = get();
    if (!lastGenerationInputs) return;
    if (!results.some((s) => s.id === slotId)) return;

    // Mark slot as pending again so a skeleton re-appears immediately.
    set((state) => ({
      results: state.results.map((s) => (s.id === slotId ? { id: s.id, status: 'pending' } : s)),
    }));

    await generateSingleSlot(slotId, set, generationId, lastGenerationInputs);
  },
}));

/**
 * Run one generation and write the result into its slot. Extracted so that
 * both the initial `runGeneration` and a manual `retrySlot` share the same
 * success/error handling.
 */
async function generateSingleSlot(
  slotId: string,
  set: (
    partial: Partial<CreateAdsStore> | ((state: CreateAdsStore) => Partial<CreateAdsStore>),
  ) => void,
  ownedGenId: number,
  explicitInputs?: {
    prompt: string;
    imageUrls: string[];
    aspectRatio: string;
  },
): Promise<void> {
  const inputs = explicitInputs ?? useCreateAdsStore.getState().lastGenerationInputs;
  if (!inputs) return;

  // `ownedGenId` is the generationId captured when this call started. If
  // the store's counter has moved on by the time we complete, the user
  // has started a fresh wizard session — so we silently skip writing to
  // the current wizard's results. We still let the OpenAI request complete
  // and save its output to the gallery (images.json) so in-flight work is
  // never lost when the user moves on; it just won't reappear in the
  // (now empty) wizard.
  const updateSlot = (update: Partial<ResultSlot>) => {
    if (useCreateAdsStore.getState().generationId !== ownedGenId) return;
    set((state: CreateAdsStore) => ({
      results: state.results.map((s) => (s.id === slotId ? { ...s, ...update } : s)),
    }));
  };

  try {
    const result = await window.api.generate.image({
      prompt: inputs.prompt,
      aspectRatio: inputs.aspectRatio,
      resolution: CREATE_ADS_RESOLUTION,
      outputFormat: CREATE_ADS_OUTPUT_FORMAT,
      imageUrls: inputs.imageUrls,
    });

    const firstUrl = result.success ? result.resultUrls?.[0] : undefined;
    if (!firstUrl) {
      updateSlot({ status: 'error', error: result.error ?? "Couldn't generate this one." });
      return;
    }

    const saved = await window.api.images.save({
      url: firstUrl,
      prompt: inputs.prompt,
      aspectRatio: inputs.aspectRatio,
      // This wizard always runs on the default OpenAI provider.
      model: 'gpt_image_2',
    });

    // Push into the global gallery store so the Image page picks it up
    // immediately, even though the user is currently on the Create Ads page.
    useImagesStore.getState().addImage(saved);

    updateSlot({ status: 'success', image: saved });
  } catch (err) {
    const message = cleanIpcError(err, "Couldn't generate this one.");
    updateSlot({ status: 'error', error: message });
  }
}
