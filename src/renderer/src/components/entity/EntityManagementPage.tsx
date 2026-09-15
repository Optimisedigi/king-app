import { useState } from 'react';
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

  const {
    entities,
    isLoading,
    isCreating,
    hasFetched,
    editingEntity,
    deleteEntityId,
    handleCreate,
    handleBulkCreate,
    handleSaveEdit,
    handleDelete,
    confirmDelete,
    cancelDelete,
    setEditingEntity,
  } = useEntityManagement({ entityType });

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

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
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

        {/* CTA Buttons */}
        <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => setIsUploadModalOpen(true)}
            disabled={isCreating}
            className="btn-cinamon"
          >
            <SparkleIcon className="size-5" />
            {isCreating ? 'Creating...' : createLabel}
          </button>

          <label
            className={`flex h-11 items-center gap-2 rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] px-5 text-sm font-semibold text-[var(--base-color-brand--bean)] transition-colors ${
              isCreating
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
              disabled={isCreating}
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
              entities.length > 0 ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            {entities.map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                onGenerate={handleGenerateWithEntity}
                onEdit={handleEditEntity}
                onDelete={handleDelete}
              />
            ))}
          </div>

          {/* Empty State */}
          <div
            className={`flex w-full justify-center transition-opacity duration-200 ${
              hasFetched && !isLoading && entities.length === 0
                ? 'opacity-100'
                : 'pointer-events-none opacity-0'
            }`}
          >
            <p className="text-sm text-[var(--base-color-brand--umber)]">
              No {entityType} yet. Create one to get started.
            </p>
          </div>
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
