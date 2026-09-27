# Composition templates

## Scope and direction

This is an addition to the desktop product-photography workflow, not a redesign. The editor's single job is to save reusable reference framing. It reuses the existing champagne/shell surfaces, bean/umber text and borders, heading font, rounded controls and wrapping prompt toolbar. A native modal dialog supplies focus containment, Escape and focus return. The editor is loaded only when opened.

Composition is **guidance, not a background plate or a pixel lock**. Product references establish identity; a separate clean composition reference establishes framing, background, surface and lighting. GPT or Nano Banana renders the complete scene. There is no segmentation, cutout, background removal or compositing. The existing derived close-up remains a crop of the elevated shot.

## Workflow and states

- None preserves ordinary generation. A selected template fixes aspect and adds one matching composition reference after each product's own photos.
- The 3-angle workflow exposes separate Eye level and 45° above composition selectors. Each selection remembers a template ID and an explicit reference slot; template names never determine assignment. Newly created compositions from these rows edit only that angle. Existing multi-reference templates remain readable/editable without rewriting saved data, and each reference is explicitly listed in the selectors. The close-up remains a crop of the assigned 45° result, not a third composition.
- Crop coordinates describe the source photo; guides describe the cropped output frame. Y is measured from the top. Centre and width are constrained together; products must not be stretched to fit.
- Upload still PNG/JPEG/WebP photos locally. Inspect headers and chunk lengths before either browser or native pixel decoding; reject oversized dimensions and animated frames. Both processes share the same bounded parser. Normalize once to a full-resolution clean PNG, preserving browser-decoded orientation, before main-process validation/cropping. Electron nativeImage only guarantees PNG/JPEG decoding and does not honor EXIF orientation. Saved references contain no guide pixels. Preview assets are bounded to 1,200 pixels; pointer motion changes coordinates, not image pixels.
- The fixed aspect is chosen before references are added. Remove the draft references to change it. Numeric fields and keyboard sliders are alternatives to dragging.
- Reference controls are disabled while an upload is being prepared, so remove/copy cannot race a late upload callback. Cancel remains available, aborts readers and image work, revokes object URLs and discards the draft. Write errors leave it open. Archived or missing single-shot selections visibly return to None. Per-angle selections remain visibly unavailable and block generation until reassigned or both cleared; corrupted storage/assets are errors, never silent fallback.
- Runs snapshot settings before queuing. All products are preflighted for 1–7 own references, required assignments, fixed aspect, asset availability and the final 32,000-character prompt cap. Each assigned template controls its own shot's aspect, so the two angles may differ. Selecting only one composition blocks the whole batch; both None preserves prompt-only generation. Existing provider selection, explicit Generate, batch confirmation and sequential requests remain. The confirmation distinguishes paid generated views from free local crops.

## Persistence and boundaries

Templates use isolated versioned `shoot-templates.json`, locked read-modify-write and atomic publication. Revisions reject stale updates. Assets have generated names, are published before metadata and remain immutable; archive does not delete them. Existing product, image and prompt stores are not migrated. Malformed metadata is reported rather than replaced with an empty store.

The renderer persists the single-shot selection and angle plus the two per-angle template/reference selections, never asset bytes. Single-shot and angle-set selections are independent and survive mode changes. Existing preferences need no destructive migration. Main validates payloads, geometry, image byte/pixel bounds, decoded images and containment in the owned composition folder. There are no new endpoints at image providers and no new packages.

## Disclosure and residual risks

The editor says: “Guides framing and background alignment. Results may vary.” It explains that editing stays local and Generate sends composition images alongside product photos to the chosen existing provider. Use owned/licensed photos. This is product/engineering guidance, not legal advice or a compliance review. No new tracking, recipients or background-removal fees are introduced.

Actual alignment, identity and shadows require a separately authorized paid sample across at least two products. Mocks do not establish model accuracy. Closing the editor does not cancel a generation or imply a refund.

## Approved-plan reconciliation

