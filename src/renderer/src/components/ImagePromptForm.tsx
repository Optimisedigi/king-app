import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { ProductReferencePicker } from '@/components/image/ProductReferencePicker';
import { collectProductReferences } from '@/lib/productReferences';
import { isGenericClipboardName, sourceNameForReferences } from '@/lib/sourceNames';
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
  ChevronDownIcon,
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
import { Hint } from '@/components/ui/Hint';
import SavedPromptsMenu from '@/components/ui/SavedPromptsMenu';
import type { GenerationTarget } from '@/lib/generationJobs';
import type { EntityData, ImageModelId } from '@/types/electron';
import type { ProductFolder } from '../../../shared/productFolders';
import {
  ALL_PRODUCTS_VALUE,
  SELECTED_GROUPS_VALUE,
  UNFILED_PRODUCTS_VALUE,
  isProductBatch,
  snapshotProductFolderTargets,
  snapshotSelectedProductTargets,
  type ManualProductGroup,
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

/** Remembers whether the prompter was collapsed, across tab switches and restarts. */
const COLLAPSED_STORAGE_KEY = 'imagePromptForm.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Above this many images, a batch asks for confirmation before spending. */
const BATCH_CONFIRM_THRESHOLD = 12;

interface ReferenceImage {
  id: string;
  file?: File;
  preview: string;
  url?: string;
  isLoading: boolean;
  /** Original file name of a photo added here, so exports can keep it. */
  fileName?: string;
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
    /** Original photo name for a single (non-batch) run's results. */
    sourceName?: string;
  }) => void;
  initialPrompt?: string;
  recreateData?: { prompt: string } | null;
  editData?: { imageUrl: string; sourceName?: string } | null;
}

