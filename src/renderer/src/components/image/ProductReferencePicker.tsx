import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, ChevronDownIcon } from '@/components/icons';
import { isProductBatch, SELECTED_GROUPS_VALUE } from '@/lib/productFolderTargets';

interface ProductReferencePickerProps {
  options: { value: string; label: string; disabled?: boolean }[];
  value: string;
  selectedProducts: readonly string[];
  selectedGroups: readonly string[];
  manualGroups: readonly string[];
  onAddGroup: () => void;
  onRemoveGroup: (index: number) => void;
  onScopeChange: (value: string) => void;
  onToggleProduct: (value: string) => void;
  onToggleGroup: (value: string) => void;
}

export function ProductReferencePicker({
  options,
  value,
  selectedProducts,
  selectedGroups,
  manualGroups,
  onAddGroup,
  onRemoveGroup,
  onScopeChange,
  onToggleProduct,
  onToggleGroup,
}: ProductReferencePickerProps): ReactElement {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [position, setPosition] = useState<{
    left: number;
    bottom: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const groupCount = selectedGroups.length + manualGroups.length;
  const label =
    value === SELECTED_GROUPS_VALUE
      ? `${groupCount} selected product ${groupCount === 1 ? 'group' : 'groups'}`
      : selectedProducts.length > 1
        ? `${selectedProducts.length} reference entries · one product`
        : (options.find((option) => option.value === value)?.label ?? 'Default');
  function close(restoreFocus = false): void {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  }
  function open(): void {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, window.innerWidth - 32);
    setPosition({
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      bottom: window.innerHeight - rect.top + 8,
      width,
      maxHeight: Math.max(80, Math.min(360, rect.top - 24)),
    });
  }
  useEffect(() => {
    if (!position) return;
    const selected = panel.current?.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="true"]',
    );
    (selected ?? panel.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
    function outside(event: Event): void {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setPosition(null);
    }
    function resize(): void {
      setPosition(null);
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('resize', resize);
    };
  }, [position]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={!!position}
        aria-controls={position ? listId : undefined}
        onClick={() => (position ? close() : open())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open();
          }
        }}
        className="flex h-10 max-w-full min-w-0 items-center gap-2 rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] px-4 text-[11px] text-[var(--text-color--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="truncate">{label}</span>
        <span aria-hidden="true" className="shrink-0">
          <ChevronDownIcon />
        </span>
      </button>
      {position &&
        createPortal(
          <div
            ref={panel}
            className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-[var(--base-color-brand--umber)]/40 bg-[var(--base-color-brand--champagne)] p-2 text-[var(--text-color--text-primary)] shadow-lg"
            style={position}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
                return;
              }
              const items = [
                ...(panel.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []),
              ];
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }}
          >
            <p id={`${listId}-help`} className="px-2 pb-2 text-xs">
              Pick a folder to make one image per product in it. Or tick saved groups, or tick
              entries and choose Add as batch group. A composition allows up to 7 photos per group.
            </p>
            <div
              id={listId}
              role="listbox"
              aria-label="Products and reference entries"
              aria-multiselectable="true"
              aria-describedby={`${listId}-help`}
              className="min-h-0 overflow-y-auto"
            >
              {manualGroups.map((name, index) => (
                <button
                  key={`manual:${index}`}
                  type="button"
                  role="option"
                  aria-selected="true"
                  tabIndex={-1}
                  onClick={() => onRemoveGroup(index)}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-[var(--base-color-brand--shell)] focus-visible:outline-2"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-5 shrink-0 place-items-center rounded border border-[var(--base-color-brand--umber)]"
                  >
                    <CheckIcon />
                  </span>
                  <span className="min-w-0 break-words">Group: {name} (remove)</span>
                </button>
              ))}
              {options.map((option) => {
                if (option.disabled)
                  return (
                    <div
                      key={option.value}
                      role="presentation"
                      className="px-2 py-2 text-xs font-semibold"
                    >
                      {option.label}
                    </div>
                  );
                const product =
                  option.value.startsWith('product:') && !isProductBatch(option.value);
                const group =
                  option.value.startsWith('group:') && option.value !== SELECTED_GROUPS_VALUE;
                const checked = product
                  ? selectedProducts.includes(option.value)
                  : group
                    ? value === SELECTED_GROUPS_VALUE &&
                      selectedGroups.includes(option.value.slice('group:'.length))
                    : value === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    tabIndex={-1}
                    onClick={() => {
                      if (product) onToggleProduct(option.value);
                      else if (group) onToggleGroup(option.value);
                      else {
                        onScopeChange(option.value);
                        close(true);
                      }
                    }}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-[var(--base-color-brand--shell)] focus-visible:bg-[var(--base-color-brand--shell)] focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                  >
                    <span
                      aria-hidden="true"
                      className={`grid size-5 shrink-0 place-items-center ${product || group ? 'rounded border border-[var(--base-color-brand--umber)]' : ''}`}
                    >
                      {checked && <CheckIcon />}
                    </span>
                    <span className="min-w-0 break-words">{option.label}</span>
                  </button>
                );
              })}
            </div>
            {selectedProducts.length > 0 && (
              <button
                type="button"
                onClick={onAddGroup}
                className="mt-2 min-h-10 shrink-0 rounded-full border border-[var(--base-color-brand--umber)] bg-[var(--base-color-brand--shell)] px-4 text-sm font-semibold focus-visible:outline-2"
              >
                Add {selectedProducts.length} {selectedProducts.length === 1 ? 'entry' : 'entries'}{' '}
                as batch group
              </button>
            )}
            <button
              type="button"
              onClick={() => close(true)}
              className="mt-2 min-h-10 shrink-0 rounded-full border border-[var(--base-color-brand--umber)]/50 bg-[var(--base-color-brand--shell)] px-4 text-sm font-semibold focus-visible:outline-2"
            >
              Done
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
