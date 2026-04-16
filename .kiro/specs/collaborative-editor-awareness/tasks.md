# Implementation Plan

- [x] 1. Stabilize the Editing User List
- [x] 1.1 Fix awareness state filter (undefined → skip) — _Req 1.1, 1.4_
- [x] 1.2 Remove direct mutation of Yjs-managed awareness map — _Req 1.2_

- [x] 2. Build the Rich Cursor Extension (Initial)
- [x] 2.1 (P) Cursor widget DOM: name label, avatar image, initials fallback — _Req 3.4, 3.5_
- [x] 2.2 (P) Broadcast local cursor position to awareness — _Req 3.6, 3.7_
- [x] 2.3 (P) Render remote cursor decorations from awareness — _Req 3.6, 3.7_

- [x] 3. Integrate Rich Cursor Extension into Editor Configuration — _Req 1.3, 2.4, 3.6_

- [x] 4. Unit Tests for Core Behaviors (Initial)
- [x] 4.1 (P) Awareness state filtering and mutation-free disconnect — _Req 1.1, 1.2, 1.4_
- [x] 4.2 (P) Cursor widget construction, equality, avatar fallback — _Req 3.4, 3.5_

- [x] 5. Integration Tests for Multi-Client Collaborative Scenarios
- [x] 5.1 Awareness update flow to EditingUserList — _Req 1.3, 2.1, 2.4_
- [x] 5.2 Cursor position broadcasting and remote rendering — _Req 3.6, 3.7_

- [x] 6. Add baseTheme with Overlay Positioning, Hover, and Opacity Rules
- [x] 6.1 (P) Cursor overlay CSS rules — _Req 3.1, 3.2, 3.3, 3.8, 3.9_
- [x] 6.2 (P) Off-screen container and indicator styles — _Req 4.5, 4.7_

- [x] 7. Rework RichCaretWidget for Overlay Avatar with Activity State
- [x] 7.1 Widget DOM: overlay flag, avatar/initials, hover name label, isActive — _Req 3.1–3.5, 3.10_
- [x] 7.2 Activity tracking with per-client timers (3s inactivity) — _Req 3.10_

- [x] 8. Build Off-Screen Cursor Indicators
- [x] 8.1 Persistent off-screen containers on editor DOM — _Req 4.7_
- [x] 8.2 Classify cursors by visible range, render indicators — _Req 4.1–4.6_

- [x] 9. Unit Tests for Updated Widget and Off-Screen Indicators
- [x] 9.1 (P) Widget DOM structure, sizing, isActive, borderColor — _Req 3.1–3.5, 3.10_
- [x] 9.2 (P) Off-screen indicator DOM, Material Symbols arrow, avatar fallback — _Req 4.1, 4.2, 4.4, 4.9_

- [x] 10. Integration Tests for Viewport Classification and Activity Tracking
- [x] 10.1 Off-screen exclusion from widget decorations — _Req 4.3, 4.6_
- [x] 10.2 Activity tracking timer lifecycle (fake timers) — _Req 3.10_

- [x] 12. Fix Off-Screen Visibility Classification
- [x] 12.1 Multi-mode classification: rangedMode / coordsMode / degenerate — _Req 4.1–4.3, 4.6_
- [x] 12.2 Integration test for render-buffer cursor → off-screen indicator — _Req 4.3, 4.6_

- [ ]\* 11. E2E Tests for Hover, Opacity, and Off-Screen Transitions (deferred)
- [ ]\* 11.1 (P) Hover behavior on cursor overlay flag — _Req 3.3, 3.9_
- [ ]\* 11.2 (P) Off-screen indicator visibility on scroll — _Req 4.1–4.3, 4.6_

---

## Phase 2: Color-Matched Avatars & Click-to-Scroll (Requirements 5–6)

- [x] 13. Scroll callback infrastructure
- [x] 13.1 (P) Create a Jotai atom for storing the scroll-to-remote-cursor callback
  - Define an atom that holds either a scroll function accepting a client ID or null
  - Export a reader hook and a setter hook, following the same pattern as the existing editing-clients atom
  - _Requirements: 6.1_

- [x] 13.2 (P) Extend the collaborative editor mode hook to create and register a scroll-to-remote-cursor function
  - Add a new callback option to the hook's configuration that receives the scroll function when the provider and document are ready, and null on cleanup
  - The scroll function reads the target user's cursor position from awareness, resolves the Yjs relative position to an absolute document index, and dispatches a vertically centered scroll command to the CodeMirror editor view
  - Guard against missing cursor data and unmounted editor view by returning silently
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 14. (P) Update EditingUserList with color-matched borders and click-to-scroll
  - Replace the fixed blue border on each avatar with a wrapper element whose border color matches the user's cursor color from the awareness state
  - Accept a new click callback prop and wrap each avatar in a clickable element with pointer cursor styling
  - Replace the generic UserPictureList component in the overflow popover with inline rendering so that color-matched borders and click handling apply to all avatars consistently
  - _Requirements: 5.1, 5.2, 5.3, 6.4, 6.5_

