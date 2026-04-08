# Implementation Plan

- [x] 1. Stabilize the Editing User List
- [x] 1.1 Fix awareness state filter so undefined entries never reach the editor list renderer
  - Filter the awareness state values to exclude any entry that does not have a valid `editors` field before passing the list to the editing user list callback
  - Replace the existing array mapping that produces `undefined` for uninitialized clients with a filter that skips those entries entirely
  - Ensure the filtered list contains only valid `EditingClient` values
  - _Requirements: 1.1, 1.4_

- [x] 1.2 Remove direct mutation of the Yjs-managed awareness map on client disconnect
  - Remove the `awareness.getStates().delete(clientId)` calls that incorrectly mutate Yjs-internal state when a client ID appears in the `removed` list
  - Rely on Yjs to clean up disconnected client entries before emitting the `update` event, as per the Yjs awareness contract
  - _Requirements: 1.2_

- [x] 2. Build the Rich Cursor Extension (Initial)
- [x] 2.1 (P) Implement cursor widget DOM with name label, avatar image, and initials fallback
  - _Requirements: 3.4, 3.5_

- [x] 2.2 (P) Broadcast local cursor position to awareness on each selection change
  - _Requirements: 3.6, 3.7_

- [x] 2.3 (P) Render remote cursor decorations rebuilt from awareness state changes
  - _Requirements: 3.6, 3.7_

- [x] 3. Integrate Rich Cursor Extension into the Editor Configuration
  - Suppress the default cursor plugin by passing `null` as the awareness argument to `yCollab`
  - Add the rich cursor extension as a sibling extension alongside `yCollab` output
  - Verify `yUndoManagerKeymap` is not duplicated
  - _Requirements: 1.3, 2.4, 3.6_

- [x] 4. Unit Tests for Core Behaviors (Initial)
- [x] 4.1 (P) Test awareness state filtering and mutation-free disconnect handling in the hook
  - _Requirements: 1.1, 1.2, 1.4_

- [x] 4.2 (P) Test cursor widget construction, equality, and avatar fallback behavior
  - _Requirements: 3.4, 3.5_

- [x] 5. Integration Tests for Multi-Client Collaborative Scenarios (Initial)
- [x] 5.1 Test awareness update flow to EditingUserList with multiple simulated clients
  - _Requirements: 1.3, 2.1, 2.4_

- [x] 5.2 Test cursor position broadcasting and remote cursor rendering in the editor view
  - _Requirements: 3.6, 3.7_

- [ ] 6. Add baseTheme with Overlay Positioning, Hover, and Opacity Rules
- [ ] 6.1 (P) Create the EditorView.baseTheme defining all cursor overlay CSS rules
  - Define overlay positioning for the cursor flag element: absolute below the caret, centered on the 1px caret line
  - Set avatar and initials fallback sizes to 16×16 pixels with circular clipping
  - Set up the two-step hover cascade: pointer-events none by default on the flag, enabled on caret hover
  - Define the name label as hidden by default, shown on flag hover
  - Set the default opacity to semi-transparent with a smooth transition, full opacity on caret hover or when the active class is present
  - Include the theme extension in the return value of the rich cursors factory function
  - _Requirements: 3.1, 3.2, 3.3, 3.8, 3.9_

- [ ] 6.2 (P) Define off-screen container and indicator styles in the same baseTheme
  - Define the top and bottom off-screen containers as absolute-positioned, flex-layout, pointer-events none
  - Define the off-screen indicator as flex with gap, semi-transparent by default, full opacity with the active class
  - Define the off-screen avatar and initials with 16×16 sizing matching the in-editor widget
  - Define the arrow indicator styling
  - _Requirements: 4.5, 4.7_

- [ ] 7. Rework RichCaretWidget for Overlay Avatar with Activity State
- [ ] 7.1 Rebuild the widget DOM to render as an overlay with avatar, initials fallback, and hover-revealed name label
  - Restructure the widget DOM to wrap the avatar and name label inside a flag container element positioned as an overlay below the caret
  - Render the avatar image at 16×16 pixels when the image URL is available, with an error handler that swaps in the initials fallback
  - When no image URL is provided, render the initials fallback directly as a colored circle with the user's initial letters
  - Render the name label element inside the flag container (visibility controlled by the baseTheme hover rule)
  - Accept an `isActive` parameter and apply the active CSS class to the flag element when true
  - Update the equality check to include the `isActive` parameter alongside color, name, and image URL
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.10_

