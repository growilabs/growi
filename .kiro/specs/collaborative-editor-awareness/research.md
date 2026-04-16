# Research & Design Decisions

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.

---

## Summary

- **Feature**: `collaborative-editor-awareness`
- **Discovery Scope**: Extension (existing collaborative editor system); Phase 2 adds Requirements 5 & 6 (color-matched avatars + click-to-scroll)
- **Key Findings** (original):
  - `y-codemirror.next@0.3.5` reads `state.user` for cursor info, but GROWI sets `state.editors` — causing all cursors to render as "Anonymous" with default blue color today
  - `yCollab` in v0.3.5 does NOT support a `cursorBuilder` option; the cursor DOM is hardcoded in `YRemoteCaretWidget`
  - `awareness.getStates().delete(clientId)` in the current `updateAwarenessHandler` is an incorrect direct mutation of Yjs-managed internal state; Yjs removes stale entries before emitting `update`
- **Key Findings** (Phase 2):
  - `UserPicture` (`@growi/ui`) does not accept a `style` prop; dynamic border colors require a wrapper element approach
  - `packages/editor` cannot import from `apps/app`; callback props (`onScrollToRemoteCursorReady`) are used to cross the package boundary
  - `EditorView.scrollIntoView(pos, { y: 'center' })` (CodeMirror built-in) is sufficient for the scroll-to-cursor feature; no new dependencies required

## Research Log

### y-codemirror.next@0.3.5 Cursor API Analysis

- **Context**: Requirement 3.5 proposed a `cursorBuilder` option for `yCollab`. Does the installed version support it?
- **Sources Consulted**: Package source at `node_modules/.pnpm/y-codemirror.next@0.3.5_.../src/index.js` and `y-remote-selections.js`
- **Findings**:
  - `yCollab` signature: `(ytext, awareness, { undoManager }) => Extension[]`; no `cursorBuilder` parameter
  - Cursor rendering is entirely inside `YRemoteCaretWidget.toDOM()` — hardcoded name-only label
  - Public exports include `ySync`, `ySyncFacet`, `YSyncConfig`, `yRemoteSelections`, `yRemoteSelectionsTheme`, `yUndoManagerKeymap`. NOT exported: `yUndoManager`, `yUndoManagerFacet`, `YUndoManagerConfig`
  - `y-remote-selections.js` reads `state.user.color` and `state.user.name`, but GROWI awareness sets `state.editors`
- **Implications**: Requirement 3.5 cannot be fulfilled via `yCollab` option. Must replace `yRemoteSelections` with a custom ViewPlugin. Since `yUndoManager`/`yUndoManagerFacet`/`YUndoManagerConfig` are not in the public API, `yCollab` must still be used for undo; awareness must be suppressed at call site.

### Awareness Field Mismatch (state.user vs state.editors)

- **Context**: Why do cursors show "Anonymous" despite the provider being set up with user data?
- **Findings**:
  - GROWI sets: `awareness.setLocalStateField('editors', { name, color, imageUrlCached, ... })`
  - `y-remote-selections.js` reads: `const { color, name } = state.user || {}`
  - Result: `state.user` is always undefined → name = "Anonymous", color = default `#30bced`
- **Implications**: Cursor name/color are currently broken. Fix requires either (a) also setting `state.user`, or (b) replacing the cursor plugin. Since we are building a rich cursor plugin anyway, the clean fix is (b).

### EditingUserList Disappearance Bug Root Cause

- **Context**: `EditingUserList` intermittently disappears when users are actively editing.
- **Findings** (from `use-collaborative-editor-mode.ts` source):
  1. `Array.from(awareness.getStates().values(), v => v.editors)` produces `undefined` for clients whose awareness state has not yet included an `editors` field
  2. `Array.isArray(clientList)` is always `true` — the guard never filters undefined values
  3. `EditingUserList` maps `editingClient.clientId` which throws/renders `undefined` element → React key error or render bail-out, causing the list to disappear
  4. `awareness.getStates().delete(clientId)` for removed clients is redundant and incorrect: the Yjs awareness protocol removes stale entries from the `Map` before emitting the `update` event. This mutation may cause stale data re-entry or missed subsequent updates