export default function ImagePromptForm({
  onSubmit,
  initialPrompt = '',
  recreateData,
  editData,
}: ImagePromptFormProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  // Collapsing only hides the panel; it stays mounted so every setting is kept.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        /* Not persisted; the toggle still works for this session. */
      }
      return next;
    });
  }, []);
  const [selectedEntity, setSelectedEntity] = useState('none');
  // Each product folder remembers its own composition, e.g. one per cake size.
  useEffect(() => {
    useCompositionStore.getState().enterScope(selectedEntity);
  }, [selectedEntity]);
  const [selectedProductEntries, setSelectedProductEntries] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [manualGroups, setManualGroups] = useState<ManualProductGroup[]>([]);
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

  // Build entity selector options. `product:all` and folders run the same
  // prompt over each product, with its own photos, one image per product.
  // Folders sit directly under "All products" so a folder batch is easy to find;
  // individual entries, which combine into a single image, come last.
  const productGroupCount = (inFolder: (product: EntityData) => boolean): string => {
    const count = products.filter((p) => !p.pairedWith && inFolder(p)).length;
    return `${count} ${count === 1 ? 'product' : 'products'}, one image each`;
  };
  const folderOptions = [
    { value: '_folder_header', label: 'Product folders · one image per product', disabled: true },
    {
      value: UNFILED_PRODUCTS_VALUE,
      label: `Unfiled products — ${productGroupCount((p) => p.folderId === null || p.folderId === undefined)}`,
    },
    ...folders.map((folder) => ({
      value: `folder:${folder.id}`,
      label: `Folder: ${folder.name} — ${productGroupCount((p) => p.folderId === folder.id)}${folderError ? ' · unavailable' : ''}`,
      disabled: !!folderError,
    })),
    ...(selectedEntity.startsWith('folder:') &&
    selectedEntity !== UNFILED_PRODUCTS_VALUE &&
    !folders.some((folder) => `folder:${folder.id}` === selectedEntity)
      ? [{ value: selectedEntity, label: 'Folder unavailable · refresh folders', disabled: true }]
      : []),
  ];
  const hasProducts = products.length > 0 || selectedEntity === ALL_PRODUCTS_VALUE;
  const entityOptions = [
    { value: 'none', label: 'Default' },
    ...(hasProducts
      ? [
          { value: '_product_header', label: 'Products', disabled: true },
          {
            value: ALL_PRODUCTS_VALUE,
            label: `All products — ${productGroupCount(() => true)}`,
          },
        ]
      : []),
    ...folderOptions,
    ...(hasProducts
      ? [
          { value: '_group_header', label: 'Select product groups for a batch', disabled: true },
          ...products
            .filter((p) => !p.pairedWith)
            .map((p) => {
              const linked = products.find((entry) => entry.pairedWith === p.id);
              return {
                value: `group:${p.id}`,
                label: `Group: ${p.name}${linked ? ` + ${linked.name} (2 entries)` : ' (1 entry)'}`,
              };
            }),
          {
            value: '_entry_header',
            label: 'Tick entries to combine their photos into one image',
            disabled: true,
          },
          ...products.map((p) => ({ value: `product:${p.id}`, label: `Product: ${p.name}` })),
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
      selectedReferenceUrls.current = new Set();
      setSelectedProductEntries([]);
      setSelectedGroupIds([]);
      setManualGroups([]);
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
  }, [prompt, collapsed, autoResizeTextarea]);

  function addManualGroup(): void {
    const ids = selectedProductEntries.map((entry) => entry.slice('product:'.length));
    if (!ids.length) return;
    if (ids.some((id) => !products.some((entry) => entry.id === id))) {
      toast.error('Product entries have changed. Refresh choices and select them again.');
      return;
    }
    const selected = new Set(ids);
    if (
      ids.some((id) => {
        const entry = products.find((item) => item.id === id);
        return (
          (entry?.pairedWith && !selected.has(entry.pairedWith)) ||
          products.some((item) => item.pairedWith === id && !selected.has(item.id))
        );
      })
    ) {
      toast.error('Select both linked entries for this group.');
      return;
    }
    if (
      ids.some(
        (id) =>
          manualGroups.some((group) => group.ids.includes(id)) ||
          selectedGroupIds.some(
            (primary) =>
              id === primary ||
              products.some((entry) => entry.id === id && entry.pairedWith === primary),
          ),
      )
    ) {
      toast.error('An entry is already in a selected group.');
      return;
    }
    const available = new Set(collectProductReferences(products, ids));
    const urls = referenceImages.map((image) => image.url);
    if (isImagesLoading || urls.some((url) => !url || !available.has(url))) {
      toast.error('Use only saved product photos for a batch group.');
      return;
    }
    const selectedUrls = urls.filter((url): url is string => !!url);
    const max = usesComposition ? 7 : MAX_REFERENCE_IMAGES;
    if (!selectedUrls.length || selectedUrls.length > max) {
      toast.error(
        `Choose 1–${max} product photos for this group. Remove extra photos from the preview.`,
      );
      return;
    }
    setManualGroups([...manualGroups, { ids, referenceImages: selectedUrls }]);
    setSelectedProductEntries([]);
    selectedReferenceUrls.current = new Set();
    setReferenceImages([]);
    setSelectedEntity(SELECTED_GROUPS_VALUE);
  }

  function toggleProductGroup(value: string): void {
    const id = value.slice('group:'.length);
    if (!products.some((product) => product.id === id && !product.pairedWith)) return;
    if (manualGroups.some((group) => group.ids.includes(id))) {
      toast.error('An entry is already in a selected group.');
      return;
    }
    const next = selectedEntity === SELECTED_GROUPS_VALUE ? selectedGroupIds : [];
    setSelectedGroupIds(next.includes(id) ? next.filter((item) => item !== id) : [...next, id]);
    if (selectedEntity !== SELECTED_GROUPS_VALUE) setManualGroups([]);
    setSelectedProductEntries([]);
    selectedReferenceUrls.current = new Set();
    setReferenceImages([]);
    setSelectedEntity(SELECTED_GROUPS_VALUE);
  }

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
      if (selectedEntity !== SELECTED_GROUPS_VALUE) {
        setSelectedGroupIds([]);
        setManualGroups([]);
      }
      setSelectedProductEntries(next);
      setSelectedEntity(
        selectedEntity === SELECTED_GROUPS_VALUE ? SELECTED_GROUPS_VALUE : (next[0] ?? 'none'),
      );
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
      setCollapsed(false);
      selectedReferenceUrls.current = new Set();
      setSelectedProductEntries([]);
      setSelectedGroupIds([]);
      setManualGroups([]);
      setSelectedEntity('none');
      setReferenceImages([]);
    }
  }, [recreateData]);

  // Handle edit data
  useEffect(() => {
    if (!editData?.imageUrl) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPrompt('');
    setCollapsed(false);
    selectedReferenceUrls.current = new Set();
    setSelectedProductEntries([]);
    setSelectedGroupIds([]);
    setManualGroups([]);
    setSelectedEntity('none');
    setReferenceImages([
      {
        id,
        preview: editData.imageUrl,
        url: editData.imageUrl,
        isLoading: false,
        ...(editData.sourceName ? { fileName: editData.sourceName } : {}),
      },
    ]);
  }, [editData]);

  /** Add photos picked with the button, dropped, or pasted into the prompt box. */
  const addReferenceFiles = useCallback(
    (files: readonly File[], { fromClipboard = false } = {}) => {
      if (!files.length) return;
      if (usesComposition && referenceImages.length + files.length > 7) {
        toast.error('Composition allows at most 7 product photos. No photos were added.');
        return;
      }

      const validFiles: File[] = [];
      for (const file of files) {
        if (!SUPPORTED_IMAGE_MIME_REGEX.test(file.type)) continue;
        if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) continue;
        if (referenceImages.length + validFiles.length >= MAX_REFERENCE_IMAGES) break;
        validFiles.push(file);
      }
      if (validFiles.length < files.length) {
        toast.error(
          `Some photos were skipped. Use PNG, JPG or WebP under ${MAX_IMAGE_SIZE_MB} MB, up to ${MAX_REFERENCE_IMAGES} photos.`,
        );
      }

      const pendingImages: ReferenceImage[] = validFiles.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: URL.createObjectURL(file),
        isLoading: true,
      }));

      setReferenceImages((prev) => [...prev, ...pendingImages].slice(0, MAX_REFERENCE_IMAGES));

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
            prev.map((img) =>
              img.id === id
                ? {
                    ...img,
                    url: dataUrl,
                    isLoading: false,
                    // A copied screenshot arrives as "image.png"; don't name exports after that.
                    ...(fromClipboard && isGenericClipboardName(file.name)
                      ? {}
                      : { fileName: file.name }),
                  }
                : img,
            ),
          );
        };
        reader.readAsDataURL(file);
      }
    },
    [referenceImages.length, usesComposition],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      addReferenceFiles(files);
    },
    [addReferenceFiles],
  );

  /** Paste copied photos (from Finder or elsewhere) into the prompt box. Text pastes normally. */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files);
      if (!files.length) return;
      e.preventDefault();
      addReferenceFiles(files, { fromClipboard: true });
    },
    [addReferenceFiles],
  );

  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  /** Only react to drags that carry files, not dragged text or gallery images. */
  const hasFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files');

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
    // Name each result after the photo it came from, for exports.
    const addedFileNames = new Map(
      referenceImages.flatMap((img) => (img.url && img.fileName ? [[img.url, img.fileName]] : [])),
    );
    const singleSourceName = sourceNameForReferences(
      uploadedImageUrls,
      [...products, ...characters],
      addedFileNames,
    );

    // A batch run turns every saved product into its own target, carrying that
    // product's reference photos.
    const isBatch = isProductBatch(selectedEntity);
    if (isBatch && selectedProductEntries.length) {
      toast.error('Add the ticked entries as a group before generating. No images were queued.');
      return;
    }

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
    if (selectedProductEntries.length && !isBatch) {
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
        const batch =
          selectedEntity === SELECTED_GROUPS_VALUE
            ? snapshotSelectedProductTargets(
                selectedGroupIds,
                freshProducts,
                usesComposition,
                manualGroups,
              )
            : snapshotProductFolderTargets(
                selectedEntity,
                freshProducts,
                freshFolders,
                usesComposition,
              );
        batchTargets = batch.targets.map((target) => {
          const sourceName = sourceNameForReferences(target.referenceImages, freshProducts);
          return sourceName ? { ...target, sourceName } : target;
        });
        batchScope = batch.scope;
        const targetIds = new Set(batchTargets.map((target) => target.key));
        hasPairedTargets =
          manualGroups.some((group) => group.ids.length > 1) ||
          freshProducts.some((product) => product.pairedWith && targetIds.has(product.pairedWith));
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
        ...(!isBatch && singleSourceName ? { sourceName: singleSourceName } : {}),
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
      ...(!isBatch && singleSourceName ? { sourceName: singleSourceName } : {}),
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
      onPaste={handlePaste}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsDraggingFiles(true);
      }}
      onDragLeave={(e) => {
        // Ignore moves between children; clear only when leaving the form.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDraggingFiles(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setIsDraggingFiles(false);
        addReferenceFiles(Array.from(e.dataTransfer.files));
      }}
      className={`fixed inset-x-1/2 bottom-4 z-20 hidden -translate-x-1/2 border bg-[var(--base-color-brand--champagne)] shadow-[0_12px_40px_-12px_rgba(51,32,26,0.25)] transition-colors md:block ${
        collapsed
          ? 'w-max max-w-[calc(100vw-2rem)] rounded-full p-1'
          : 'w-[calc(100vw-2rem)] rounded-[2rem] p-[22px] lg:max-w-[1065px]'
      } ${
        isDraggingFiles
          ? 'border-2 border-dashed border-[var(--base-color-brand--bean)]'
          : 'border-[var(--base-color-brand--umber)]/30'
      }`}
    >
      {isDraggingFiles && (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-0 -top-9 text-center text-sm font-semibold text-[var(--base-color-brand--bean)]"
        >
          Drop photos to add them as references
        </p>
      )}
      {collapsed ? (
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={false}
          aria-label="Show prompter"
          className="flex h-9 max-w-[min(480px,calc(100vw-3rem))] items-center gap-2 rounded-full px-4 text-[11px] font-semibold text-[var(--base-color-brand--bean)] transition-colors hover:text-[var(--base-color-brand--cinamon)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--base-color-brand--bean)]"
        >
          <span className="rotate-180">
            <ChevronDownIcon />
          </span>
          <span className="min-w-0 truncate">
            {prompt.trim() ? prompt.trim() : 'Show prompter'}
          </span>
          {referenceImages.length > 0 && (
            <span className="shrink-0 text-[var(--base-color-brand--umber)]">
              · {referenceImages.length} photo{referenceImages.length === 1 ? '' : 's'}
            </span>
          )}
        </button>
      ) : (
        <span className="absolute -top-3 left-1/2 z-30 -translate-x-1/2">
          <Hint text="Hide prompter">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded
              aria-label="Hide prompter"
              className="grid h-6 w-10 items-center justify-center rounded-full border border-[var(--base-color-brand--umber)]/40 bg-[var(--base-color-brand--shell)] text-[var(--base-color-brand--bean)] transition hover:bg-[var(--base-color-brand--bean)] hover:text-[var(--base-color-brand--shell)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--base-color-brand--bean)]"
            >
              <ChevronDownIcon />
            </button>
          </Hint>
        </span>
      )}
      <fieldset className={`relative z-20 min-w-0 gap-3 ${collapsed ? 'hidden' : 'flex'}`}>
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
                        <span className="absolute -top-3 -right-3 z-10">
                          <Hint text="Remove photo">
                            <button
                              type="button"
                              onClick={() => removeReferenceImage(img.id)}
                              aria-label="Remove reference photo"
                              className="grid h-6 w-6 items-center justify-center rounded-full border border-[var(--base-color-brand--umber)]/60 bg-[var(--base-color-brand--shell)] text-[var(--base-color-brand--bean)] transition hover:bg-[var(--base-color-brand--bean)] hover:text-[var(--base-color-brand--shell)] focus-visible:opacity-100 xl:opacity-0 xl:group-hover:opacity-100"
                            >
                              <CloseIcon />
                            </button>
                          </Hint>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {referenceImages.length < MAX_REFERENCE_IMAGES && (
                <Hint text="Add more photos">
                  <div className="relative size-14 shrink-0 rounded-xl border border-dashed border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)]">
                    <button
                      type="button"
                      aria-label="Add reference photos"
                      onClick={() => fileInputRef.current?.click()}
                      className="grid size-full cursor-pointer items-center justify-center text-[var(--base-color-brand--umber)] transition hover:text-[var(--base-color-brand--bean)] active:opacity-60"
                    >
                      <ImageAddIcon />
                    </button>
                  </div>
                </Hint>
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
              <Hint text="Add product photos, or drop them here">
                <button
                  type="button"
                  aria-label="Add reference photos"
                  onClick={() => fileInputRef.current?.click()}
                  className="relative -top-[5.5px] grid h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] text-[var(--base-color-brand--bean)] transition hover:border-[var(--base-color-brand--cinamon)] hover:text-[var(--base-color-brand--cinamon)]"
                >
                  <PlusIcon />
                </button>
              </Hint>
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

          {/* Two fixed rows of controls: what to make (row 1), then output settings
              and composition beside Generate (row 2). Every control shows a short
              hover/focus hint instead of a "?" marker. */}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-controls-row="1">
            <Hint text="Save or reuse prompt wording">
              <SavedPromptsMenu
                currentPrompt={prompt}
                onUsePrompt={(saved) => {
                  setPrompt(saved);
                  autoResizeTextarea();
                }}
              />
            </Hint>

            {modelChoices.length > 0 && (
              <Hint text="Image model">
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
              </Hint>
            )}

            <Hint text="Products to photograph">
              <ProductReferencePicker
                options={entityOptions}
                value={selectedEntity}
                selectedProducts={selectedProductEntries}
                selectedGroups={selectedGroupIds}
                manualGroups={manualGroups.map(
                  (group) =>
                    `${group.ids.map((id) => products.find((p) => p.id === id)?.name ?? 'Unavailable').join(' + ')} (${group.referenceImages.length} photos)`,
                )}
                onAddGroup={addManualGroup}
                onRemoveGroup={(index) =>
                  setManualGroups((groups) => groups.filter((_, i) => i !== index))
                }
                onScopeChange={handleEntityChange}
                onToggleProduct={toggleProductReference}
                onToggleGroup={toggleProductGroup}
              />
            </Hint>
            <Hint text={folderError ?? 'Reload products and folders'}>
              <button
                type="button"
                onClick={() => {
                  void refreshChoices();
                }}
                disabled={foldersLoading}
                className="px-2 text-xs underline disabled:opacity-40"
              >
                {foldersLoading
                  ? 'Loading folders…'
                  : folderError
                    ? 'Retry folders'
                    : 'Refresh choices'}
              </button>
            </Hint>
            {folderError && (
              <span role="status" className="text-xs">
                {folderError}
              </span>
            )}

            {/* Angle set — one shot per camera angle, all from the same photo. */}
            <Hint text="Eye level, 45° and close-up">
              <button
                type="button"
                onClick={() => setAngleSet((prev) => !prev)}
                aria-pressed={angleSet}
                className={`flex h-10 shrink-0 items-center rounded-full border px-3 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  angleSet
                    ? 'border-[var(--base-color-brand--bean)] bg-[var(--base-color-brand--bean)] text-[var(--base-color-brand--shell)]'
                    : 'border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] text-[var(--base-color-brand--bean)] hover:text-[var(--base-color-brand--cinamon)]'
                }`}
              >
                {ANGLE_SET_SIZE} angles
              </button>
            </Hint>
          </div>
          {/* Reserve space for Generate beside the output settings row. Generate
              lines up with the controls, not with any message wrapping below them. */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-controls-row="2">
              {/* Image count selector — an angle set fixes its own count. */}
              <Hint
                text={isProductBatch(selectedEntity) ? 'Images per product' : 'Number of images'}
              >
                <div
                  className={`flex h-10 items-center gap-1 rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] px-3 ${
                    angleSet ? 'pointer-events-none opacity-40' : ''
                  }`}
                >
                  <button
                    type="button"
                    aria-label="Fewer images"
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
                    aria-label="More images"
                    onClick={incrementCount}
                    disabled={angleSet || imageCount >= maxImages}
                    className="text-[var(--base-color-brand--bean)] transition-colors hover:text-[var(--base-color-brand--cinamon)] disabled:opacity-40 disabled:hover:text-[var(--base-color-brand--bean)]"
                  >
                    <PlusIcon />
                  </button>
                </div>
              </Hint>

              {usesComposition ? (
                <Hint text="Set by the composition; choose None to change">
                  <span className="px-2 text-xs">
                    {angleSet
                      ? 'Aspect fixed per angle composition'
                      : `${effectiveAspect} · Fixed by composition`}
                  </span>
                </Hint>
              ) : (
                <Hint text="Aspect ratio">
                  <SelectDropdown
                    options={aspectRatioOptions}
                    value={aspectRatio}
                    onChange={setAspectRatio}
                    icon={aspectRatioIcons[aspectRatio] || <AutoIcon />}
                    showIcons
                    direction="up"
                  />
                </Hint>
              )}

              <Hint text="Image quality">
                <SelectDropdown
                  options={qualityOptions}
                  value={resolution}
                  onChange={setResolution}
                  icon={<ResolutionIcon />}
                  direction="up"
                />
              </Hint>

              <Hint text="File type">
                <SelectDropdown
                  options={outputFormatOptions}
                  value={outputFormat}
                  onChange={setOutputFormat}
                  icon={<FormatIcon />}
                  direction="up"
                />
              </Hint>

              <CompositionTemplatePicker angleSet={angleSet} />
            </div>
            {/* Generate stays alongside the controls and matches their 40px height. */}
            <Hint text="Create the images">
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
            </Hint>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
