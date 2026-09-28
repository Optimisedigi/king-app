import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ChevronDownIcon } from '@/components/icons';
import { MAX_PRODUCT_FOLDER_MOVE, type ProductFolder } from '../../../../shared/productFolders';

const buttonClass =
  'min-h-11 rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] px-4 text-sm font-semibold text-[var(--base-color-brand--bean)] transition-colors hover:bg-[var(--base-color-brand--champagne)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const selectClass =
  'h-11 w-full min-w-0 appearance-none rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] pr-10 pl-4 text-sm text-[var(--base-color-brand--bean)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';

interface ProductFolderToolbarProps {
  folders: ProductFolder[];
  activeFolder: string;
  counts: Readonly<Record<string, number>>;
  selectedCount: number;
  visibleCount: number;
  disabled: boolean;
  onSelectFolder: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onSaveFolder: (name: string, id?: string) => Promise<void>;
  onMove: (folderId: string | null) => Promise<void>;
}

function FolderNameDialog({
  folder,
  onSave,
  onClose,
}: {
  folder?: ProductFolder;
  onSave: (name: string, id?: string) => Promise<void>;
  onClose: () => void;
}): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(folder?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      opener?.focus();
    };
  }, []);
  async function save(): Promise<void> {
    if (saving || !name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSave(name.trim(), folder?.id);
      onClose();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Could not save this folder. Try again.';
      setError(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="product-folder-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      className="fixed inset-0 m-auto w-[min(28rem,calc(100vw-2rem))] rounded-3xl border border-[var(--base-color-brand--umber)]/40 bg-[var(--base-color-brand--shell)] p-6 text-[var(--base-color-brand--bean)] shadow-2xl backdrop:bg-black/50"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id="product-folder-dialog-title" className="mb-4 text-xl font-semibold">
          {folder ? 'Rename folder' : 'New product folder'}
        </h2>
        <label className="block text-sm font-semibold">
          Folder name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-[var(--base-color-brand--umber)] bg-transparent px-3 focus-visible:outline-2"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={saving} className={buttonClass} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-cinamon" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save folder'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function ProductFolderToolbar({
  folders,
  activeFolder,
  counts,
  selectedCount,
  visibleCount,
  disabled,
  onSelectFolder,
  onSelectAll,
  onClearSelection,
  onSaveFolder,
  onMove,
}: ProductFolderToolbarProps): ReactElement {
  const [editing, setEditing] = useState<{ folder?: ProductFolder } | null>(null);
  const [destination, setDestination] = useState('');
  const active = folders.find((folder) => folder.id === activeFolder);
  const destinationExists =
    destination === 'unfiled' || folders.some((folder) => folder.id === destination);
  return (
    <section aria-label="Product folders" className="w-full max-w-4xl space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-64 text-sm font-semibold text-[var(--base-color-brand--bean)]">
          Folder
          <span className="relative mt-1 block">
            <select
              aria-label="Product folder"
              className={selectClass}
              value={activeFolder}
              disabled={disabled}
              onChange={(event) => onSelectFolder(event.target.value)}
            >
              <option value="all">All entries ({counts.all ?? 0})</option>
              <option value="unfiled">Unfiled ({counts.unfiled ?? 0})</option>
              {activeFolder !== 'all' && activeFolder !== 'unfiled' && !active && (
                <option value={activeFolder}>Folder unavailable</option>
              )}
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name} ({counts[folder.id] ?? 0})
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2"
            >
              <ChevronDownIcon />
            </span>
          </span>
        </label>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled}
          onClick={() => setEditing({})}
        >
          New folder
        </button>
        {active && (
          <button
            type="button"
            className={buttonClass}
            disabled={disabled}
            onClick={() => setEditing({ folder: active })}
          >
            Rename folder
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || !visibleCount}
          onClick={onSelectAll}
        >
          {visibleCount > MAX_PRODUCT_FOLDER_MOVE
            ? `Select first ${MAX_PRODUCT_FOLDER_MOVE.toLocaleString('en-US')}`
            : 'Select all shown'}
        </button>
        {selectedCount > 0 && (
          <>
            <span role="status" className="text-sm">
              {selectedCount} selected
            </span>
            <button
              type="button"
              className={buttonClass}
              disabled={disabled}
              onClick={onClearSelection}
            >
              Clear selection
            </button>
            <label className="relative min-w-0 flex-1 basis-48">
              <span className="sr-only">Move products to</span>
              <select
                className={selectClass}
                value={destination}
                disabled={disabled}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="">Choose destination</option>
                <option value="unfiled">Unfiled</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2"
              >
                <ChevronDownIcon />
              </span>
            </label>
            <button
              type="button"
              className={buttonClass}
              disabled={disabled || !destinationExists}
              onClick={() => {
                void onMove(destination === 'unfiled' ? null : destination);
              }}
            >
              Move selected
            </button>
          </>
        )}
      </div>
      {visibleCount > MAX_PRODUCT_FOLDER_MOVE && (
        <p className="text-sm">
          Up to {MAX_PRODUCT_FOLDER_MOVE.toLocaleString('en-US')} products per move. Move this
          group, then select the remaining products.
        </p>
      )}
      {editing && (
        <FolderNameDialog
          folder={editing.folder}
          onSave={onSaveFolder}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
