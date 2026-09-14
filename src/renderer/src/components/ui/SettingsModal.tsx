import { useEffect, useState } from 'react';
import type { UpdaterStatus } from '@/types/electron';
import { CloseIcon, DownloadIcon, RefreshIcon } from '@/components/icons';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { useModelStore, type ImageModel } from '@/stores/modelStore';

const MODEL_OPTIONS: { value: ImageModel; label: string }[] = [
  { value: 'nano_banana_pro', label: 'Nano Banana Pro' },
  { value: 'gpt_image_2', label: 'GPT Image 2' },
  { value: 'gpt_image_25_flare', label: 'GPT Image 2.5 Flare' },
  { value: 'gpt_image_25_sunburst', label: 'GPT Image 2.5 Sunburst' },
];

/** Short explanations of the controls that aren't self-evident. */
const HOW_TO_ENTRIES = [
  {
    title: 'Reference photos',
    body: 'Upload up to 8 photos of the real product. The model copies what it sees, so a clean, well-lit photo matters more than a long prompt. Oversized photos are shrunk automatically.',
  },
  {
    title: 'Products',
    body: 'Save a product once with its photos, then pick it from the dropdown to reuse them. Choose "All products" to run the same prompt across your whole catalogue in one go.',
  },
  {
    title: 'Prompts',
    body: 'Save wording that works, then load it back later. A saved prompt plus "All products" gives every product identical treatment.',
  },
  {
    title: 'Angle set',
    body: 'Turns one product photo into matching shots from different camera positions. The close-up is cropped out of the 45\u00b0 shot, so the product is pixel-identical rather than redrawn.',
  },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Formats a byte/sec number into a human-readable download speed.
 */
function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '';
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

/**
 * Sanitise release-notes HTML returned by electron-updater's GitHub
 * provider so it can be rendered as actual formatted markup (paragraphs,
 * lists, links, bold) instead of literal `<p>` text.
 *
 * Strategy: allowlist a small set of safe block + inline tags, strip
 * everything else (including all attributes except `href` on `<a>`),
 * and force every link to open externally. Defends against XSS by
 * never letting `<script>`, `<iframe>`, event handlers, or `javascript:`
 * URLs through. Anything not on the allowlist is removed but its inner
 * text is kept, so unknown markup still reads as plain prose.
 */
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'blockquote',
]);

