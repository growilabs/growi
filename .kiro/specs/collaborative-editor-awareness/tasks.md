# Implementation Plan

- [ ] 1. Stabilize the Editing User List
- [ ] 1.1 Fix awareness state filter so undefined entries never reach the editor list renderer
  - Filter the awareness state values to exclude any entry that does not have a valid `editors` field before passing the list to the editing user list callback
  - Replace the existing array mapping that produces `undefined` for uninitialized clients with a filter that skips those entries entirely
  - Ensure the filtered list contains only valid `EditingClient` values
  - _Requirements: 1.1, 1.4_

- [ ] 1.2 Remove direct mutation of the Yjs-managed awareness map on client disconnect
  - Remove the `awareness.getStates().delete(clientId)` calls that incorrectly mutate Yjs-internal state when a client ID appears in the `removed` list
  - Rely on Yjs to clean up disconnected client entries before emitting the `update` event, as per the Yjs awareness contract
  - _Requirements: 1.2_

- [ ] 2. (P) Build the Rich Cursor Extension
- [ ] 2.1 (P) Implement cursor widget DOM with name label, avatar image, and initials fallback
  - Create a cursor widget class that renders a styled caret element containing the user's display name and profile image
  - Use the `color` value from the awareness editors field to set the flag background and border color
  - When `imageUrlCached` is available, render an `<img>` element; when it is undefined or empty, render a `<span>` showing the user's initials instead
  - Attach an `onerror` handler on the image element that replaces it with the initials fallback at runtime if the image URL fails to load
  - Implement widget equality check so that widgets with identical color, name, and image URL are not recreated unnecessarily
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 2.2 (P) Broadcast local cursor position to awareness on each selection change
  - Inside the cursor extension's view update handler, derive the local user's cursor anchor and head positions and convert them to Yjs relative positions using the ytext reference from `ySyncFacet`
  - Write the converted positions to the `cursor` field of the local awareness state using `setLocalStateField`
  - _Requirements: 3.5, 3.6_

- [ ] 2.3 (P) Render remote cursor decorations rebuilt from awareness state changes
  - Register a listener on awareness `change` events to rebuild the full decoration set whenever any cursor or editors field changes
  - For each remote client (excluding the local client), read `state.editors` for user identity and `state.cursor` for position; skip clients that lack either field
  - Create a caret widget decoration at the cursor's head position and a mark decoration over the selected range using the user's `colorLight` value for the highlight
  - Dispatch the rebuilt decoration set to update the editor view
  - _Requirements: 3.5, 3.6_

- [ ] 3. Integrate Rich Cursor Extension into the Editor Configuration
  - Change the `yCollab` call to pass `null` as the awareness argument, which suppresses the built-in `yRemoteSelections` and `yRemoteSelectionsTheme` plugins while keeping text-sync and undo behavior intact
  - Add the new rich cursor extension as a sibling extension alongside the `yCollab` output in the editor extension array
  - Verify that `yUndoManagerKeymap` is not duplicated, since `yCollab` already includes it in its return array
  - _Requirements: 1.3, 2.4, 3.5_

- [ ] 4. Unit Tests for Core Behaviors
- [ ] 4.1 (P) Test awareness state filtering and mutation-free disconnect handling in the hook
  - Given awareness states that include one valid client, one empty state, and one state with `editors: undefined`, verify that the editor list callback receives only the valid client
  - Given a `removed` client list in the awareness update event, verify that the awareness map is not mutated and no `.delete()` is called
  - _Requirements: 1.1, 1.2, 1.4_

- [ ] 4.2 (P) Test cursor widget construction, equality, and avatar fallback behavior
  - Given a widget with a provided image URL, verify that the rendered DOM contains an `<img>` element with the correct `src` attribute
  - Given a widget without an image URL, verify that the rendered DOM shows only initials and no `<img>` element
  - Verify that the `onerror` handler on the image element swaps the image out for the initials fallback
  - Verify that the equality check returns `true` only when color, name, and image URL all match
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 5. Integration Tests for Multi-Client Collaborative Scenarios
- [ ] 5.1 Test awareness update flow to EditingUserList with multiple simulated clients
  - Simulate two clients that both have `state.editors` set and verify that the editor list displays both users
  - Simulate one client with `state.editors` and one client without (newly connected) and verify that only the client with editors appears in the list
  - Verify that user presence information broadcast via `state.editors` is accessible from the awareness state
  - _Requirements: 1.3, 2.1, 2.4_

- [ ] 5.2 Test cursor position broadcasting and remote cursor rendering in the editor view
  - Given a simulated selection change, verify that the local awareness state `cursor` field is updated with the expected relative positions
  - Given a remote client's awareness state with both `state.editors` and `state.cursor` set, verify that a `cm-yRichCaret` widget appears in the editor view at the correct position
  - _Requirements: 3.5, 3.6_