- **Implications**: Filter undefined entries and remove the `.delete()` call; no other changes to awareness-update logic required.

### yCollab with null awareness

- **Context**: Can we suppress `yRemoteSelections` without losing text-sync or undo functionality?
- **Findings**:
  - `ySync` (`YSyncPluginValue`) reads only `conf.ytext` — does not touch `conf.awareness`
  - `yUndoManager` reads only `conf.undoManager` (via `yUndoManagerFacet`) and `conf.ytext` (via `ySyncFacet`) — does not touch awareness
  - `yCollab` skips `yRemoteSelections` and `yRemoteSelectionsTheme` when `awareness` is falsy: `if (awareness) { plugins.push(yRemoteSelectionsTheme, yRemoteSelections) }`
  - Calling `yCollab(activeText, null, { undoManager })` therefore produces only: `[ySyncFacet.of(ySyncConfig), ySync, yUndoManagerFacet.of(...), yUndoManager, EditorView.domEventHandlers]`
- **Implications**: Safe to pass `null` as awareness to `yCollab` to suppress the default cursor plugin, then add `yRichCursors(provider.awareness)` separately.

### Local Cursor Broadcasting Responsibility

- **Context**: `yRemoteSelections` (`YRemoteSelectionsPluginValue.update()`) broadcasts the local cursor position via `awareness.setLocalStateField('cursor', { anchor, head })`. If we remove `yRemoteSelections`, who does this?
- **Findings**:
  - The broadcast is implemented entirely in `y-remote-selections.js` — not in `ySync`
  - Our custom `yRichCursors` ViewPlugin must include equivalent broadcast logic: on each `view.update`, derive anchor/head from `update.state.selection.main`, convert to Yjs relative positions, and call `awareness.setLocalStateField('cursor', ...)`
  - Cursor position uses the existing `state.cursor` field convention (unchanged)
- **Implications**: `yRichCursors` is a full replacement for `yRemoteSelections`, not just an additive decoration layer.

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations |
|--------|-------------|-----------|---------------------|
| A: Set `state.user` alongside `state.editors` | Keep existing `yRemoteSelections`; set both awareness fields | Minimal code change | No avatar support; maintains the two-field redundancy; cursor info is the name only |
| B: Custom ViewPlugin (replace `yRemoteSelections`) | `yCollab(null)` + `yRichCursors(awareness)` | Full avatar+name rendering; single source of truth in `state.editors`; clean separation | Must re-implement cursor broadcast logic (~30 lines of `y-remote-selections.js`) |
| C: Fork `y-codemirror.next` | Patch `YRemoteCaretWidget` to accept avatar | Full control | Maintenance burden; diverges from upstream; breaks on package upgrades |

**Selected: Option B** — replaces `yRemoteSelections` entirely with a purpose-built `yRichCursors` ViewPlugin.

## Design Decisions

### Decision: yCollab with null awareness + custom yRichCursors

- **Context**: `yCollab` has no `cursorBuilder` hook; `yUndoManager` is not publicly exported; default cursor reads wrong awareness field
- **Alternatives Considered**:
  1. Set `state.user` — minimal change but no avatar, still redundant field
  2. Fork library — too brittle
