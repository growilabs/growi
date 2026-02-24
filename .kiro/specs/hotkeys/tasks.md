# Implementation Tasks

## Completed Tasks (tinykeys migration — iteration 8.7)

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

## New Tasks (D2 revision — subscriber-owned binding definitions)

- [x] 6. Refactor hotkey bindings to subscriber-owned definitions
- [x] 6.1 Define shared hotkey binding types and add binding exports to all subscribers
  - Exported `HotkeyCategory`, `HotkeyBindingDef` types from HotkeysManager.tsx
  - Each of the 6 subscriber components now exports `hotkeyBindings: HotkeyBindingDef` alongside its component
  - Single-key subscribers (c, e, /) declare category 'single'; modifier and sequence subscribers (Ctrl+/, Konami codes) declare category 'modifier'
  - Binding definitions use tinykeys key format; ShowShortcutsModal uses array for `['Control+/', 'Meta+/']`
  - _Requirements: 7, 8_

- [x] 6.2 Refactor HotkeysManager to build binding map from subscriber exports
  - Replaced inline key-to-component mapping with `subscribers[]` array built from `import *` namespace imports
  - `createHandler()` applies input guard based on each subscriber's declared category ('single' vs 'modifier')
  - Dynamic `bindingMap` iteration builds the tinykeys binding object — HotkeysManager has no hardcoded key knowledge
  - Cleanup via tinykeys unsubscribe preserved in useEffect return
  - Updated test mocks to include `hotkeyBindings` exports
  - _Requirements: 6, 7_

- [x] 7. Verify refactoring preserves all existing behavior
  - Tests: 6/6 pass (behavior unchanged)
  - lint:typecheck: pass
  - lint:biome: pass (no errors at diagnostic-level=error)
  - _Requirements: 1, 2, 3, 4, 5_

## Requirements Coverage

| Requirement | Tasks |
|-------------|-------|
| 1. Replace react-hotkeys with tinykeys | 2, 3, 4, 7 |
| 2. Preserve single-key shortcuts | 1, 2, 7 |
| 3. Preserve modifier-key shortcuts | 1, 2, 7 |
| 4. Preserve multi-key sequences | 2, 7 |
| 5. Input element focus guard | 1, 2, 7 |
| 6. Lifecycle management and cleanup | 2, 6.2 |
| 7. Subscriber component architecture | 3, 5, 6.1, 6.2 |
| 8. TypeScript migration | 2, 5, 6.1 |