function sanitizeReleaseNotes(html: string): string {
  // DOMParser is available in Electron's renderer (Chromium). Parsing
  // through it gives us a real DOM tree instead of regex-mangling tags.
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const walk = (node: Node): void => {
    // Iterate over a snapshot of childNodes since we mutate during walk.
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        const tag = el.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          // Replace the disallowed element with its children (keep text).
          while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
          el.remove();
          continue;
        }
        // Strip every attribute, then re-add only safe ones.
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) el.removeAttribute(attr.name);
        if (tag === 'a') {
          const href = attrs.find((a) => a.name.toLowerCase() === 'href')?.value ?? '';
          if (/^https?:\/\//i.test(href)) {
            el.setAttribute('href', href);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
        }
        walk(el);
      }
    }
  };

  walk(doc.body);
  return doc.body.innerHTML;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [status, setStatus] = useState<UpdaterStatus>({
    stage: 'idle',
    currentVersion: '…',
  });
  const selectedModel = useModelStore((s) => s.selectedModel);
  const setSelectedModel = useModelStore((s) => s.setSelectedModel);
  // Subscribe to updater status broadcasts for as long as the modal is mounted
  // on the DOM (we keep it mounted for the open/close transition).
  useEffect(() => {
    let cancelled = false;

    void window.api.update.getStatus().then((initial) => {
      if (!cancelled) setStatus(initial);
    });

    const unsubscribe = window.api.update.onStatus((next) => {
      setStatus(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleCheck = () => {
    void window.api.update.check();
  };

  const handleDownload = () => {
    void window.api.update.download();
  };

  const handleInstall = () => {
    void window.api.update.install();
  };

  const isChecking = status.stage === 'checking';
  const isDownloading = status.stage === 'downloading';
  const isDownloaded = status.stage === 'downloaded';
  const isAvailable = status.stage === 'available';
  const isUpToDate = status.stage === 'not-available';
  const isError = status.stage === 'error';

  // Headline describing current update state.
  let headline: string;
  if (isChecking) headline = 'Checking for updates…';
  else if (isAvailable) headline = `Update available — v${status.updateVersion}`;
  else if (isDownloading) headline = `Downloading v${status.updateVersion ?? ''}`;
  else if (isDownloaded) headline = `Update ready — v${status.updateVersion}`;
  else if (isUpToDate) headline = 'You’re on the latest version';
  else if (isError) headline = 'Update check failed';
  else headline = 'Check for the latest release';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${
        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      style={{ willChange: 'opacity' }}
    >
      <div
        className={`absolute inset-0 bg-[var(--base-color-brand--bean)]/60 backdrop-blur-sm transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`relative z-10 w-full max-w-md rounded-3xl border border-[var(--base-color-brand--umber)]/40 bg-[var(--base-color-brand--shell)] p-6 shadow-2xl transition-all duration-200 ${
          isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        style={{ willChange: 'transform, opacity' }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3
              className="text-lg font-semibold text-[var(--base-color-brand--bean)]"
              style={{ fontFamily: 'var(--text-color--font-family--heading)' }}
            >
              Settings
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-full border border-[var(--base-color-brand--umber)]/40 bg-[var(--base-color-brand--shell)] p-1.5 text-[var(--base-color-brand--bean)] transition-colors hover:bg-[var(--base-color-brand--champagne)]"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Image model — applies to generations started from the Image page.
            Clone and Create Ads still run on GPT Image 2. */}
        <section className="mt-6 rounded-2xl border border-[var(--base-color-brand--umber)]/30 bg-[var(--base-color-brand--champagne)]/60 px-4 py-3">
          <p
            className="text-sm font-semibold text-[var(--base-color-brand--bean)]"
            style={{ fontFamily: 'var(--text-color--font-family--heading)' }}
          >
            Image model
          </p>
          <div className="mt-2">
            <SelectDropdown
              options={MODEL_OPTIONS}
              value={selectedModel}
              onChange={(v) => setSelectedModel(v as ImageModel)}
              fullWidth
            />
          </div>
          <p className="mt-2 text-xs leading-snug text-[var(--base-color-brand--umber)]">
            Flare is the faster, cheaper choice for everyday shots. Sunburst is slower but holds a
            product&apos;s shape and label steadier — use it for angle sets and campaign images.
          </p>
        </section>

        {/* How-to guide, so the less obvious controls are explained in-app. */}
        <section className="mt-4 rounded-2xl border border-[var(--base-color-brand--umber)]/30 bg-[var(--base-color-brand--champagne)]/60 px-4 py-3">
          <p
            className="text-sm font-semibold text-[var(--base-color-brand--bean)]"
            style={{ fontFamily: 'var(--text-color--font-family--heading)' }}
          >
            How to use it
          </p>
          <dl className="mt-2 space-y-2 text-xs leading-snug text-[var(--base-color-brand--umber)]">
            {HOW_TO_ENTRIES.map((entry) => (
              <div key={entry.title}>
                <dt className="font-semibold text-[var(--base-color-brand--bean)]">
                  {entry.title}
                </dt>
                <dd>{entry.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Updates section */}
        <section className="mt-4 rounded-2xl border border-[var(--base-color-brand--umber)]/30 bg-[var(--base-color-brand--champagne)]/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p
                className="text-sm font-semibold text-[var(--base-color-brand--bean)]"
                style={{ fontFamily: 'var(--text-color--font-family--heading)' }}
              >
                Updates
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--base-color-brand--umber)]">
                {headline}
              </p>
            </div>
            {!isDownloading && !isDownloaded && (
              <button
                onClick={handleCheck}
                disabled={isChecking}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--base-color-brand--umber)]/60 bg-[var(--base-color-brand--shell)] px-3 py-1.5 text-xs font-semibold text-[var(--base-color-brand--bean)] transition-colors hover:bg-[var(--base-color-brand--bean)] hover:text-[var(--base-color-brand--shell)] disabled:cursor-not-allowed disabled:opacity-60"
                style={{ fontFamily: 'var(--text-color--font-family--heading)' }}
              >
                <RefreshIcon className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                {isChecking ? 'Checking' : 'Check'}
              </button>
            )}
          </div>

          {/* Progress bar (downloading) */}
          {isDownloading && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-[var(--base-color-brand--shell)]">
                <div
                  className="h-full bg-[var(--base-color-brand--cinamon)] transition-[width] duration-200"
                  style={{ width: `${status.progress ?? 0}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-[var(--base-color-brand--umber)]">
                <span>{status.progress ?? 0}%</span>
                <span>{formatSpeed(status.bytesPerSecond)}</span>
              </div>
            </div>
          )}

          {/* Release notes (available / downloaded). electron-updater's
              GitHub provider returns the release body as HTML (paragraphs,
              line breaks, entity-encoded angle brackets). We strip it to
              plain text rather than risk dangerouslySetInnerHTML — zero XSS
              surface even if a release author somewhere injects markup. */}
          {(isAvailable || isDownloaded) && status.releaseNotes && (
            <div className="mt-3 max-h-32 overflow-auto rounded-xl bg-[var(--base-color-brand--shell)] p-3 text-xs text-[var(--base-color-brand--bean)]">
              <p className="font-semibold">What’s new</p>
              {/* Sanitised HTML — only an allowlist of safe tags survives,
                  every attribute except `href` on `<a>` is stripped, so
                  there is no XSS surface even if a release author injects
                  markup. Renders paragraphs / lists / bold / links as
                  formatted markup instead of literal `<p>` text. */}
              <div
                className="release-notes mt-1 text-[var(--base-color-brand--umber)]"
                dangerouslySetInnerHTML={{ __html: sanitizeReleaseNotes(status.releaseNotes) }}
              />
            </div>
          )}

          {/* Error message */}
          {isError && status.error && (
            <p className="mt-3 rounded-xl bg-[var(--base-color-brand--red)]/10 px-3 py-2 text-xs text-[var(--base-color-brand--dark-red)]">
              {status.error}
            </p>
          )}

          {/* Primary action row */}
          <div className="mt-4 flex gap-2">
            {isAvailable && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 rounded-full border-none bg-[var(--base-color-brand--red)] px-4 py-2 text-xs font-semibold text-[var(--base-color-brand--shell)] shadow-[0_3px_0_0_var(--base-color-brand--dark-red)] transition-all hover:bg-[var(--base-color-brand--dark-red)] active:translate-y-0.5 active:shadow-[0_1px_0_0_var(--base-color-brand--dark-red)]"
                style={{ fontFamily: 'var(--text-color--font-family--heading)' }}
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                Download update
              </button>
            )}
            {isDownloaded && (
              <button
                onClick={handleInstall}
                className="flex items-center gap-1.5 rounded-full border-none bg-[var(--base-color-brand--red)] px-4 py-2 text-xs font-semibold text-[var(--base-color-brand--shell)] shadow-[0_3px_0_0_var(--base-color-brand--dark-red)] transition-all hover:bg-[var(--base-color-brand--dark-red)] active:translate-y-0.5 active:shadow-[0_1px_0_0_var(--base-color-brand--dark-red)]"
                style={{ fontFamily: 'var(--text-color--font-family--heading)' }}
              >
                Restart & install
              </button>
            )}
          </div>

          <p className="mt-3 text-[10px] text-[var(--base-color-brand--umber)]/80">
            Updates are pulled from the latest GitHub release.
          </p>
        </section>
      </div>
    </div>
  );
}
