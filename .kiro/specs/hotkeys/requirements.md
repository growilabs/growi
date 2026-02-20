# Requirements Document

## Introduction

GROWI currently uses `react-hotkeys` (v2.0.0, 91 modules in async chunk) to manage keyboard shortcuts via a custom subscriber pattern. The library is identified as an optimization target due to its module footprint. This specification covers the migration from `react-hotkeys` to `tinykeys`, a lightweight (~400B) keyboard shortcut library, while preserving all existing hotkey functionality and the subscriber-based architecture.

### Current Architecture Overview

- **HotkeysDetector**: Wraps `react-hotkeys`'s `GlobalHotKeys` to capture key events and convert them to custom key expressions
- **HotkeyStroke**: State machine model for multi-key sequence detection (e.g., Konami codes)
- **HotkeysManager**: Orchestrator that maps strokes to subscriber components and manages their lifecycle
- **Subscribers**: 6 components (CreatePage, EditPage, FocusToGlobalSearch, ShowShortcutsModal, ShowStaffCredit, SwitchToMirrorMode) that self-define hotkeys via static `getHotkeyStrokes()`

### Registered Hotkeys

| Shortcut | Action |
|----------|--------|
| `c` | Open page creation modal |
| `e` | Start page editing |
| `/` | Focus global search |
| `Ctrl+/` or `Meta+/` | Open shortcuts help modal |
| `↑↑↓↓←→←→BA` | Show staff credits (Konami code) |
| `XXBBAAYYA↓←` | Switch to mirror mode (Konami code) |

## Requirements

### Requirement 1: Replace react-hotkeys Dependency with tinykeys

**Objective:** As a developer, I want to replace `react-hotkeys` with `tinykeys`, so that the application's async chunk module count is reduced and the hotkey system uses a modern, lightweight library.

#### Acceptance Criteria

1. The GROWI application shall use `tinykeys` as the keyboard shortcut library instead of `react-hotkeys`.
2. When the migration is complete, the `react-hotkeys` package shall be removed from `package.json` dependencies.
3. The GROWI application shall not increase the total async chunk module count compared to the current `react-hotkeys` implementation.

### Requirement 2: Preserve Single-Key Shortcut Functionality

**Objective:** As a user, I want single-key shortcuts to continue working after the migration, so that my workflow is not disrupted.

#### Acceptance Criteria

1. When the user presses the `c` key (outside an input/textarea/editable element), the Hotkeys system shall open the page creation modal.
2. When the user presses the `e` key (outside an input/textarea/editable element), the Hotkeys system shall start page editing if the page is editable and no modal is open.
3. When the user presses the `/` key (outside an input/textarea/editable element), the Hotkeys system shall open the global search modal.

### Requirement 3: Preserve Modifier-Key Shortcut Functionality

**Objective:** As a user, I want modifier-key shortcuts to continue working after the migration, so that keyboard shortcut help remains accessible.

#### Acceptance Criteria

1. When the user presses `Ctrl+/` (or `Meta+/` on macOS), the Hotkeys system shall open the shortcuts help modal.

### Requirement 4: Preserve Multi-Key Sequence (Konami Code) Functionality

**Objective:** As a user, I want multi-key sequences (Konami codes) to continue working after the migration, so that easter egg features remain accessible.

#### Acceptance Criteria

1. When the user enters the key sequence `↑↑↓↓←→←→BA`, the Hotkeys system shall show the staff credits modal.
2. When the user enters the key sequence `XXBBAAYYA↓←`, the Hotkeys system shall apply the mirror mode CSS class to the document body.
3. While a multi-key sequence is in progress, the Hotkeys system shall track partial matches and reset if an incorrect key is pressed.

### Requirement 5: Input Element Focus Guard

**Objective:** As a user, I want single-key shortcuts to not fire when I am typing in an input field, so that keyboard shortcuts do not interfere with text entry.

#### Acceptance Criteria

1. While an `<input>`, `<textarea>`, or `contenteditable` element is focused, the Hotkeys system shall suppress single-key shortcuts (e.g., `c`, `e`, `/`).
2. While an `<input>`, `<textarea>`, or `contenteditable` element is focused, the Hotkeys system shall still allow modifier-key shortcuts (e.g., `Ctrl+/`).

### Requirement 6: Lifecycle Management and Cleanup

**Objective:** As a developer, I want hotkey bindings to be properly registered and cleaned up on component mount/unmount, so that there are no memory leaks or stale handlers.

#### Acceptance Criteria

1. When a layout component (BasicLayout or AdminLayout) mounts, the Hotkeys system shall register all hotkey bindings.
2. When a layout component unmounts, the Hotkeys system shall unsubscribe all hotkey bindings.
3. The Hotkeys system shall provide a cleanup mechanism compatible with React's `useEffect` return pattern.

### Requirement 7: Maintain Subscriber Component Architecture

**Objective:** As a developer, I want the subscriber-based architecture to be preserved or appropriately modernized, so that adding or modifying hotkeys remains straightforward.

#### Acceptance Criteria

1. The Hotkeys system shall support a pattern where each hotkey action is defined as an independent unit (component or handler) with its own key binding definition.
2. When a new hotkey action is added, the developer shall be able to define it without modifying the core hotkey detection logic.
3. The Hotkeys system shall support dynamic rendering of subscriber components when their associated hotkey fires.

### Requirement 8: TypeScript Migration

**Objective:** As a developer, I want the migrated hotkey system to use TypeScript, so that the code benefits from type safety and better IDE support.

#### Acceptance Criteria

1. The Hotkeys system shall be implemented in TypeScript (`.ts`/`.tsx` files) rather than JavaScript (`.js`/`.jsx`).
2. The Hotkeys system shall export typed interfaces for hotkey definitions and handler signatures.
