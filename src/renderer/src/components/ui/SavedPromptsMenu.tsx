import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { cleanIpcError } from '@/lib/ipcError';
import type { SavedPromptData } from '@/types/electron';

/**
 * Save the current prompt and load one back.
 *
 * Saved prompts are reusable wording — pair one with "All products" to run the
 * identical prompt across a whole catalogue.
 */
export default function SavedPromptsMenu({
  currentPrompt,
  onUsePrompt,
}: {
  currentPrompt: string;
  onUsePrompt: (prompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedPromptData[]>([]);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setSaved(await window.api.savedPrompts.list());
    } catch {
      // A missing list is not worth interrupting the user over.
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Close when clicking outside, so the menu doesn't cover the form.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const handleSave = async () => {
    const prompt = currentPrompt.trim();
    if (!prompt) {
      toast.error('Type a prompt before saving it.');
      return;
    }

    // First line, trimmed, makes a reasonable default name.
    const suggested = prompt.split('\n')[0]?.slice(0, 60) ?? 'Saved prompt';
    const title = window.prompt('Name this prompt', suggested)?.trim();
    if (!title) return;

    setBusy(true);
    try {
      await window.api.savedPrompts.create({ title, prompt });
      await refresh();
      toast.success('Prompt saved.');
    } catch (err) {
      toast.error(cleanIpcError(err, "Couldn't save that prompt."));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await window.api.savedPrompts.delete(id);
      await refresh();
    } catch (err) {
      toast.error(cleanIpcError(err, "Couldn't delete that prompt."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        title="Save this prompt, or load one you saved earlier"
        className="flex h-10 shrink-0 items-center rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] px-3 text-[11px] font-semibold whitespace-nowrap text-[var(--base-color-brand--bean)] transition-colors hover:text-[var(--base-color-brand--cinamon)]"
      >
        Prompts
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 max-h-80 w-80 overflow-y-auto rounded-2xl border border-[var(--base-color-brand--umber)]/30 bg-[var(--base-color-brand--champagne)] p-2 shadow-xl">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="w-full rounded-xl bg-[var(--base-color-brand--bean)] px-3 py-2 text-sm font-semibold text-[var(--base-color-brand--champagne)] disabled:opacity-50"
          >
            Save current prompt
          </button>

          {saved.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-[var(--base-color-brand--umber)]">
              Nothing saved yet. Save a prompt to reuse it across products.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {saved.map((item) => (
                <li key={item.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onUsePrompt(item.prompt);
                      setOpen(false);
                    }}
                    title={item.prompt}
                    className="min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm text-[var(--base-color-brand--bean)] hover:bg-[var(--base-color-brand--shell)]"
                  >
                    {item.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    disabled={busy}
                    aria-label={`Delete ${item.title}`}
                    className="shrink-0 rounded-lg px-2 py-2 text-xs text-[var(--base-color-brand--umber)] hover:text-[var(--base-color-brand--bean)] disabled:opacity-50"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