- **Selected Approach**: `yCollab(activeText, null, { undoManager })` to get text-sync and undo without default cursor, plus a custom `yRichCursors(awareness)` ViewPlugin for rich cursor rendering
- **Rationale**: Reads directly from `state.editors` (GROWI's canonical field), supports avatar, eliminates `state.user` redundancy, requires ~60 lines of new code
- **Trade-offs**: Must maintain the cursor-broadcast logic in `yRichCursors`; if `y-codemirror.next` updates its broadcast logic we won't get those changes automatically
- **Follow-up**: When upgrading to `y-codemirror.next >= 1.x` or `y-websocket v3`, re-evaluate if a native `cursorBuilder` API becomes available

### Decision: Avatar rendered as plain DOM `<img>` in WidgetType.toDOM()

- **Context**: CodeMirror cursor widgets are DOM-based (not React); `UserPicture` is a React component and cannot be used directly
- **Selected**: Construct DOM directly using `document.createElement` in `toDOM()`: `<img>` tag for avatar with `onerror` fallback to initials
- **Rationale**: CodeMirror `WidgetType.toDOM()` returns an `HTMLElement`; React components cannot be server-rendered in this context
- **Trade-offs**: Slightly duplicates `UserPicture` avatar rendering; acceptable as cursor widget is presentation-only

## Risks & Mitigations

- `yRichCursors` broadcasts cursor positions via `awareness.setLocalStateField('cursor', ...)` on every `update` call — same as the original `yRemoteSelections`. Throttle is not needed because Yjs awareness batches broadcasts internally.
- Avatar `<img>` may fail to load (404, CORS) — mitigate with `onerror` handler that replaces the `<img>` with initials fallback span.
- `awareness.getStates().delete()` removal: confirm Yjs v13 awareness `update` event fires after removing the client from the internal map (verified in Yjs source: removal happens before the event).
- **Recursive dispatch crash** (discovered during implementation): `setLocalStateField('cursor', ...)` inside the `update()` method fires an awareness `change` event **synchronously**. If the `change` listener calls `view.dispatch()` unconditionally, CodeMirror throws "Calls to EditorView.update are not allowed while an update is in progress". Mitigated by filtering the `change` listener to dispatch only when at least one **remote** client is in the changed set (`clients.findIndex(id => id !== awareness.doc.clientID) >= 0`). This matches the same pattern used by `y-remote-selections.js` in `y-codemirror.next`.
- **`y-protocols` not a direct dependency**: `y-protocols/awareness` exports the `Awareness` class, but neither `@growi/editor` nor `apps/app` list `y-protocols` as a direct dependency. `import type { Awareness } from 'y-protocols/awareness'` fails under strict pnpm resolution. Mitigated by deriving the type from the existing `y-websocket` dependency: `type Awareness = WebsocketProvider['awareness']`.
- **`view.viewport` vs `view.visibleRanges`** (discovered during validation): CodeMirror's `view.viewport` returns the **rendered** content range, which includes a pre-render buffer beyond the visible area for smooth scrolling. Using it for off-screen classification causes cursors in the buffer zone to be treated as in-viewport, resulting in invisible widget decorations instead of off-screen indicators. Must use `view.visibleRanges` (the ranges actually visible to the user) for accurate classification. Precedent: `setDataLine.ts` in the same package already uses `view.visibleRanges`.

## Implementation Discoveries

### Multi-Mode Viewport Classification

- **Context**: Off-screen cursor classification using `view.visibleRanges` worked in tests (jsdom with fixed-height containers) but failed in GROWI production.
- **Finding**: In GROWI's page-scroll editor setup, CodeMirror's `view.visibleRanges` and `view.viewport` return the **same** range (the full document), because the editor expands to content height and scrolling is handled by the browser page — not CodeMirror's own scroller. Character-position comparison is therefore useless for off-screen detection.
- **Solution**: Three-mode classification strategy in `plugin.ts`:
  1. **rangedMode** (`visibleRanges < viewport`): internal-scroll editor (jsdom tests, fixed-height editors) — use character-position boundaries from `visibleRanges`
  2. **coords mode** (`visibleRanges == viewport`, `scrollDOM.height > 0`): page-scroll editor (GROWI production) — use `view.lineBlockAt(pos)` + `scrollDOM.getBoundingClientRect()` to compute screen Y coordinates
  3. **degenerate** (`scrollDOM.height == 0`): jsdom with 0-height container — skip classification, all cursors get widget decorations
- **Constraint**: `view.coordsAtPos()` calls `readMeasured()` internally, which throws "Reading the editor layout isn't allowed during an update". Must use `view.lineBlockAt()` (reads stored height map, safe during update) + raw `getBoundingClientRect()` (not CodeMirror-restricted) instead.

### Material Symbols Font Loading

- **Context**: Off-screen indicator arrow (`arrow_drop_up`/`arrow_drop_down`) rendered as literal text instead of icon.
- **Finding**: GROWI loads Material Symbols Outlined via Next.js `next/font` in `use-material-symbols-outlined.tsx`. Next.js registers the font with a **hashed family name** (e.g., `__MaterialSymbolsOutlined_xxxxx`), stored in the CSS variable `--grw-font-family-material-symbols-outlined`. Hardcoding `font-family: 'Material Symbols Outlined'` in CodeMirror's `baseTheme` causes a mismatch — the browser cannot find the font.
- **Solution**: Use `fontFamily: 'var(--grw-font-family-material-symbols-outlined)'` in `theme.ts` so the hashed name is resolved at runtime.

### Parent Container `overflow-y: hidden` Limitation

- **Context**: Off-screen indicator arrow tip was clipped when positioned a few pixels beyond the editor border.
- **Finding**: `.page-editor-editor-container` inherits `overflow-y: hidden` from `.flex-expand-vert` within the `.flex-expand-vh-100` context (`packages/core-styles/scss/helpers/_flex-expand.scss` + `apps/app/src/styles/scss/layout/_editor.scss`). This clips any content extending beyond `.cm-editor`'s border box. `.cm-editor` itself has no overflow restriction.
- **Implication**: Off-screen indicators must stay within `.cm-editor`'s border box. Arrow icons use `clip-path` and negative margins to visually align with the border without extending past it.

### Horizontal Positioning via `requestMeasure`

- **Context**: Off-screen indicators should reflect the remote cursor's column position horizontally.
- **Finding**: `view.coordsAtPos()` cannot be called during `update()` (throws "Reading the editor layout" error). Horizontal positioning must be deferred.
- **Solution**: After `replaceChildren()`, call `view.requestMeasure()` to schedule a read phase (`coordsAtPos` → screen X) and write phase (`style.left` + `transform: translateX(-50%)`). For virtualized positions (outside viewport), fall back to `contentDOM.getBoundingClientRect().left + col * view.defaultCharacterWidth`.

### Phase 2 — Color-Matched Avatars & Click-to-Scroll

#### UserPicture Style API Analysis

- **Context**: Requirement 5.1 requires setting the border color of `UserPicture` avatars dynamically per user.
- **Findings**: `UserPicture.tsx` in `packages/ui/src/components/UserPicture.tsx` accepts only `{ user, size, noLink, noTooltip, className }`. The `className` is applied to the `<img>` element (not the root `<span>`). There is no `style` prop forwarded to either element.
- **Implications**: Cannot set `borderColor` via `UserPicture`'s own props. Must wrap in a parent element with an inline `border` style. The `border border-info` className on `UserPicture` is removed; the wrapper element provides the colored border.

#### Cross-Package Callback Pattern

- **Context**: `use-collaborative-editor-mode` (in `packages/editor`) needs to provide a scroll function to `EditingUserList` (in `apps/app`). Direct import from `apps/app` → `packages/editor` is the existing direction; reverse import is prohibited.
- **Findings**: The existing `onEditorsUpdated` callback in `Configuration` follows exactly this pattern: `packages/editor` calls a callback provided by `apps/app`. The same pattern is appropriate for `onScrollToRemoteCursorReady`.
- **Implications**: No new dependency or architectural mechanism needed; extend `Configuration` type with the new callback.

#### CodeMirror Scroll API

- **Context**: How to programmatically scroll the editor to a specific character position.
- **Findings**: `EditorView.scrollIntoView(pos: number, options?: { y?: 'nearest' | 'start' | 'end' | 'center' })` is the standard CodeMirror API. Dispatching `{ effects: EditorView.scrollIntoView(pos, { y: 'center' }) }` scrolls the editor so the position is vertically centered. No additional plugins or dependencies required.
- **Implications**: Scroll is a one-liner dispatch; no new package dependencies. The position is resolved from `Y.createAbsolutePositionFromRelativePosition(cursor.head, ydoc)` which is already used in `plugin.ts`.

#### Jotai Function Setter Pitfall

- **Context**: `scrollToRemoteCursorAtom` stores a `(clientId: number) => void` function. `useSetAtom` returns a setter that is passed as the `onScrollToRemoteCursorReady` callback.
- **Finding**: Jotai's atom setter interprets any **function argument** as an **updater function**: `setAtom(fn)` is treated as `setAtom(prev => fn(prev))`, not `setAtom(fn_as_value)`. When `onScrollToRemoteCursorReady(scrollFn)` was called, Jotai invoked `scrollFn(null)` (current atom value) as if it were an updater, then stored `scrollFn`'s return value (`undefined`) in the atom — the scroll function was never stored.
- **Symptom**: `[scrollToRemoteCursor] called with clientId: null` appeared in logs immediately after "scroll function registered", and the atom value flipped to `undefined`.
- **Solution**: Wrap the function value in `useSetScrollToRemoteCursor`:
  ```typescript
  setAtom(() => fn);  // updater that returns the function value
  ```
  This pattern must be applied to any Jotai atom that stores a function value.
- **Implication**: When designing Jotai atoms that store callbacks or any function-typed value, the setter must always use the `() => value` wrapper form. Document this in code review checklists for Jotai usage.

#### AvatarWrapper Styling — UserPicture Tooltip Fragment Issue

- **Context**: Wrapping `UserPicture` in a `<button>` for click handling caused visual misalignment and layout instability.
- **Finding**: When `noTooltip` is not set, `UserPicture` uses a `withTooltip` HOC that returns a React **Fragment** (`<span><img/></span> + <UncontrolledTooltip/>`). As flex children of the `<button>`, the Fragment's two children introduced unpredictable layout. Additionally, the `<span>` as an inline element contributed ghost space from `line-height`, making the circular border appear offset.
- **Solution**:
  - Pass `noTooltip` to `UserPicture` to get a predictable single-child render (`<span><img/></span>`)
  - Use Bootstrap utilities for layout: `d-inline-flex align-items-center justify-content-center p-0 bg-transparent rounded-circle`
  - Add `line-height: 0` to `.avatar-wrapper` in the CSS module to eliminate inline ghost space
  - Keep only the dynamic border color as inline style: `border: 2px solid ${color}`

#### Smooth Scroll via scrollDOM Style

- **Context**: Click-to-scroll should animate smoothly rather than jump instantly.
- **Finding**: `EditorView.scrollIntoView` dispatches a CodeMirror state effect that CodeMirror resolves by scrolling `view.scrollDOM`. Setting `view.scrollDOM.style.scrollBehavior = 'smooth'` before the dispatch causes the browser to animate the scroll. Restoring the value after ~500 ms (typical animation window) avoids affecting other programmatic scrolls.
- **Constraint**: This approach works when `view.scrollDOM` is the actual scrolling element. In GROWI's page-scroll setup, the effective scrolling element may be a parent container; if smooth scrolling does not animate as expected, the `scrollBehavior` may need to be set on the parent scroll container instead.

### Phase 3 — Off-Screen Indicator Click & Username Tooltip

#### scrollCallbackRef Pattern — Why Not Pass scrollFn Directly to yRichCursors

- **Context**: Req 6.6 requires off-screen indicators to invoke the same `scrollFn` used by `EditingUserList`. The natural approach would be `yRichCursors(awareness, { onClickIndicator: scrollFn })`, but this fails because `yRichCursors` and `scrollFn` are created in two separate `useEffect` calls with slightly different dependency sets.
- **Finding**: If `scrollFn` is passed as a plain value, every time the scroll function is recreated (on provider/activeDoc/codeMirrorEditor change), the extension array must also be recreated — causing a full CodeMirror extension reload. This is expensive and unnecessary.
- **Solution**: Pass a mutable ref `scrollCallbackRef = useRef(null)` to `yRichCursors`. The plugin captures the ref object (stable reference across re-renders). The scroll-function registration effect updates `.current` silently without touching the extension.
- **Implication**: This is the standard React pattern for exposing a stable callback to an imperative API. The `ScrollCallbackRef` type (`{ current: Fn | null }`) is defined in `packages/editor` without importing React, making it usable in the non-React CodeMirror extension context.

#### UserPicture Tooltip — withTooltip HOC Elimination (Design Review Outcome)

- **Context**: Req 7 requires username tooltips in `EditingUserList`. The `UserPicture` component's `withTooltip` HOC returns a React Fragment (`<span><img/></span> + <UncontrolledTooltip/>`), which caused layout instability when used inside a flex `<button>` (Phase 2 finding). The initial approach (Phase 2) was to use `noTooltip` + external `UncontrolledTooltip` at the wrapper level, but design review identified this as a workaround that would need to be repeated by every consumer facing the same Fragment/flex issue.
- **Root cause analysis**: The `withTooltip` HOC returns a Fragment because `UncontrolledTooltip` is placed as a **sibling** of the wrapped component. While `UncontrolledTooltip` uses `ReactDOM.createPortal` (tooltip content renders to `document.body`), the Fragment still produces two React children at the parent level, which can destabilize flex layout.
- **Key insight**: Since `UncontrolledTooltip` is a portal, it can be placed as a **child** of the root `<span>` instead of a sibling. As a portal child, it occupies no DOM space in the parent — only the `<img>` is a visible child. The root element becomes a single `<span>` with predictable layout behavior in any container type.
- **Solution**: Eliminate the `withTooltip` HOC. Move tooltip rendering inline into `UserPicture`'s render function:
  1. Create `rootRef = useRef<HTMLSpanElement>(null)` unconditionally (hooks rules compliant)
  2. Pass `rootRef` to `UserPictureRootWithoutLink`/`UserPictureRootWithLink` via `forwardRef` (they already support it)
  3. Conditionally render `UncontrolledTooltip` as a child of the root element alongside `imgElement`
  4. Delete the `withTooltip` HOC function
- **Impact verification**: `withTooltip` is not exported — it's only used internally in `UserPicture.tsx`. The public API (`Props`: `user, size, noLink, noTooltip, className`) is unchanged. All existing consumers (30+ usages across `apps/app`) are unaffected.
- **`noTooltip` usages** (16 call sites): Consumers that pass `noTooltip` (sidebar dropdowns, inline notifications, comment editors, conflict modals) continue to suppress tooltips. `EditingUserList` is the only consumer that **removes** `noTooltip` to gain the tooltip.
- **Implication**: `EditingUserList` no longer needs external tooltip code (`UncontrolledTooltip`, `id` generation, `clientId`-based targeting). The `AvatarWrapper` sub-component is simplified to just a `<button>` wrapping `<UserPicture>` with color border.

## References

- y-codemirror.next v0.3.5 source: `node_modules/.pnpm/y-codemirror.next@0.3.5_.../src/`
- Yjs awareness protocol: https://docs.yjs.dev/api/about-awareness
- CodeMirror WidgetType: https://codemirror.net/docs/ref/#view.WidgetType
- CodeMirror EditorView.lineBlockAt: https://codemirror.net/docs/ref/#view.EditorView.lineBlockAt
- CodeMirror EditorView.scrollIntoView: https://codemirror.net/docs/ref/#view.EditorView^scrollIntoView
