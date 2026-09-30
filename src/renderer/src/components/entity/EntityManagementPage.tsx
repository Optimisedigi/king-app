import { useCallback, useEffect, useState } from 'react';
import { ProductFolderToolbar } from './ProductFolderToolbar';
import { ProductPairReview } from './ProductPairReview';
import { MAX_PRODUCT_FOLDER_MOVE, type ProductFolder } from '../../../../shared/productFolders';
import UploadModal from './UploadModal';
import UploadReviewModal from './UploadReviewModal';
import EntityCard from './EntityCard';
import DeleteConfirmationModal from '@/components/ui/DeleteConfirmationModal';
import { useEntityManagement } from '@/hooks/useEntityManagement';
import type { UploadedImage, EntityType } from '@/hooks/useEntityManagement';
import type { EntityData } from '@/types/electron';
import type { PageType } from '@/App';
import { toast } from 'sonner';
import { MAX_BULK_ITEMS } from '@/lib/bulkProducts';
import { SparkleIcon, UploadIcon } from '@/components/icons';
import { SUPPORTED_IMAGE_ACCEPT } from '@/lib/constants/image-form';

interface EntityManagementPageProps {
  entityType: EntityType;
  title: string;
  subtitle: string;
  createLabel: string;
  deleteTitle: string;
  deleteMessage: string;
  onNavigate: (page: PageType) => void;
}

