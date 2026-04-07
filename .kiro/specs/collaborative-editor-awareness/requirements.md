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

### Requirement 3: Rich Cursor Display

**Objective:** As a wiki user editing collaboratively, I want to see other users' cursors with their display name and profile image, so that I can easily identify who is editing where in the document.

#### Acceptance Criteria

1. While multiple users are editing the same page, the Collaborative Editor Client shall render each remote user's cursor with a flag that displays the user's display name.
2. While multiple users are editing the same page, the Collaborative Editor Client shall render each remote user's cursor flag with the user's profile image (avatar) when `imageUrlCached` is available in their awareness state.
3. If a remote user's awareness state does not include `imageUrlCached` (e.g., guest user or profile image not set), the Collaborative Editor Client shall render the cursor flag with the user's initials or a generic avatar fallback instead of a broken image.
4. The cursor flag color shall match the `color` value from the user's awareness state, consistent with the color shown in `EditingUserList`.
5. The Collaborative Editor Client shall pass a custom `cursorBuilder` function to `yCollab` (from `y-codemirror.next`) to produce the styled cursor DOM element containing name and avatar.
6. When a user's awareness state changes (e.g., cursor moves), the Collaborative Editor Client shall re-render that user's cursor with up-to-date information without re-mounting the entire cursor set.
