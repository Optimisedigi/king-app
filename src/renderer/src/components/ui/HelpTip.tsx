import { useId, useState } from 'react';

/**
 * A small "?" marker that explains a control.
 *
 * Shown on hover and on keyboard focus, so the guidance is reachable without a
 * mouse. The text is also attached via `aria-describedby` for screen readers.
 */
export default function HelpTip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label ?? 'What is this?'}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // Tapping toggles it, so this works on a touchscreen too.
        onClick={(e) => {
          e.preventDefault();
          setOpen((prev) => !prev);
        }}
        className="grid size-4 shrink-0 place-items-center rounded-full border border-[var(--base-color-brand--umber)]/50 text-[10px] leading-none font-bold text-[var(--base-color-brand--umber)] transition-colors hover:border-[var(--base-color-brand--bean)] hover:text-[var(--base-color-brand--bean)]"
      >
        ?
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-xl border border-[var(--base-color-brand--umber)]/30 bg-[var(--base-color-brand--bean)] px-3 py-2 text-xs leading-snug font-normal text-[var(--base-color-brand--champagne)] shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