- [x] 15. Connect all components end-to-end
  - Bridge the scroll-ready callback through the main editor component's props into the collaborative editor mode hook
  - Wire the page editor to store the received scroll callback in the Jotai atom
  - Wire the editor navbar to read the atom and pass the scroll function to the editing user list as the click callback
  - Verify that clicking an avatar scrolls the editor to that user's remote cursor position; verify no-op for users without a cursor
  - _Requirements: 6.1, 6.5_

- [x]\* 16. Test coverage for color-matched borders and click-to-scroll
- [x]\* 16.1 (P) Unit tests for EditingUserList rendering and click behavior
  - Verify that each avatar renders a colored border matching the user's cursor color instead of the fixed blue
  - Verify that clicking an avatar invokes the callback with the correct client ID
  - Verify that overflow popover avatars also invoke the callback on click
  - _Requirements: 5.1, 6.4, 6.5_

- [x]\* 16.2 (P) Integration test for the scroll function in the collaborative editor mode hook
  - Verify that the configuration callback receives a function when the provider is set up
  - Verify that calling the scroll function with a valid remote client ID dispatches a centered scroll effect to the editor view
  - Verify that calling the scroll function for a client without a cursor position is a silent no-op
  - _Requirements: 6.1, 6.2, 6.3_

---

## Phase 3: Off-Screen Indicator Click & Username Tooltip (Requirements 6.6–6.7, 7)

- [ ] 17. Add click-to-scroll to off-screen cursor indicators
- [ ] 17.1 Extend the off-screen indicator to accept and fire a click callback
  - Add a user identifier and an optional click callback to the indicator creation options
  - Attach a click event listener on the indicator's root element that invokes the callback with the user identifier
  - Apply pointer cursor styling when a click handler is provided; omit it when not
  - _Requirements: 6.6, 6.7_

- [ ] 17.2 Wire the scroll function to off-screen indicators via a mutable ref in the editor mode hook
  - Accept a mutable ref option in the rich cursor extension factory for the indicator click callback
  - When building off-screen indicators, pass the ref's current value as the click handler for each indicator
  - In the collaborative editor mode hook, create the mutable ref alongside the extension, write the existing scroll function to it when the provider is ready, and clear it on cleanup
  - _Requirements: 6.6_

- [ ] 18. (P) Refactor the UserPicture component to eliminate the tooltip higher-order component
  - Remove the higher-order component that wraps the root element and tooltip in a React Fragment
  - Render the tooltip directly within the component's render body as a child of the root element, conditionally based on the noTooltip flag
  - Preserve the dynamic import for the tooltip component so that consumers who suppress tooltips never trigger the tooltip chunk load
  - Move the ref for tooltip targeting into the component body (unconditional call) and pass it to the root element via its existing forwardRef support
  - The root element is always a single span, making it safe inside flex containers
  - _Requirements: 7.1, 7.3, 7.4, 7.5_

- [ ] 19. Enable the native UserPicture tooltip in EditingUserList
  - Remove the tooltip-suppression flag from UserPicture in the avatar wrapper so the built-in tooltip renders automatically for all avatars
  - Both the first-four direct avatars and the overflow popover avatars use the same wrapper, so tooltips appear uniformly
  - _Requirements: 7.2_
  - _Depends on: Task 18_

- [ ]\* 20. Test coverage for off-screen click and tooltip refactoring
- [ ]\* 20.1 (P) Unit tests for off-screen indicator click behavior
  - Verify the indicator root has pointer cursor when a click handler is provided
  - Verify clicking the indicator calls the callback with the correct user identifier
  - Verify no click handler or pointer cursor when the callback is omitted
  - _Requirements: 6.6, 6.7_

- [ ]\* 20.2 (P) Integration test for off-screen indicator scroll wiring
  - Verify that when the mutable ref holds a function and an off-screen indicator is clicked, the function is called with the correct user identifier
  - Verify that clicking when the ref is null does not throw
  - _Requirements: 6.6_

- [ ]\* 20.3 (P) Unit tests for UserPicture tooltip refactoring
  - Verify that without the tooltip-suppression flag, the component renders a single root element containing the image and a portal tooltip
  - Verify that with the tooltip-suppression flag, only the image is rendered inside the root element
  - Verify tooltip content includes the username prefix and display name
  - _Requirements: 7.1, 7.3, 7.4_

- [ ]\* 20.4 Unit tests for EditingUserList tooltip integration
  - Verify the avatar wrapper renders UserPicture without the tooltip-suppression flag
  - Verify tooltips are present for both direct avatars and overflow popover avatars
  - _Requirements: 7.2_
