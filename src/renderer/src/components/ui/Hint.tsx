import { useState, type ReactElement, type ReactNode } from 'react';

/** A wrapped control whose menu is open; its hint would cover the menu. */
function hasOpenMenu(wrapper: Element): boolean {
  return wrapper.querySelector('[aria-expanded="true"]') !== null;
}

/**
 * A short label that appears above a control on hover or keyboard focus,
 * e.g. "Image count". Replaces separate "?" markers and slow native tooltips.
 *
 * Purely visual: every wrapped control already has a visible or accessible
 * name, so screen readers are not given the label a second time. It stays
 * hidden while the control's own menu is open, so it never covers options.
 */
export function Hint({ text, children }: { text: string; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex max-w-full min-w-0"
      onMouseEnter={(event) => {
        if (!hasOpenMenu(event.currentTarget)) setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
      onFocus={(event) => {
        // Keyboard focus on the control itself shows it; focus moving into an
        // open menu, or focus from a click, does not.
        if (event.target.matches(':focus-visible') && !hasOpenMenu(event.currentTarget))
          setOpen(true);
      }}
      onBlur={() => setOpen(false)}
      // Opening a menu by click or keyboard hides the label.
      onMouseDown={() => setOpen(false)}
      onKeyDown={(event) => {
        if (['Escape', 'Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) setOpen(false);
      }}
    >
      {children}
      {open && (
        <span
          aria-hidden="true"
          data-hint
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-56 -translate-x-1/2 rounded-lg bg-[var(--base-color-brand--bean)] px-2.5 py-1.5 text-center text-xs leading-snug font-normal text-[var(--base-color-brand--champagne)] shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
