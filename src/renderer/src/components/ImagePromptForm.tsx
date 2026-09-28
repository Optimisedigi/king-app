import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { ProductReferencePicker } from '@/components/image/ProductReferencePicker';
import { collectProductReferences } from '@/lib/productReferences';
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
import type { ProductFolder } from '../../../shared/productFolders';
import {
  ALL_PRODUCTS_VALUE,
  UNFILED_PRODUCTS_VALUE,
  isProductBatch,
  snapshotProductFolderTargets,
} from '@/lib/productFolderTargets';
import { MODEL_OPTIONS, useModelStore } from '@/stores/modelStore';
import { CompositionTemplatePicker } from '@/components/composition/CompositionTemplatePicker';
import { useCompositionStore } from '@/stores/compositionStore';
import { preflightComposition } from '@/lib/compositionPrompt';
import {
  resolveCompositionAssignments,
  preflightCompositionAssignments,
  templatesForPreflight,
  type CompositionAssignments,
} from '@/lib/compositionAssignments';
import type { ShootAngle, ShootTemplate } from '../../../shared/shootTemplates';

type ImageProvider = 'openai-api' | 'openai-oauth' | 'fal';

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
    composition?: ShootTemplate;
    compositions?: CompositionAssignments;
    singleShotAngle?: ShootAngle;
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
  const [selectedProductEntries, setSelectedProductEntries] = useState<string[]>([]);
  const selectedReferenceUrls = useRef<Set<string>>(new Set());
  const [imageCount, setImageCount] = useState(1);
  const [angleSet, setAngleSet] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const compositionState = useCompositionStore();
  const composition = compositionState.templates.find(
    (template) => !angleSet && template.id === compositionState.selectedId,
  );
  const usesComposition = angleSet
    ? !!(
        compositionState.angleSelections['eye-level'] ||
        compositionState.angleSelections['elevated-45']
      )
    : !!compositionState.selectedId;
  const effectiveAspect = composition?.aspectRatio ?? aspectRatio;
  const [preflighting, setPreflighting] = useState(false);
  const preflightRef = useRef(false);
  const [resolution, setResolution] = useState('high');
  const [outputFormat, setOutputFormat] = useState('png');
  const [provider, setProvider] = useState<ImageProvider>('openai-api');
  const [availableProviders, setAvailableProviders] = useState<ImageProvider[]>(['openai-api']);
  const providerRef = useRef(provider);
  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);
  const selectedModel = useModelStore((s) => s.selectedModel);
  const setSelectedModel = useModelStore((s) => s.setSelectedModel);
  // Nano Banana is only available through fal.ai; OpenAI otherwise uses GPT Image 2.
  const modelVariant =
    provider !== 'fal' && selectedModel === 'nano_banana_pro' ? 'gpt_image_2' : selectedModel;
  const modelChoices = availableProviders.flatMap((availableProvider) =>
    MODEL_OPTIONS.filter(
      (model) => availableProvider === 'fal' || model.value !== 'nano_banana_pro',
    ).map((model) => ({
      value: `${availableProvider}:${model.value}`,
      label: model.label,
      provider: availableProvider,
      model: model.value,
    })),
  );
  const modelOptions = availableProviders.flatMap((availableProvider) => [
    {
      value: `_${availableProvider}`,
      label:
        availableProvider === 'openai-api'
          ? 'OpenAI API'
          : availableProvider === 'openai-oauth'
            ? 'OpenAI OAuth'
            : 'fal.ai',
      disabled: true,
    },
    ...modelChoices.filter((choice) => choice.provider === availableProvider),
  ]);

  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [products, setProducts] = useState<EntityData[]>([]);
  const [characters, setCharacters] = useState<EntityData[]>([]);
  const [folders, setFolders] = useState<ProductFolder[]>([]);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const loadFolders = useCallback(async () => {
    try {
      setFolders(await window.api.productFolders.list());
      setFolderError(null);
    } catch {
      setFolderError('Could not load product folders. Retry to refresh folder choices.');
    } finally {
      setFoldersLoading(false);
    }
  }, []);
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
    void loadFolders();
  }, [loadFolders]);

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
        // Restore a compatible provider for the persisted Nano Banana selection.
        if (
          useModelStore.getState().selectedModel === 'nano_banana_pro' &&
          providers.includes('fal')
        ) {
          setProvider('fal');
        } else if (providers[0] && !providers.includes(providerRef.current)) {
          setProvider(providers[0]);
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
    ...(products.length > 0 || selectedEntity === ALL_PRODUCTS_VALUE
      ? [
          { value: '_product_header', label: 'Products', disabled: true },
          {
            value: ALL_PRODUCTS_VALUE,
            label: `All products (${products.filter((p) => !p.pairedWith).length} groups; ${products.length} entries)`,
          },
          ...products.map((p) => ({ value: `product:${p.id}`, label: `Product: ${p.name}` })),
        ]
      : []),
    { value: '_folder_header', label: 'Product folders', disabled: true },
    {
      value: UNFILED_PRODUCTS_VALUE,
      label: `Unfiled products (${products.filter((p) => !p.pairedWith && (p.folderId === null || p.folderId === undefined)).length})`,
    },
    ...folders.map((folder) => ({
      value: `folder:${folder.id}`,
      label: `Folder: ${folder.name} (${products.filter((p) => !p.pairedWith && p.folderId === folder.id).length})${folderError ? ' · unavailable' : ''}`,
      disabled: !!folderError,
    })),
    ...(selectedEntity.startsWith('folder:') &&
    selectedEntity !== UNFILED_PRODUCTS_VALUE &&
    !folders.some((folder) => `folder:${folder.id}` === selectedEntity)
      ? [{ value: selectedEntity, label: 'Folder unavailable · refresh folders', disabled: true }]
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
      selectedReferenceUrls.current = new Set();
      setSelectedProductEntries([]);
      setSelectedEntity(value);

      // A batch run pulls each product's own photos at submit time, so there
      // is no single set to preview here.
      if (value === 'none' || isProductBatch(value)) {
        setReferenceImages([]);
        return;
      }

      const [type, id] = value.split(':');
      const entities = type === 'product' ? products : characters;
      const entity = entities.find((e) => e.id === id);

      if (!entity) return;
      const primary =
        type === 'product' && entity.pairedWith
          ? products.find((product) => product.id === entity.pairedWith)
          : entity;
      if (!primary) return;
      const secondary =
        type === 'product'
          ? products.find((product) => product.pairedWith === primary.id)
          : undefined;
      const referenceUrls = secondary
        ? collectProductReferences(products, [primary.id, secondary.id])
        : primary.referenceImages;
      if (secondary) {
        setSelectedEntity(`product:${primary.id}`);
        setSelectedProductEntries([`product:${primary.id}`, `product:${secondary.id}`]);
        selectedReferenceUrls.current = new Set(referenceUrls);
      }
      const entityImages: ReferenceImage[] = referenceUrls
        .slice(0, usesComposition ? referenceUrls.length : MAX_REFERENCE_IMAGES)
        .map((url) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          preview: url,
          url,
          isLoading: false,
        }));

      setReferenceImages(entityImages);
    },
    [products, characters, usesComposition],
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

  function toggleProductReference(value: string): void {
    const product = products.find((entry) => `product:${entry.id}` === value);
    const primaryId = product?.pairedWith ?? product?.id;
    const secondary = products.find((entry) => entry.pairedWith === primaryId);
    const linked =
      product && primaryId && secondary && !selectedProductEntries.length
        ? [`product:${primaryId}`, `product:${secondary.id}`]
        : [value];
    const next = selectedProductEntries.includes(value)
      ? selectedProductEntries.filter((entry) => entry !== value)
      : [...new Set([...selectedProductEntries, ...linked])];
    try {
      const urls = collectProductReferences(
        products,
        next.map((entry) => entry.slice('product:'.length)),
      );
      const previousUrls = selectedReferenceUrls.current;
      const extras =
        selectedProductEntries.length || selectedEntity === 'none'
          ? referenceImages.filter((image) => !image.url || !previousUrls.has(image.url))
          : [];
      const existing = new Map(
        referenceImages.filter((image) => image.url).map((image) => [image.url, image]),
      );
      const extraUrls = new Set(extras.map((image) => image.url));
      const merged = [
        ...urls
          .filter((url) => !extraUrls.has(url))
          .map(
            (url) =>
              existing.get(url) ?? { id: crypto.randomUUID(), preview: url, url, isLoading: false },
          ),
        ...extras,
      ];
      if (merged.length > MAX_REFERENCE_IMAGES)
        throw new Error(
          `Use at most ${MAX_REFERENCE_IMAGES} reference photos. This entry was not added.`,
        );
      selectedReferenceUrls.current = new Set(urls.filter((url) => !extraUrls.has(url)));
      setReferenceImages(merged);
      setSelectedProductEntries(next);
      setSelectedEntity(next[0] ?? 'none');
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Could not select these product references.',
      );
    }
  }

  async function refreshChoices(): Promise<void> {
    setFoldersLoading(true);
    await loadFolders();
    try {
      setProducts(await window.api.entities.list('products'));
    } catch {
      toast.error('Could not refresh products. Your current reference selection was kept.');
    }
  }

  // Handle recreate data
  useEffect(() => {
    if (recreateData) {
      setPrompt(recreateData.prompt);
      selectedReferenceUrls.current = new Set();
      setSelectedProductEntries([]);
      setSelectedEntity('none');
      setReferenceImages([]);
    }
  }, [recreateData]);

  // Handle edit data
  useEffect(() => {
    if (!editData?.imageUrl) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPrompt('');
    selectedReferenceUrls.current = new Set();
    setSelectedProductEntries([]);
    setSelectedEntity('none');
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
      if (usesComposition && referenceImages.length + files.length > 7) {
        toast.error('Composition allows at most 7 product photos. No photos were added.');
        e.target.value = '';
        return;
      }

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
    [referenceImages.length, usesComposition],
  );

  const removeReferenceImage = useCallback((id: string) => {
    setReferenceImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const isImagesLoading = referenceImages.some((img) => img.isLoading);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (isImagesLoading || preflightRef.current) return;

    if (!prompt.trim()) {
      toast.error('Type a prompt first.');
      return;
    }

    const uploadedImageUrls = referenceImages
      .filter((img) => img.url)
      .map((img) => img.url as string);

    // A batch run turns every saved product into its own target, carrying that
    // product's reference photos.
    const isBatch = isProductBatch(selectedEntity);

    // A batch spans many product types, so there is no single one to
    // substitute into the prompt.
    let selectedProductType: string | undefined;
    if (!isBatch && selectedEntity.startsWith('product:')) {
      const id = selectedEntity.slice('product:'.length);
      selectedProductType = products.find((p) => p.id === id)?.productType;
    }
    const resolvedPrompt = [
      renderPrompt(prompt, selectedProductType),
      ...(selectedProductEntries.length > 1
        ? [
            'The selected product reference photos are complementary views of one and the same product. Generate a single product, preserving its details across views. These photos do not define the output camera angle.',
          ]
        : []),
    ].join('\n\n');
    if (
      selectedProductEntries.length > 1 &&
      (angleSet
        ? buildAngleShots(resolvedPrompt, usesComposition).map((shot) => shot.prompt)
        : [resolvedPrompt]
      ).some((text) => text.length > 32000)
    ) {
      toast.error(
        'The combined reference prompt is too long. Shorten your prompt before generating.',
      );
      return;
    }

    const snapshot = composition ? structuredClone(composition) : undefined;
    if (selectedProductEntries.length) {
      const selectedSavedUrls = [...selectedReferenceUrls.current];
      const maxReferences = usesComposition ? 7 : MAX_REFERENCE_IMAGES;
      if (uploadedImageUrls.length > maxReferences) {
        toast.error(
          `Selected references contain ${uploadedImageUrls.length} photos. Use at most ${maxReferences}${usesComposition ? ' product photos plus the composition reference' : ' reference photos'}. No images were queued.`,
        );
        return;
      }
      preflightRef.current = true;
      setPreflighting(true);
      try {
        const freshProducts = await window.api.entities.list('products');
        const available = new Set(
          collectProductReferences(
            freshProducts,
            selectedProductEntries.map((entry) => entry.slice('product:'.length)),
          ),
        );
        if (
          selectedSavedUrls.some((url) => uploadedImageUrls.includes(url) && !available.has(url))
        ) {
          throw new Error(
            'Selected product photos have changed. Refresh choices, then untick and reselect those entries before generating.',
          );
        }
      } catch (cause) {
        toast.error(
          cause instanceof Error
            ? cause.message
            : 'Could not validate the selected product entries. Retry before generating.',
        );
        return;
      } finally {
        preflightRef.current = false;
        setPreflighting(false);
      }
    }
    let batchTargets: GenerationTarget[] = [];
    let batchScope = 'All products';
    let hasPairedTargets = false;
    if (isBatch) {
      preflightRef.current = true;
      setPreflighting(true);
      try {
        // Folder membership must be fresh before any preflight or paid work.
        // All products does not depend on folder availability.
        const [freshProducts, freshFolders] = await Promise.all([
          window.api.entities.list('products'),
          selectedEntity.startsWith('folder:')
            ? window.api.productFolders.list()
            : Promise.resolve(folders),
        ]).catch(() => {
          throw new Error(
            'Could not refresh products or folders. Retry Generate; no generation was started.',
          );
        });
        setProducts(freshProducts);
        if (selectedEntity.startsWith('folder:')) {
          setFolders(freshFolders);
          setFolderError(null);
        }
        const batch = snapshotProductFolderTargets(
          selectedEntity,
          freshProducts,
          freshFolders,
          usesComposition,
        );
        batchTargets = batch.targets;
        batchScope = batch.scope;
        const targetIds = new Set(batchTargets.map((target) => target.key));
        hasPairedTargets = freshProducts.some(
          (product) => product.pairedWith && targetIds.has(product.pairedWith),
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Could not refresh this batch. Retry Generate.',
        );
        return;
      } finally {
        preflightRef.current = false;
        setPreflighting(false);
      }
    }

    let compositions: CompositionAssignments | undefined;
    if (
      usesComposition &&
      (!compositionState.loaded || compositionState.error || (!angleSet && !snapshot))
    ) {
      toast.error('Composition is unavailable. Retry compositions or select None.');
      return;
    }
    if (usesComposition) {
      preflightRef.current = true;
      setPreflighting(true);
      try {
        const targets = isBatch
          ? batchTargets
          : [{ label: null, referenceImages: uploadedImageUrls }];
        if (angleSet) {
          compositions = resolveCompositionAssignments(
            compositionState.templates,
            compositionState.angleSelections,
          );
          if (compositions) {
            preflightCompositionAssignments({
              assignments: compositions,
              targets,
              basePrompt: resolvedPrompt,
            });
            for (const template of templatesForPreflight(compositions)) {
              await window.api.shootTemplates.preflight(template);
            }
          }
        } else if (snapshot) {
          preflightComposition({
            template: snapshot,
            aspectRatio: effectiveAspect,
            targets,
            angles: [compositionState.singleShotAngle],
            basePrompt: resolvedPrompt,
          });
          await window.api.shootTemplates.preflight(snapshot);
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Composition references are unavailable. Reopen the editor and upload them again.',
        );
        return;
      } finally {
        preflightRef.current = false;
        setPreflighting(false);
      }
    }

    // A batch multiplies cost by the number of products, so confirm before
    // firing off a large run the user can't easily cancel.
    if (isBatch) {
      const perProduct = angleSet ? ANGLE_SET_SIZE : imageCount;
      const total = batchTargets.length * perProduct;
      if (total > BATCH_CONFIRM_THRESHOLD || hasPairedTargets) {
        const confirmed = window.confirm(
          angleSet
            ? `${batchScope}: This will make ${total} images for ${batchTargets.length} products: ${batchTargets.length * PRODUCT_ANGLES.length} paid generations plus ${batchTargets.length} local close-up crops. Continue?`
            : `${batchScope}: This will generate ${total} images (${perProduct} for each of ${batchTargets.length} products) and bill your provider for every one. Continue?`,
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
        aspectRatio: effectiveAspect,
        compositions,
        singleShotAngle: compositionState.singleShotAngle,
        resolution,
        outputFormat,
        referenceImages: uploadedImageUrls,
        provider,
        modelVariant,
        angleShots: buildAngleShots(resolvedPrompt, !!compositions),
        ...(isBatch ? { targets: batchTargets } : {}),
      });
      return;
    }

    onSubmit?.({
      prompt: resolvedPrompt,
      count: imageCount,
      aspectRatio: effectiveAspect,
      composition: snapshot,
      singleShotAngle: compositionState.singleShotAngle,
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

  // Width is capped to the viewport so the panel and its Generate button can
  // never extend past the window edge on a narrow screen.
  return (
    <form
      onSubmit={handleSubmit}
      className="fixed inset-x-1/2 bottom-4 z-20 hidden w-[calc(100vw-2rem)] -translate-x-1/2 rounded-[2rem] border border-[var(--base-color-brand--umber)]/30 bg-[var(--base-color-brand--champagne)] p-[22px] shadow-[0_12px_40px_-12px_rgba(51,32,26,0.25)] md:block lg:max-w-[1065px]"
    >
      <fieldset className="relative z-20 flex min-w-0 gap-3">
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
              className="hide-scrollbar max-h-[120px] min-h-[40px] w-full min-w-0 resize-none rounded-none border-none bg-transparent p-0 text-[15px] text-[var(--text-color--text-primary)] placeholder:text-[var(--base-color-brand--umber)]/70 focus:outline-none"
            />
          </div>

          <CompositionTemplatePicker angleSet={angleSet} />
          {/* Reserve space for Generate beside the final row of wrapping controls. */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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

              {modelChoices.length > 0 && (
                <SelectDropdown
                  options={modelOptions}
                  value={`${provider}:${modelVariant}`}
                  onChange={(value) => {
                    const choice = modelChoices.find((option) => option.value === value);
                    if (!choice) return;
                    setProvider(choice.provider);
                    setSelectedModel(choice.model);
                  }}
                  direction="up"
                />
              )}

              <ProductReferencePicker
                options={entityOptions}
                value={selectedEntity}
                selectedProducts={selectedProductEntries}
                onScopeChange={handleEntityChange}
                onToggleProduct={toggleProductReference}
              />
              <button
                type="button"
                onClick={() => {
                  void refreshChoices();
                }}
                disabled={foldersLoading}
                className="px-2 text-xs underline disabled:opacity-40"
                title={folderError ?? 'Refresh product folder choices'}
              >
                {foldersLoading
                  ? 'Loading folders…'
                  : folderError
                    ? 'Retry folders'
                    : 'Refresh choices'}
              </button>
              {folderError && (
                <span role="status" className="text-xs">
                  {folderError}
                </span>
              )}
              <HelpTip
                label="About the product selector"
                text="Tick entries to combine their photos for one product. Approve suggested pairs on the Products page so folder and All products batches use both views; unpaired entries remain separate. Use up to 7 product photos with a composition, or 8 without one."
              />

              {/* Angle set — one shot per camera angle, all from the same photo. */}
              <button
                type="button"
                onClick={() => setAngleSet((prev) => !prev)}
                aria-pressed={angleSet}
                title={`Generate ${ANGLE_SET_SIZE} shots of the same product: ${PRODUCT_ANGLES.map((a) => a.label).join(', ')}, plus a close-up cropped from the 45° shot`}
                className={`flex h-10 shrink-0 items-center rounded-full border px-3 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  angleSet
                    ? 'border-[var(--base-color-brand--bean)] bg-[var(--base-color-brand--bean)] text-[var(--base-color-brand--shell)]'
                    : 'border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] text-[var(--base-color-brand--bean)] hover:text-[var(--base-color-brand--cinamon)]'
                }`}
              >
                {ANGLE_SET_SIZE} angles
              </button>
              <HelpTip
                label="About the angle set"
                text="Generates eye level and 45° above using their assigned compositions, then crops a left-side close-up from the 45° result. Assignments are remembered for future runs and apply to every selected product. Results may vary."
              />

              {/* Image count selector — an angle set fixes its own count. */}
              <div
                title={
                  isProductBatch(selectedEntity) ? 'Images per product (minimum 1)' : 'Image count'
                }
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
                <span className="w-8 text-center text-[11px] font-semibold text-[var(--base-color-brand--bean)]">
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

              {usesComposition ? (
                <span
                  className="px-2 text-xs"
                  title="Composition fixes the output aspect. Select None to change it."
                >
                  {angleSet
                    ? 'Aspect fixed per angle composition'
                    : `${effectiveAspect} · Fixed by composition`}
                </span>
              ) : (
                <SelectDropdown
                  options={aspectRatioOptions}
                  value={aspectRatio}
                  onChange={setAspectRatio}
                  icon={aspectRatioIcons[aspectRatio] || <AutoIcon />}
                  showIcons
                  direction="up"
                />
              )}

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
            {/* Generate stays alongside the controls and matches their 40px height. */}
            <button
              type="submit"
              disabled={isImagesLoading || preflighting}
              className="inline-grid h-10 w-28 shrink-0 grid-flow-col items-center justify-center gap-2 rounded-full border-none bg-[var(--base-color-brand--cinamon)] px-2.5 text-sm font-semibold tracking-wide text-[var(--base-color-brand--shell)] shadow-[0_4px_0_0_var(--base-color-brand--dark-red)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[var(--base-color-brand--red)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--base-color-brand--bean)] active:translate-y-0.5 active:shadow-[0_2px_0_0_var(--base-color-brand--dark-red)] disabled:cursor-not-allowed disabled:bg-[var(--base-color-brand--umber)] disabled:text-[var(--base-color-brand--shell)]/70 disabled:shadow-[0_4px_0_0_var(--base-color-brand--bean)]"
              style={{ fontFamily: 'var(--text-color--font-family--heading)' }}
            >
              <span className="text-[11px] font-semibold whitespace-nowrap">
                {preflighting ? 'Checking…' : isImagesLoading ? 'Uploading...' : 'Generate'}
              </span>
              <SparkleIcon />
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
