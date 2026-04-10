# Research & Design Decisions

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.

---

## Summary

- **Feature**: `collaborative-editor-awareness`
- **Discovery Scope**: Extension (existing collaborative editor system)
- **Key Findings**:
  - `y-codemirror.next@0.3.5` reads `state.user` for cursor info, but GROWI sets `state.editors` — causing all cursors to render as "Anonymous" with default blue color today
  - `yCollab` in v0.3.5 does NOT support a `cursorBuilder` option; the cursor DOM is hardcoded in `YRemoteCaretWidget`
  - `awareness.getStates().delete(clientId)` in the current `updateAwarenessHandler` is an incorrect direct mutation of Yjs-managed internal state; Yjs removes stale entries before emitting `update`

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

## References

- y-codemirror.next v0.3.5 source: `node_modules/.pnpm/y-codemirror.next@0.3.5_.../src/`
- Yjs awareness protocol: https://docs.yjs.dev/api/about-awareness
- CodeMirror WidgetType: https://codemirror.net/docs/ref/#view.WidgetType
