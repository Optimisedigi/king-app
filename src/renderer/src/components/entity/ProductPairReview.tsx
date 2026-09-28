import { useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import type { EntityData } from '@/types/electron';
import { suggestProductPairs } from '@/lib/productPairs';
import { MAX_REFERENCE_IMAGES } from '@/lib/constants/image-form';

interface Props {
  products: readonly EntityData[];
  disabled: boolean;
  reload: () => Promise<void>;
}

export function ProductPairReview({ products, disabled, reload }: Props): ReactElement {
  const [open, setOpen] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const suggestions = suggestProductPairs(products);
  const linked = products.filter((product) => product.pairedWith);
  const byId = new Map(products.map((product) => [product.id, product]));
  const oversized = new Set(
    suggestions
      .filter((pair) => {
        const primary = byId.get(pair.primaryId);
        const secondary = byId.get(pair.secondaryId);
        return (
          primary &&
          secondary &&
          new Set([...primary.referenceImages, ...secondary.referenceImages]).size >
            MAX_REFERENCE_IMAGES
        );
      })
      .map((pair) => pair.secondaryId),
  );
  const chosen = suggestions.filter(
    (pair) => !excluded.includes(pair.secondaryId) && !oversized.has(pair.secondaryId),
  );

  async function approve(): Promise<void> {
    if (!chosen.length || working) return;
    setWorking(true);
    try {
      await window.api.productPairs.link(chosen);
      await reload();
      setOpen(false);
      setExcluded([]);
      toast.success(
        `Linked ${chosen.length} product pair${chosen.length === 1 ? '' : 's'}. No images were regenerated.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not link these products. Retry after refreshing.',
      );
      await reload();
    } finally {
      setWorking(false);
    }
  }

  async function unlink(id: string): Promise<void> {
    if (working) return;
    setWorking(true);
    try {
      await window.api.productPairs.unlink(id);
      await reload();
      toast.success('Product views unlinked. Photos were not deleted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not unlink these views. Retry.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="w-full max-w-4xl rounded-2xl border border-[var(--base-color-brand--umber)]/40 p-4 text-sm text-[var(--base-color-brand--bean)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          {linked.length} linked pairs · {suggestions.length} suggested pairs
        </p>
        <button
          type="button"
          className="btn-cinamon"
          disabled={disabled || working || (!suggestions.length && !linked.length)}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? 'Close pair review' : 'Review product pairs'}
        </button>
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          <p>
            Suggestions use exact names ending in “ 2” within the same folder. Check the photos
            before approving. Entries and existing generated images remain unchanged.
          </p>
          {suggestions.map((pair) => {
            const primary = byId.get(pair.primaryId);
            const secondary = byId.get(pair.secondaryId);
            if (!primary || !secondary) return null;
            return (
              <label
                key={pair.secondaryId}
                className="flex min-h-16 items-center gap-3 rounded-lg border border-[var(--base-color-brand--umber)]/30 p-2"
              >
                <input
                  type="checkbox"
                  checked={!excluded.includes(pair.secondaryId) && !oversized.has(pair.secondaryId)}
                  disabled={disabled || working || oversized.has(pair.secondaryId)}
                  onChange={(event) =>
                    setExcluded((previous) =>
                      event.target.checked
                        ? previous.filter((id) => id !== pair.secondaryId)
                        : [...previous, pair.secondaryId],
                    )
                  }
                />
                <img
                  src={primary.thumbnailUrl ?? primary.referenceImages[0]}
                  alt={`First reference for ${primary.name}`}
                  loading="lazy"
                  className="size-16 shrink-0 rounded bg-[var(--base-color-brand--shell)] object-contain"
                />
                <img
                  src={secondary.thumbnailUrl ?? secondary.referenceImages[0]}
                  alt={`Second reference for ${secondary.name}`}
                  loading="lazy"
                  className="size-16 shrink-0 rounded bg-[var(--base-color-brand--shell)] object-contain"
                />
                <span className="min-w-0 break-words">
                  {primary.name} + {secondary.name} ({primary.referenceImages.length} +{' '}
                  {secondary.referenceImages.length} photos)
                  {oversized.has(pair.secondaryId) && (
                    <span className="block">
                      More than {MAX_REFERENCE_IMAGES} distinct photos. Remove some before pairing.
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          {suggestions.length > 0 && (
            <button
              type="button"
              className="btn-cinamon"
              disabled={disabled || working || !chosen.length}
              onClick={() => void approve()}
            >
              {working
                ? 'Saving…'
                : `Approve ${chosen.length} selected pair${chosen.length === 1 ? '' : 's'}`}
            </button>
          )}
          {linked.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-semibold">Linked product views</h2>
              {linked.map((secondary) => (
                <div
                  key={secondary.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--base-color-brand--umber)]/30 p-2"
                >
                  <span>
                    {byId.get(secondary.pairedWith ?? '')?.name ??
                      'Primary product in another folder'}{' '}
                    + {secondary.name}
                  </span>
                  <button
                    type="button"
                    className="btn-cinamon"
                    aria-label={`Unlink ${byId.get(secondary.pairedWith ?? '')?.name ?? 'product'} and ${secondary.name}`}
                    disabled={disabled || working}
                    onClick={() => void unlink(secondary.id)}
                  >
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
