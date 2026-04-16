# Requirements Document

## Project Description (Input)
collaborative-editor-awareness

## Introduction

GROWI's collaborative editor uses Yjs awareness protocol to track which users are currently editing a page and where their cursors are positioned. This awareness information is surfaced in two places: the `EditingUserList` component in the editor navbar (showing active user avatars), and the in-editor cursor decorations rendered by `y-codemirror.next`.

**Scope**: Client-side awareness state management, `EditingUserList` display stability (bug fix), and rich cursor rendering (username + avatar) in the CodeMirror editor.

**Out of Scope**: Server-side awareness bridging to Socket.IO (covered in `collaborative-editor` spec), WebSocket transport, MongoDB persistence, or authentication.

**Inherited from**: `collaborative-editor` — Requirement 5 (Awareness and Presence Tracking). That spec now delegates awareness display behavior to this specification.

## Requirements

### Requirement 1: Awareness State Stability

**Objective:** As a wiki user viewing the collaborative editor, I want the editing user list to remain visible and accurate at all times while other users are connected, so that I can reliably see who is co-editing with me.

#### Acceptance Criteria

1. The Collaborative Editor Client shall filter out any awareness state entries that do not contain a valid `editors` field before passing the client list to `EditingUserList`, so that `undefined` values never appear in the rendered list.
2. The Collaborative Editor Client shall not manually mutate `awareness.getStates()` (e.g., call `.delete()` on removed client IDs), as the Yjs awareness system already removes stale entries before firing the `update` event.
3. While a user is connected and at least one other user is in the same editing session, the EditingUserList shall remain visible and not disappear due to transient undefined values or internal map mutations.
4. If an awareness state entry is received without an `editors` field (e.g., from a client that has not yet broadcast its presence), the Collaborative Editor Client shall silently skip that entry rather than propagating an undefined value.

### Requirement 2: Awareness Presence Tracking (Inherited)

**Objective:** As a wiki user, I want to see which other users are currently editing the same page, so that I can coordinate edits and avoid conflicts.

#### Acceptance Criteria

1. While a user is editing a page, the Collaborative Editor Client shall broadcast the user's presence information (name, username, avatar URL, cursor color) via the Yjs awareness protocol using the `editors` field on the local awareness state.
2. When a user connects or disconnects from a collaborative editing session, the Yjs Service shall emit awareness state size updates to the page's Socket.IO room (`page:{pageId}`) via `YjsAwarenessStateSizeUpdated`.
3. When the last user disconnects from a document, the Yjs Service shall emit a draft status notification (`YjsHasYdocsNewerThanLatestRevisionUpdated`) to the page's Socket.IO room.
4. The Collaborative Editor Client shall display the list of active editors based on awareness state updates received from the Yjs WebSocket provider.

### Requirement 3: Rich Cursor Display (Overlay Avatar)

**Objective:** As a wiki user editing collaboratively, I want to see other users' cursors with their profile image as an overlay, so that I can easily identify who is editing where in the document without the cursor widget disrupting the text layout.

#### Acceptance Criteria

1. While multiple users are editing the same page, the Collaborative Editor Client shall render each remote user's cursor with a profile image (avatar) positioned directly below the caret line, as an overlay that does not consume block space in the editor content flow.
2. The avatar overlay size shall be 20×20 CSS pixels (circular), smaller than `EditingUserList` to minimize interference with editor content.
3. While hovering over the avatar overlay, the Collaborative Editor Client shall display the user's display name in a tooltip-like label adjacent to the avatar. When not hovered, the name label shall be hidden.
4. When `imageUrlCached` is available in the remote user's awareness state, the avatar shall display that image. If `imageUrlCached` is unavailable or fails to load, the avatar shall fall back to the user's initials rendered in a colored circle.
5. The cursor caret color, avatar fallback background color, and avatar border color shall all match the `color` value from the user's awareness state, consistent with the color shown in `EditingUserList`. A colored circular border (matching `color`) shall be applied to both avatar images and initials circles to visually associate the avatar with the cursor.
6. The Collaborative Editor Client shall suppress the default cursor plugin by passing `null` as the awareness argument to `yCollab` (from `y-codemirror.next`), and use the separate `yRichCursors` extension for cursor rendering.
7. When a user's awareness state changes (e.g., cursor moves), the Collaborative Editor Client shall re-render that user's cursor with up-to-date information without re-mounting the entire cursor set.
8. The avatar overlay shall be rendered at reduced opacity (semi-transparent) by default to minimize visual distraction.
9. While the user hovers over the avatar overlay or cursor caret, the avatar shall be displayed at full opacity (1.0).
10. When a remote user is actively editing (awareness cursor state has changed within the last 3 seconds), their avatar shall be displayed at full opacity (1.0). After 3 seconds of inactivity (no cursor/awareness change), the avatar shall return to the reduced opacity state.

### Requirement 4: Off-Screen Cursor Indicators

**Objective:** As a wiki user editing collaboratively, I want to know when other users are editing parts of the document that are not currently visible in my viewport, so that I am aware of all editing activity even outside my scroll position.

