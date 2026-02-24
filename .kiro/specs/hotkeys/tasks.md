# Implementation Tasks

All tasks completed as part of `reduce-modules-loaded` spec (iteration 8.7).

## Tasks

- [x] 1. Write HotkeysManager tests
  - Created `HotkeysManager.spec.tsx` with 6 tests covering single-key triggers, modifier-key triggers, and input element suppression
  - Used TDD: tests written before implementation (RED phase)
  - _Requirements: 2, 3, 5_

- [x] 2. Rewrite HotkeysManager with tinykeys
  - Installed `tinykeys` v3.0.0 as dependency
  - Rewrote `HotkeysManager.jsx` → `HotkeysManager.tsx` using `tinykeys` directly
  - Centralized all key bindings as inline object literal
  - Implemented `isEditableTarget()` guard for single-key shortcuts
  - Separated `singleKeyHandler` (with input guard) and `modifierKeyHandler` (no guard)
  - All 6 tests pass (GREEN phase)
  - _Requirements: 1, 2, 3, 4, 5, 6, 8_

- [x] 3. Remove legacy hotkey infrastructure
  - Deleted `HotkeysDetector.jsx` (react-hotkeys GlobalHotKeys wrapper)
  - Deleted `HotkeyStroke.js` (custom key-sequence state machine)
  - Removed `getHotkeyStrokes()` static methods from all 6 subscriber components
  - Removed `react-hotkeys` from package.json dependencies
  - _Requirements: 1, 7_

- [x] 4. Verify quality and module reduction
  - lint:biome: pass
  - lint:typecheck: pass (via build)
  - Tests: 6/6 pass
  - ChunkModuleStats: async-only 4,608 → 4,516 (-92 modules)
  - _Requirements: 1_

- [x] 5. Refactor subscriber components to match ideal patterns
  - Converted 4 JSX files to TypeScript: CreatePage, FocusToGlobalSearch, ShowStaffCredit, SwitchToMirrorMode
  - Fixed `onDeleteRender(this)` bug in 3 files — `this` is undefined in functional components; changed to `onDeleteRender()`
  - Replaced PropTypes with TypeScript `Props` type in all subscribers
  - Removed unnecessary `React.memo` wrapper from CreatePage
  - Unified return values: `return null` for logic-only components (ShowShortcutsModal also updated)
  - Converted all 6 subscribers from default exports to named exports; updated HotkeysManager imports
  - Tests: 6/6 pass, lint:typecheck: pass, lint:biome: pass
  - _Requirements: 7, 8_
