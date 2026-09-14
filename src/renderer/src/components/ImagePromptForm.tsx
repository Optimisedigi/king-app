import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import SelectDropdown from '@/components/ui/SelectDropdown';
import {
  PRODUCT_ANGLES,
  ANGLE_SET_SIZE,
  buildAngleShots,
  type AngleShot,
} from '@/lib/productAngles';
import {
  PlusIcon,
  MinusIcon,
  SparkleIcon,
  CloseIcon,
  ResolutionIcon,
  FormatIcon,
  AutoIcon,
  aspectRatioIcons,
  ImageAddIcon,
} from '@/components/icons';
import {
  aspectRatioOptions,
  qualityOptions,
  outputFormatOptions,
  MAX_REFERENCE_IMAGES,
  MAX_IMAGE_SIZE_MB,
  MAX_IMAGES_PER_GENERATION,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_MIME_REGEX,
} from '@/lib/constants/image-form';
import { renderPrompt } from '@/lib/productTypes';
import HelpTip from '@/components/ui/HelpTip';
import SavedPromptsMenu from '@/components/ui/SavedPromptsMenu';
import type { GenerationTarget } from '@/lib/generationJobs';
import type { EntityData, ImageModelId } from '@/types/electron';
import { useModelStore } from '@/stores/modelStore';

type ImageProvider = 'openai-api' | 'openai-oauth' | 'fal';

/** Entity-selector value meaning "run this across every saved product". */
const ALL_PRODUCTS_VALUE = 'product:all';

/** Above this many images, a batch asks for confirmation before spending. */
const BATCH_CONFIRM_THRESHOLD = 12;

interface ReferenceImage {
  id: string;
  file?: File;
  preview: string;
  url?: string;
  isLoading: boolean;
}

interface ImagePromptFormProps {
  onSubmit?: (data: {
    prompt: string;
    count: number;
    aspectRatio: string;
    resolution: string;
    outputFormat: string;
    referenceImages: string[];
    provider?: ImageProvider;
    modelVariant?: ImageModelId;
    /**
     * One entry per image in an angle set, each with its own camera prompt and
     * the angle it came from. When present its length matches `count` and its
     * prompts take precedence over `prompt`.
     */
    angleShots?: AngleShot[];
    /**
     * One entry per product when running the same prompt across a batch.
     * Each carries that product's own reference photos.
     */
    targets?: GenerationTarget[];
  }) => void;
  initialPrompt?: string;
  recreateData?: { prompt: string } | null;
  editData?: { imageUrl: string } | null;
}