export default function EntityManagementPage({
  entityType,
  title,
  subtitle,
  createLabel,
  deleteTitle,
  deleteMessage,
  onNavigate,
}: EntityManagementPageProps) {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [activeFolder, setActiveFolder] = useState('all');
  const [folders, setFolders] = useState<ProductFolder[]>([]);
  const [folderLoading, setFolderLoading] = useState(entityType === 'products');
  const [folderError, setFolderError] = useState('');
  const [changingFolder, setChangingFolder] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const createFolderId = activeFolder === 'all' || activeFolder === 'unfiled' ? null : activeFolder;

  const {
    entities,
    isLoading,
    isCreating,
    hasFetched,
    error,
    fetchEntities,
    editingEntity,
    deleteEntityId,
    handleCreate,
    handleBulkCreate,
    handleSaveEdit,
    handleDelete,
    confirmDelete,
    cancelDelete,
    setEditingEntity,
  } = useEntityManagement({ entityType, folderId: createFolderId });

  const reloadFolders = useCallback(async (): Promise<void> => {
    if (entityType !== 'products') return;
    setFolderLoading(true);
    setFolderError('');
    try {
      setFolders(await window.api.productFolders.list());
    } catch {
      setFolderError('Could not load product folders. Retry before making changes.');
    } finally {
      setFolderLoading(false);
    }
  }, [entityType]);
  useEffect(() => {
    void reloadFolders();
  }, [reloadFolders]);

  const isProducts = entityType === 'products';
  const unavailableFolder =
    isProducts &&
    createFolderId !== null &&
    !folderLoading &&
    !folders.some((folder) => folder.id === createFolderId);
  const busy = isCreating || isLoading || changingFolder || folderLoading;
  const controlsDisabled = busy || !!error || !!folderError;
  const visibleEntities =
    !isProducts || activeFolder === 'all'
      ? entities
      : entities.filter((entity) =>
          activeFolder === 'unfiled' ? !entity.folderId : entity.folderId === activeFolder,
        );
  const visibleIds = new Set(visibleEntities.map((entity) => entity.id));
  const selectedVisibleIds = selectedIds.filter((id) => visibleIds.has(id));
  const selectedSet = new Set(selectedVisibleIds);
  const counts: Record<string, number> = { all: entities.length, unfiled: 0 };
  for (const entity of entities) {
    const key = entity.folderId ?? 'unfiled';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  function toggleSelected(id: string): void {
    setSelectedIds((previous) => {
      const current = previous.filter((value) => visibleIds.has(value));
      if (current.includes(id)) return current.filter((value) => value !== id);
      return current.length < MAX_PRODUCT_FOLDER_MOVE ? [...current, id] : current;
    });
  }

  async function saveFolder(name: string, id?: string): Promise<void> {
    setChangingFolder(true);
    try {
      const folder = id
        ? await window.api.productFolders.rename(id, name)
        : await window.api.productFolders.create(name);
      setFolders((previous) =>
        [...previous.filter((item) => item.id !== folder.id), folder].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setActiveFolder(folder.id);
      setSelectedIds([]);
    } finally {
      setChangingFolder(false);
    }
  }

  async function moveSelected(folderId: string | null): Promise<void> {
    if (controlsDisabled || !selectedVisibleIds.length) return;
    setChangingFolder(true);
    try {
      await window.api.productFolders.move(selectedVisibleIds, folderId);
      await fetchEntities();
      setSelectedIds([]);
      toast.success(
        `Moved ${selectedVisibleIds.length} product${selectedVisibleIds.length === 1 ? '' : 's'}.`,
      );
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : 'Could not move products. Retry without changing your selection.';
      setFolderError(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
    } finally {
      setChangingFolder(false);
    }
  }

  const handleFilesSelected = (files: File[]) => {
    setUploadedFiles(files);
    setIsUploadModalOpen(false);
    setIsReviewModalOpen(true);
  };

  const handleSave = async (name: string, images: UploadedImage[], productType?: string) => {
    try {
      await handleCreate(name, images, productType);
      setIsReviewModalOpen(false);
      setUploadedFiles([]);
    } catch {
      // Error already handled in hook
    }
  };

  const handleReviewModalClose = () => {
    setIsReviewModalOpen(false);
    setUploadedFiles([]);
    setEditingEntity(null);
  };

  const handleEditEntity = (entity: EntityData) => {
    setEditingEntity(entity);
    setIsReviewModalOpen(true);
  };

  const handleSaveEditWrapper = async (
    id: string,
    name: string,
    images: UploadedImage[],
    productType?: string,
  ) => {
    try {
      await handleSaveEdit(id, name, images, productType);
      setIsReviewModalOpen(false);
    } catch {
      // Error already handled in hook
    }
  };

  const handleGenerateWithEntity = (_entityId: string) => {
    onNavigate('image');
  };

  /**
   * Bulk upload makes one entity per file, named from the filename, so a whole
   * folder of product photos becomes a whole catalogue in one step.
   */
  const handleBulkFilesSelected = async (files: File[]) => {
    if (!files.length) return;
    const label = entityType === 'products' ? 'product' : 'character';

    // Anything past the cap is ignored, so say so rather than silently
    // dropping files the user picked.
    const skipped = Math.max(0, files.length - MAX_BULK_ITEMS);
    if (skipped > 0) {
      toast.warning(
        `Only the first ${MAX_BULK_ITEMS} photos will be used; ${skipped} were skipped.`,
      );
    }

    const toastId = toast.loading(`Creating ${files.length - skipped} ${label}s…`);
    try {
      const { created, failed } = await handleBulkCreate(files);
      if (created > 0) {
        toast.success(
          failed > 0
            ? `Created ${created} ${label}s. ${failed} couldn't be saved.`
            : `Created ${created} ${label}s.`,
          { id: toastId },
        );
      } else {
        toast.error(`Couldn't create any ${label}s. Please try again.`, { id: toastId });
      }
    } catch {
      toast.error(`Couldn't create those ${label}s. Please try again.`, { id: toastId });
    }
  };

  return (
    <>
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onFilesSelected={handleFilesSelected}
        entityType={entityType}
      />
      <UploadReviewModal
        isOpen={isReviewModalOpen}
        onClose={handleReviewModalClose}
        initialFiles={uploadedFiles}
        entityType={entityType}
        onGenerate={handleSave}
        editEntity={editingEntity}
        onSaveEdit={handleSaveEditWrapper}
        isLoading={isCreating}
      />
      <DeleteConfirmationModal
        isOpen={!!deleteEntityId}
        title={deleteTitle}
        message={deleteMessage}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />

      <main
        className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-y-auto px-6"
        style={{ justifyContent: 'safe center' }}
      >
        {/* Title Section */}
        <div className="text-center">
          <h1
            className="text-3xl font-bold tracking-tight text-[var(--base-color-brand--bean)] sm:text-4xl"
            style={{ fontFamily: 'var(--text-color--font-family--heading)' }}
          >
            {title}
          </h1>
          <p className="mt-2 text-sm text-[var(--base-color-brand--umber)]">{subtitle}</p>
        </div>

        {isProducts && (
          <ProductPairReview
            products={visibleEntities}
            disabled={controlsDisabled || isUploadModalOpen || isReviewModalOpen}
            reload={fetchEntities}
          />
        )}
        {isProducts && (
          <ProductFolderToolbar
            folders={folders}
            activeFolder={activeFolder}
            counts={counts}
            selectedCount={selectedVisibleIds.length}
            visibleCount={visibleEntities.length}
            disabled={controlsDisabled || isUploadModalOpen || isReviewModalOpen}
            onSelectFolder={(id) => {
              setActiveFolder(id);
              setSelectedIds([]);
            }}
            onSelectAll={() =>
              setSelectedIds(
                visibleEntities.slice(0, MAX_PRODUCT_FOLDER_MOVE).map((entity) => entity.id),
              )
            }
            onClearSelection={() => setSelectedIds([])}
            onSaveFolder={saveFolder}
            onMove={moveSelected}
          />
        )}
        {(error || folderError) && (
          <div
            role="alert"
            className="flex max-w-4xl flex-wrap items-center gap-3 text-sm text-[var(--base-color-brand--bean)]"
          >
            <span>{error || folderError}</span>
            <button
              type="button"
              className="btn-cinamon"
              disabled={busy}
              onClick={() => {
                void fetchEntities();
                void reloadFolders();
              }}
            >
              Retry loading
            </button>
          </div>
        )}
        {unavailableFolder && !folderError && (
          <p role="alert" className="text-sm">
            This folder is unavailable. Choose another folder before creating products.
          </p>
        )}

        {/* CTA Buttons */}
        <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => setIsUploadModalOpen(true)}
            disabled={controlsDisabled || unavailableFolder}
            className="btn-cinamon"
          >
            <SparkleIcon className="size-5" />
            {isCreating ? 'Creating...' : createLabel}
          </button>

          <label
            className={`flex h-11 items-center gap-2 rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] px-5 text-sm font-semibold text-[var(--base-color-brand--bean)] transition-colors ${
              controlsDisabled || unavailableFolder
                ? 'pointer-events-none opacity-50'
                : 'cursor-pointer hover:text-[var(--base-color-brand--cinamon)]'
            }`}
            title={`Create one ${entityType === 'products' ? 'product' : 'character'} per photo, named from the filename`}
          >
            <UploadIcon className="size-4" />
            Bulk upload
            <input
              type="file"
              accept={SUPPORTED_IMAGE_ACCEPT}
              multiple
              className="hidden"
              disabled={controlsDisabled || unavailableFolder}
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void handleBulkFilesSelected(Array.from(files));
                // Allow re-selecting the same folder after a run.
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {/* Content Grid */}
        <div className="relative grid w-full [&>*]:col-start-1 [&>*]:row-start-1">
          {/* Saved Entities */}
          <div
            className={`flex w-full flex-wrap justify-center gap-4 transition-opacity duration-200 ${
              visibleEntities.length > 0 ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            {visibleEntities.map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                onGenerate={handleGenerateWithEntity}
                onEdit={handleEditEntity}
                onDelete={handleDelete}
                selection={
                  isProducts
                    ? {
                        checked: selectedSet.has(entity.id),
                        disabled:
                          controlsDisabled ||
                          (selectedVisibleIds.length >= MAX_PRODUCT_FOLDER_MOVE &&
                            !selectedSet.has(entity.id)),
                        onToggle: toggleSelected,
                      }
                    : undefined
                }
              />
            ))}
          </div>

          {/* Empty State */}
          {hasFetched &&
            !isLoading &&
            !error &&
            !folderError &&
            !unavailableFolder &&
            visibleEntities.length === 0 && (
              <div className="flex w-full justify-center">
                <p className="text-sm text-[var(--base-color-brand--umber)]">
                  {isProducts && activeFolder !== 'all'
                    ? 'No products in this folder. Create products here or move them from another folder.'
                    : `No ${entityType} yet. Create one to get started.`}
                </p>
              </div>
            )}
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center gap-3">
            <div className="size-6 animate-spin rounded-full border-2 border-[var(--base-color-brand--umber)]/30 border-t-[var(--base-color-brand--bean)]" />
            <span className="text-sm text-[var(--base-color-brand--umber)]">Loading...</span>
          </div>
        )}
      </main>
    </>
  );
}