#### Acceptance Criteria

1. When a remote user's cursor is positioned above the current visible viewport, the Collaborative Editor Client shall display that user's avatar icon pinned to the top edge of the editor. A `arrow_drop_up` Material Symbol icon (in the cursor's color) shall be stacked above the avatar to indicate the user is editing above the visible area.
2. When a remote user's cursor is positioned below the current visible viewport, the Collaborative Editor Client shall display that user's avatar icon pinned to the bottom edge of the editor. A `arrow_drop_down` Material Symbol icon (in the cursor's color) shall be stacked below the avatar to indicate the user is editing below the visible area.
3. When a remote user's cursor is within the visible viewport, no off-screen indicator shall be shown for that user (the in-editor cursor widget from Requirement 3 is shown instead).
4. The off-screen indicator shall use the same avatar image (or initials fallback) and color as the in-editor cursor widget, maintaining visual consistency.
5. When multiple remote users are off-screen in the same direction (above or below), each indicator shall be independently positioned horizontally to reflect its remote cursor's column position in the document. Indicators at different columns appear at different horizontal positions within the container.
6. When the user scrolls and a previously off-screen cursor enters the viewport, the off-screen indicator for that user shall be removed and the in-editor cursor widget shall appear instead. Conversely, when a previously visible cursor leaves the viewport due to scrolling, an off-screen indicator shall appear.
7. The off-screen indicators shall be rendered as overlays (absolute positioning within the editor container) and shall not affect the editor's scroll height or content layout.
8. The horizontal position of each off-screen indicator shall reflect the remote cursor's column position in the document. The `left` CSS value of the indicator shall be derived from the cursor's screen X coordinate (via `view.coordsAtPos` in the measure phase) or, for virtualized positions, approximated using character-width estimation. The indicator shall be centered on the cursor column (`transform: translateX(-50%)`).
9. The direction arrow icon of the off-screen indicator shall always be rendered at full opacity (1.0) in the cursor's color, regardless of the idle/active state. Only the avatar image or initials element shall fade to reduced opacity (`IDLE_OPACITY`) when the user is idle, and return to full opacity when active.

### Requirement 5: Color-Matched User Avatars in EditingUserList

**Objective:** As a wiki user editing collaboratively, I want the avatar border in `EditingUserList` to use each user's cursor color, so that I can visually associate an avatar in the list with that user's cursor in the editor.

#### Acceptance Criteria

1. Each `UserPicture` in `EditingUserList` shall display a border whose color equals `editingClient.color` from the user's `EditingClient` data, replacing the current fixed `border-info` color.
2. The border width and visual weight shall be equivalent to the existing border appearance (1–2 px solid ring).
3. The same color-matched border shall be applied to avatars in the overflow popover (the remaining users shown via the `+N` button).

### Requirement 6: Scroll to Remote Cursor on Avatar Click

**Objective:** As a wiki user editing collaboratively, I want to click a user's avatar in `EditingUserList` to jump to that user's cursor position in the editor, so that I can quickly navigate to where they are editing.

#### Acceptance Criteria

1. Clicking an avatar in `EditingUserList` shall scroll the editor viewport so that the clicked user's remote cursor becomes visible.
2. The editor shall scroll to center the cursor vertically (`y: 'center'`).
3. If the clicked user has no active cursor position in the awareness state, the click shall have no effect (no error or crash).
4. Each avatar shall display a `cursor: pointer` affordance to indicate it is clickable.
5. Both the first-4 avatars displayed directly in the navbar and the avatars in the overflow popover shall support click-to-scroll.
6. When an off-screen indicator (pinned to the top or bottom edge of the editor) is clicked, the Collaborative Editor Client shall scroll the editor viewport so that the corresponding remote user's cursor is centered vertically in the visible area, applying the same scroll behavior as Criteria 1–3 above.
7. Each off-screen indicator shall display a `cursor: pointer` affordance to indicate it is clickable.

### Requirement 7: Username Tooltip in EditingUserList

**Objective:** As a wiki user editing collaboratively, I want to see a tooltip with the co-editor's username when hovering over their avatar in `EditingUserList`, so that I can identify each co-editor by name even when the avatar image is not recognizable.

#### Acceptance Criteria

1. While hovering over any avatar in `EditingUserList`, the Collaborative Editor Client shall display a tooltip containing the user's display name.
2. The tooltip shall be applied to both the first-4 directly visible avatars and the avatars inside the overflow popover.
3. The tooltip shall coexist with the color-matched border (Requirement 5) and the click-to-scroll behavior (Requirement 6) without visual or functional conflict.
4. If the `UserPicture` component's `noTooltip` flag or a higher-order component (HoC) prevents native tooltip rendering, the tooltip mechanism shall be refactored — for example by embedding tooltip functionality directly in the component or by adopting a tooltip primitive (e.g., `UncontrolledTooltip`, `Tooltip` from `reactstrap`) — so that username display is not suppressed.
5. The tooltip shall appear with standard UI delay (hover intent) and disappear when the pointer leaves the avatar area.