- [ ] 7.2 Add activity tracking to the ViewPlugin with per-client timers
  - Maintain a map of each remote client's last awareness change timestamp
  - Maintain a map of per-client timer handles for the 3-second inactivity window
  - On awareness change for a remote client, record the current timestamp and reset the client's timer to dispatch a decoration rebuild after 3 seconds
  - When building decorations in the update method, compute each client's active state by comparing the current time against the last activity timestamp
  - Pass the computed active state to the widget constructor so the DOM reflects the current activity
  - Clear all timers on plugin destruction
  - _Requirements: 3.10_

- [ ] 8. Build Off-Screen Cursor Indicators
- [ ] 8.1 Create persistent off-screen containers attached to the editor DOM
  - Create top and bottom container elements in the ViewPlugin constructor and append them to the editor's outer DOM element
  - The containers remain in the DOM for the plugin's lifetime (empty when no off-screen cursors exist)
  - Remove both containers in the plugin's destroy method
  - _Requirements: 4.7_

- [ ] 8.2 Classify remote cursors by viewport position and render off-screen indicators
  - After computing absolute positions for all remote cursors in the update method, compare each position against the current viewport range
  - For cursors above the viewport, build an indicator element (arrow up + avatar or initials fallback) and add it to the top container
  - For cursors below the viewport, build an indicator element (arrow down + avatar or initials fallback) and add it to the bottom container
  - For cursors within the viewport, render the in-editor widget decoration as before (no off-screen indicator)
  - Replace container children on each relevant update cycle using a batch DOM operation
  - Apply the active CSS class to off-screen indicators when the corresponding client's activity state is active
  - Rebuild containers when the viewport changes or awareness changes
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 9. Unit Tests for Updated Widget and Off-Screen Indicators
- [ ] 9.1 (P) Test the updated widget DOM structure, overlay flag, sizing, and isActive class behavior
  - Verify the widget renders a flag container with position absolute styling inside the caret element
  - Verify the avatar image renders at 16×16 when image URL is provided
  - Verify the initials fallback renders with the user's color as background when no image URL is given
  - Verify the image error handler replaces the image with the initials fallback
  - Verify the name label element exists inside the flag container
  - Verify the flag element receives the active CSS class when isActive is true, and does not when false
  - Verify the equality check returns false when isActive differs
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.10_

- [ ] 9.2 (P) Test off-screen indicator DOM construction and avatar fallback
  - Verify an off-screen indicator element contains an arrow element and an avatar image when image URL is provided
  - Verify an off-screen indicator falls back to an initials element when image URL is absent
  - Verify the active CSS class is applied to the indicator element when the client is active
  - _Requirements: 4.1, 4.2, 4.4_

- [ ] 10. Integration Tests for Viewport Classification and Activity Tracking
- [ ] 10.1 Test that remote cursors outside the viewport are excluded from widget decorations
  - Simulate a remote client with a cursor position beyond the viewport range and verify that no widget decoration is created for that client
  - _Requirements: 4.3, 4.6_

- [ ] 10.2 Test activity tracking timer lifecycle with fake timers
  - Simulate an awareness change for a remote client and verify the client is marked as active
  - Advance fake timers by 3 seconds and verify a decoration rebuild is triggered, resulting in the client being marked as inactive
  - Simulate a new awareness change before the timer expires and verify the timer is reset
  - _Requirements: 3.10_

- [ ]\* 11. E2E Tests for Hover, Opacity, and Off-Screen Transitions
- [ ]\* 11.1 (P) Test hover behavior on the cursor overlay flag
  - Hover over a remote user's caret area and verify the name label becomes visible
  - Move the cursor away and verify the name label is hidden
  - Verify that clicking on text underneath the overlay correctly places the editor cursor
  - _Requirements: 3.3, 3.9_

- [ ]\* 11.2 (P) Test off-screen indicator visibility on scroll
  - Scroll the editor so a remote user's cursor goes above the viewport and verify the top off-screen container shows an indicator with the correct avatar and arrow
  - Scroll back to reveal the cursor and verify the off-screen indicator disappears and the in-editor widget reappears
  - _Requirements: 4.1, 4.2, 4.3, 4.6_