export default function ImagePromptForm({
  onSubmit,
  initialPrompt = '',
  recreateData,
  editData,
}: ImagePromptFormProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [selectedEntity, setSelectedEntity] = useState('none');
  const [imageCount, setImageCount] = useState(1);
  const [angleSet, setAngleSet] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [resolution, setResolution] = useState('high');
  const [outputFormat, setOutputFormat] = useState('png');
  const [provider, setProvider] = useState<ImageProvider>('openai-api');
  const [availableProviders, setAvailableProviders] = useState<ImageProvider[]>(['openai-api']);
  const providerRef = useRef(provider);
  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);
  const modelVariant = useModelStore((s) => s.selectedModel);

  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [products, setProducts] = useState<EntityData[]>([]);
  const [characters, setCharacters] = useState<EntityData[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const maxImages = MAX_IMAGES_PER_GENERATION;

  // Fetch products and characters for the entity selector
  useEffect(() => {
    const fetchEntities = async () => {
      try {
        const [p, c] = await Promise.all([
          window.api.entities.list('products'),
          window.api.entities.list('characters'),
        ]);
        setProducts(p);
        setCharacters(c);
      } catch {
        // Silently fail
      }
    };
    fetchEntities();
  }, []);

  // Detect available image providers.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [keys, oauthStatus] = await Promise.all([
          window.api.apiKeys.list(),
          window.api.openaiOAuth.status().catch(() => ({ connected: false })),
        ]);
        if (cancelled) return;
        const providers: ImageProvider[] = [];
        if (keys.openai) providers.push('openai-api');
        if (oauthStatus.connected) providers.push('openai-oauth');
        if (keys.fal) providers.push('fal');
        setAvailableProviders(providers);
        // If current provider is no longer available, switch to the first.
        if (providers.length > 0 && !providers.includes(providerRef.current)) {
          setProvider(providers[0]!);
        }
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build entity selector options. `product:all` runs the same prompt over
  // every saved product, each with its own reference photos.
  const entityOptions = [
    { value: 'none', label: 'Default' },
    ...(products.length > 0
      ? [
          { value: '_product_header', label: 'Products', disabled: true },
          { value: ALL_PRODUCTS_VALUE, label: `All products (${products.length})` },
          ...products.map((p) => ({ value: `product:${p.id}`, label: p.name })),
        ]
      : []),
    ...(characters.length > 0
      ? [
          { value: '_character_header', label: 'Characters', disabled: true },
          ...characters.map((c) => ({ value: `character:${c.id}`, label: c.name })),
        ]
      : []),
  ];

  // When an entity is selected, load its reference images
  const handleEntityChange = useCallback(
    (value: string) => {
      setSelectedEntity(value);

      // A batch run pulls each product's own photos at submit time, so there
      // is no single set to preview here.
      if (value === 'none' || value === ALL_PRODUCTS_VALUE) {
        setReferenceImages([]);
        return;
      }

      const [type, id] = value.split(':');
      const entities = type === 'product' ? products : characters;
      const entity = entities.find((e) => e.id === id);

      if (!entity) return;

      const entityImages: ReferenceImage[] = entity.referenceImages
        .slice(0, MAX_REFERENCE_IMAGES)
        .map((url) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          preview: url,
          url,
          isLoading: false,
        }));

      setReferenceImages(entityImages);
    },
    [products, characters],
  );

  const autoResizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = '40px';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, []);

  useEffect(() => {
    autoResizeTextarea();
  }, [prompt, autoResizeTextarea]);

  // Handle recreate data
  useEffect(() => {
    if (recreateData) {
      setPrompt(recreateData.prompt);
      setReferenceImages([]);
    }
  }, [recreateData]);

  // Handle edit data
  useEffect(() => {
    if (!editData?.imageUrl) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPrompt('');
    setReferenceImages([
      {
        id,
        preview: editData.imageUrl,
        url: editData.imageUrl,
        isLoading: false,
      },
    ]);
  }, [editData]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const validFiles: File[] = [];
      for (const file of Array.from(files)) {
        if (!SUPPORTED_IMAGE_MIME_REGEX.test(file.type)) continue;
        if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) continue;
        if (referenceImages.length + validFiles.length >= MAX_REFERENCE_IMAGES) break;
        validFiles.push(file);
      }

      const pendingImages: ReferenceImage[] = validFiles.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: URL.createObjectURL(file),
        isLoading: true,
      }));

      setReferenceImages((prev) => [...prev, ...pendingImages].slice(0, MAX_REFERENCE_IMAGES));
      e.target.value = '';

      // Convert files to base64 data URLs so they're accessible from the main process
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const pending = pendingImages[i];
        if (!file || !pending) continue;
        const id = pending.id;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          setReferenceImages((prev) =>
            prev.map((img) => (img.id === id ? { ...img, url: dataUrl, isLoading: false } : img)),
          );
        };
        reader.readAsDataURL(file);
      }
    },
    [referenceImages.length],
  );

  const removeReferenceImage = useCallback((id: string) => {
    setReferenceImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const isImagesLoading = referenceImages.some((img) => img.isLoading);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isImagesLoading) return;

    if (!prompt.trim()) {
      toast.error('Type a prompt first.');
      return;
    }

    const uploadedImageUrls = referenceImages
      .filter((img) => img.url)
      .map((img) => img.url as string);

    // A batch run turns every saved product into its own target, carrying that
    // product's reference photos.
    const isBatch = selectedEntity === ALL_PRODUCTS_VALUE;

    // A batch spans many product types, so there is no single one to
    // substitute into the prompt.
    let selectedProductType: string | undefined;
    if (!isBatch && selectedEntity.startsWith('product:')) {
      const id = selectedEntity.slice('product:'.length);
      selectedProductType = products.find((p) => p.id === id)?.productType;
    }
    const resolvedPrompt = renderPrompt(prompt, selectedProductType);

    const batchTargets: GenerationTarget[] = isBatch
      ? products
          .filter((p) => p.referenceImages.length > 0)
          .map((p) => ({
            key: p.id,
            label: p.name,
            referenceImages: p.referenceImages.slice(0, MAX_REFERENCE_IMAGES),
          }))
      : [];

    if (isBatch && batchTargets.length === 0) {
      toast.error('None of your products have reference photos yet.');
      return;
    }

    // A batch multiplies cost by the number of products, so confirm before
    // firing off a large run the user can't easily cancel.
    if (isBatch) {
      const perProduct = angleSet ? ANGLE_SET_SIZE : imageCount;
      const total = batchTargets.length * perProduct;
      if (total > BATCH_CONFIRM_THRESHOLD) {
        const confirmed = window.confirm(
          `This will generate ${total} images (${perProduct} for each of ${batchTargets.length} products) and bill your provider for every one. Continue?`,
        );
        if (!confirmed) return;
      }
    }

    // An angle set is one request per angle, all from the same reference
    // photo, so `count` is driven by the angle list rather than the stepper.
    if (angleSet) {
      if (!isBatch && !uploadedImageUrls.length) {
        toast.error('Add a photo of the product first so every angle matches it.');
        return;
      }

      onSubmit?.({
        prompt: resolvedPrompt,
        count: PRODUCT_ANGLES.length,
        aspectRatio,
        resolution,
        outputFormat,
        referenceImages: uploadedImageUrls,
        provider,
        modelVariant,
        angleShots: buildAngleShots(resolvedPrompt),
        ...(isBatch ? { targets: batchTargets } : {}),
      });
      return;
    }

    onSubmit?.({
      prompt: resolvedPrompt,
      count: imageCount,
      aspectRatio,
      resolution,
      outputFormat,
      referenceImages: uploadedImageUrls,
      provider,
      modelVariant,
      ...(isBatch ? { targets: batchTargets } : {}),
    });
  };

  const incrementCount = () => {
    setImageCount((prev) => Math.min(prev + 1, maxImages));
  };

  const decrementCount = () => {
    setImageCount((prev) => Math.max(prev - 1, 1));
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="fixed inset-x-1/2 bottom-4 z-20 hidden w-full -translate-x-1/2 rounded-[2rem] border border-[var(--base-color-brand--umber)]/30 bg-[var(--base-color-brand--champagne)] p-[22px] shadow-[0_12px_40px_-12px_rgba(51,32,26,0.25)] md:block lg:max-w-[65rem] lg:min-w-[1000px]"
    >
      <fieldset className="relative z-20 flex gap-3">
        {/* Left section */}
        <div className="min-h-0 min-w-0 flex-1 space-y-3">
          {/* Reference images preview */}
          {referenceImages.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {referenceImages.map((img) => (
                <div key={img.id} className="group relative shrink-0">
                  <div className="relative size-14 rounded-xl bg-[var(--base-color-brand--shell)]">
                    {img.isLoading ? (
                      <div className="skeleton-loader size-full rounded-xl" />
                    ) : (
                      <>
                        <img
                          src={img.preview}
                          alt="Reference"
                          className="size-full rounded-xl object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeReferenceImage(img.id)}
                          className="absolute -top-3 -right-3 z-10 grid h-6 w-6 items-center justify-center rounded-full border border-[var(--base-color-brand--umber)]/60 bg-[var(--base-color-brand--shell)] text-[var(--base-color-brand--bean)] transition hover:bg-[var(--base-color-brand--bean)] hover:text-[var(--base-color-brand--shell)] xl:opacity-0 xl:group-hover:opacity-100"
                        >
                          <CloseIcon />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {referenceImages.length < MAX_REFERENCE_IMAGES && (
                <div className="relative size-14 shrink-0 rounded-xl border border-dashed border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)]">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="grid size-full cursor-pointer items-center justify-center text-[var(--base-color-brand--umber)] transition hover:text-[var(--base-color-brand--bean)] active:opacity-60"
                  >
                    <ImageAddIcon />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Prompt row */}
          <div className="flex gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_IMAGE_ACCEPT}
              multiple
              className="sr-only"
              onChange={handleFileSelect}
            />
            {referenceImages.length === 0 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative -top-[5.5px] grid h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] text-[var(--base-color-brand--bean)] transition hover:border-[var(--base-color-brand--cinamon)] hover:text-[var(--base-color-brand--cinamon)]"
                title="Add reference images (max 8)"
              >
                <PlusIcon />
              </button>
            )}
            <textarea
              ref={textareaRef}
              name="prompt"
              placeholder="Describe the scene you imagine"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                autoResizeTextarea();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!isImagesLoading && prompt.trim()) {
                    handleSubmit(e as unknown as React.FormEvent);
                  }
                }
              }}
              className="hide-scrollbar max-h-[120px] min-h-[40px] w-full resize-none rounded-none border-none bg-transparent p-0 text-[15px] text-[var(--text-color--text-primary)] placeholder:text-[var(--base-color-brand--umber)]/70 focus:outline-none"
            />
          </div>

          {/* Controls row */}
          <div className="flex h-9 items-center gap-2">
            <SavedPromptsMenu
              currentPrompt={prompt}
              onUsePrompt={(saved) => {
                setPrompt(saved);
                autoResizeTextarea();
              }}
            />
            <HelpTip
              label="About saved prompts"
              text="Save wording you like, then load it again later. Pair a saved prompt with 'All products' to run the identical prompt across your whole catalogue."
            />

            {availableProviders.length > 1 && (
              <SelectDropdown
                options={availableProviders.map((p) => ({
                  value: p,
                  label:
                    p === 'openai-api'
                      ? 'OpenAI API'
                      : p === 'openai-oauth'
                        ? 'OpenAI Account'
                        : 'fal.ai',
                }))}
                value={provider}
                onChange={(v) => setProvider(v as ImageProvider)}
                direction="up"
              />
            )}

            <SelectDropdown
              options={entityOptions}
              value={selectedEntity}
              onChange={handleEntityChange}
              direction="up"
            />
            <HelpTip
              label="About the product selector"
              text="Pick a saved product to use its reference photos automatically. Choose 'All products' to run this same prompt once for every product you've saved."
            />

            {/* Angle set — one shot per camera angle, all from the same photo. */}
            <button
              type="button"
              onClick={() => setAngleSet((prev) => !prev)}
              aria-pressed={angleSet}
              title={`Generate ${ANGLE_SET_SIZE} shots of the same product: ${PRODUCT_ANGLES.map((a) => a.label).join(', ')}, plus a close-up cropped from the 45° shot`}
              className={`flex h-10 shrink-0 items-center rounded-full border px-3 text-sm font-semibold transition-colors ${
                angleSet
                  ? 'border-[var(--base-color-brand--bean)] bg-[var(--base-color-brand--bean)] text-[var(--base-color-brand--shell)]'
                  : 'border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] text-[var(--base-color-brand--bean)] hover:text-[var(--base-color-brand--cinamon)]'
              }`}
            >
              {ANGLE_SET_SIZE} angles
            </button>
            <HelpTip
              label="About the angle set"
              text={`Turns one product photo into ${ANGLE_SET_SIZE} matching shots: ${PRODUCT_ANGLES.map((a) => a.label).join(' and ')}, plus a close-up cropped straight out of the 45° shot so the product is identical. Needs a reference photo.`}
            />

            {/* Image count selector — an angle set fixes its own count. */}
            <div
              className={`flex h-10 items-center gap-1 rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] px-3 ${
                angleSet ? 'pointer-events-none opacity-40' : ''
              }`}
            >
              <button
                type="button"
                onClick={decrementCount}
                disabled={angleSet || imageCount <= 1}
                className="text-[var(--base-color-brand--bean)] transition-colors hover:text-[var(--base-color-brand--cinamon)] disabled:opacity-40 disabled:hover:text-[var(--base-color-brand--bean)]"
              >
                <MinusIcon />
              </button>
              <span className="w-8 text-center text-sm font-semibold text-[var(--base-color-brand--bean)]">
                {angleSet ? ANGLE_SET_SIZE : imageCount}
                <span className="text-[var(--base-color-brand--umber)]">/{maxImages}</span>
              </span>
              <button
                type="button"
                onClick={incrementCount}
                disabled={angleSet || imageCount >= maxImages}
                className="text-[var(--base-color-brand--bean)] transition-colors hover:text-[var(--base-color-brand--cinamon)] disabled:opacity-40 disabled:hover:text-[var(--base-color-brand--bean)]"
              >
                <PlusIcon />
              </button>
            </div>

            <SelectDropdown
              options={aspectRatioOptions}
              value={aspectRatio}
              onChange={setAspectRatio}
              icon={aspectRatioIcons[aspectRatio] || <AutoIcon />}
              showIcons
              direction="up"
            />

            <SelectDropdown
              options={qualityOptions}
              value={resolution}
              onChange={setResolution}
              icon={<ResolutionIcon />}
              direction="up"
            />

            <SelectDropdown
              options={outputFormatOptions}
              value={outputFormat}
              onChange={setOutputFormat}
              icon={<FormatIcon />}
              direction="up"
            />
          </div>
        </div>

        {/* Right section - Generate button */}
        <aside className="flex h-[84px] items-end justify-end gap-3 self-end">
          <button
            type="submit"
            disabled={isImagesLoading}
            tabIndex={-1}
            className="inline-grid h-full w-36 grid-flow-col items-center justify-center gap-2 rounded-full border-none bg-[var(--base-color-brand--cinamon)] px-2.5 text-sm font-semibold tracking-wide text-[var(--base-color-brand--shell)] shadow-[0_4px_0_0_var(--base-color-brand--dark-red)] transition-all duration-150 hover:bg-[var(--base-color-brand--red)] focus:outline-none active:translate-y-0.5 active:shadow-[0_2px_0_0_var(--base-color-brand--dark-red)] disabled:cursor-not-allowed disabled:bg-[var(--base-color-brand--umber)] disabled:text-[var(--base-color-brand--shell)]/70 disabled:shadow-[0_4px_0_0_var(--base-color-brand--bean)]"
            style={{ fontFamily: 'var(--text-color--font-family--heading)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">
                {isImagesLoading ? 'Uploading...' : 'Generate'}
              </span>
              <SparkleIcon />
            </div>
          </button>
        </aside>
      </fieldset>
    </form>
  );
}
