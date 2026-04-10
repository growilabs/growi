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