1. Shared template contracts, geometry validation and both TypeScript project includes are present.
2. The isolated JSON store tests create/reload/update/archive, revision conflicts, atomic-publication failures and malformed-store refusal. Existing assets remain available to in-flight snapshots.
3. Template handlers use `secureHandle`; typed preload methods, owned-asset containment and byte/pixel/crop/guide checks are implemented. Main IPC rejection and filesystem containment have tests. An isolated-profile Electron smoke test now also exercises real native decoding, crop dimensions and template persistence.
4. Prompt/job tests cover product-first reference order, matching angles, role numbering, geometry, single/batch runs, immutable settings, complete-batch rejection and unchanged no-template prompts.
5. The lazy editor supports clean cropping, per-angle guides, explicit reuse, local uploads, error recovery, keyboard controls, dragging, cancellation and bounded preview cleanup. Pending-upload races are regression-checked.
6. The picker persists selections/angles, fixes aspect per assigned composition, surfaces missing selections and submits snapshots. Composition-active photo selections over seven are rejected rather than truncated.
7. ImagePage keeps sequential provider requests and per-product elevated-shot close-ups. The browser harness checks real generation-call payloads with mocked IPC; it does not exercise a paid provider.
8. Design and limitations are documented; project checks and the synthetic browser harness cover the implementation. An isolated-profile Electron run verifies the local editor/storage workflow with real IPC. Paid multi-product alignment is explicitly not verified.

The completed-code cross-check reused the plan's guidance-versus-compositing references and inspected current `crafter-station/petdex` image-header handling plus `remirror/remirror` FileReader abort handling through Steroids. These informed the shared pre-decode parser and lifecycle guards; they are examples, not evidence that this implementation is correct.

## Rendered review

The initial editor spent too much space on unavailable aspect options; the revised editor shows the fixed aspect and a smaller preview so guide controls are visible sooner. Re-captured at 1566, 1100 and 800 pixels. Changed-scope visual rubric: 21/24 (responsive coverage, accessibility audit completeness and state-transition feedback each remain 1/2; other criteria 2/2). This is not release sign-off. Literal token contrast measurements: bean/shell 14.50:1, bean/champagne 13.60:1 and umber/shell borders 7.32:1. Broader assistive-technology and reflow coverage is still unverified.

## Verification scope

The per-angle assignment extension was checked through the real ImagePage with 20 synthetic products: 40 mocked generation calls and 20 correctly paired crops, distinct per-angle aspects/references/guides, persisted selections, locked-angle creation, cancellation and snapshot isolation during edits. Missing/archived/incomplete selections and invalid product references blocked every generation call. A missing-asset retry retained inputs and completed the batch. Desktop/1100/800 screenshots showed no form-control overflow. This extension was built and browser-tested, not reinstalled or tested with paid generation.

Changed-scope checks cover pure prompts/geometry, target-angle ordering, original no-template regressions, real filesystem metadata round trips/concurrency/failure retention, IPC input rejection, and the real React editor/form/page with mocked IPC. Browser fixtures are synthetic, not user photos. The browser harness and screenshots live under ignored `.gg/`.

Browser checks also assert that an oversized image never receives a decoder source, PNG/JPEG/WebP uploads succeed, remove/copy are disabled during delayed normalization, callbacks released after Cancel leave saved guides unchanged, and over-limit product-photo selections are rejected without adding a truncated subset. Browser checks cover save failure recovery, save/cancel/reopen, explicit reference reuse, numeric and keyboard-slider editing, picker reload, all ten supported provider/model combinations, single/batch generation payloads, derived close-ups, missing-asset blocking, and desktop/1100/800-pixel wrapping. Native dialog semantics, labels, image alternatives and error/status announcements are implemented. The editor's active angle uses a solid bean surface with shell text, distinct from focus.

After authorization to reinstall, Electron 42.1.0 was restored from a cached archive matching the installed package's checksum. The real Electron renderer, sender-validated IPC, native PNG decoding/cropping, template save/reload/update/archive and immutable old assets passed an isolated-profile smoke test. No user data or paid providers were used. The new Composition question-mark tooltip was checked on hover, keyboard focus and at 800 pixels.

Not certified: full WCAG/ADA conformance, assistive-technology output, field performance, crash/power-loss recovery or model-output accuracy. Native provider generation and complete app-wide end-to-end coverage remain unverified. The local app bundle is Developer ID signed; the build skipped notarization because notarization options were unavailable. It was not published.
