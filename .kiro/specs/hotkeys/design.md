# Technical Design

## Architecture Overview

The GROWI hotkey system manages keyboard shortcuts globally. It uses `tinykeys` (~400 byte) as the key binding engine and a **subscriber component pattern** to execute actions when hotkeys fire.

### Component Diagram

```
BasicLayout / AdminLayout
  └─ HotkeysManager (loaded via next/dynamic, ssr: false)
       ├─ tinykeys(window, bindings) — registers all key bindings
       └─ renders subscriber components on demand:
            ├─ EditPage
            ├─ CreatePage
            ├─ FocusToGlobalSearch
            ├─ ShowShortcutsModal
            ├─ ShowStaffCredit
            └─ SwitchToMirrorMode
```

### Key Files

| File | Role |
|------|------|
| `src/client/components/Hotkeys/HotkeysManager.tsx` | Core orchestrator — binds all keys via tinykeys, renders subscribers |
| `src/client/components/Hotkeys/Subscribers/*.{tsx,jsx}` | Individual action handlers rendered when their hotkey fires |
| `src/components/Layout/BasicLayout.tsx` | Mounts HotkeysManager via `next/dynamic({ ssr: false })` |
| `src/components/Layout/AdminLayout.tsx` | Mounts HotkeysManager via `next/dynamic({ ssr: false })` |

## Design Decisions

### D1: tinykeys as Binding Engine

**Decision**: Use `tinykeys` (v3) instead of `react-hotkeys` (v2).

**Rationale**:
- `react-hotkeys` contributes 91 modules to async chunks; `tinykeys` is 1 module (~400 bytes)
- tinykeys natively supports single keys, modifier combos (`Control+/`), and multi-key sequences (`ArrowUp ArrowUp ...`)
- No need for custom state machine (`HotkeyStroke`) or detection wrapper (`HotkeysDetector`)

**Trade-off**: tinykeys has no React integration — key binding is done imperatively in a `useEffect` hook rather than declaratively via JSX props. This is acceptable given the simplicity of the binding map.

### D2: Centralized Binding Map

**Decision**: All key bindings are defined inline in `HotkeysManager.tsx` rather than distributed across subscriber components.

**Rationale**:
- Eliminates the need for `getHotkeyStrokes()` static methods on each subscriber
- Removes the `HotkeysDetector` intermediary layer
- All bindings are visible in one place, making the mapping easy to audit

**Trade-off**: Adding a new hotkey requires editing `HotkeysManager.tsx` (violates Req 7 AC 2's ideal of zero-touch core). This is an acceptable trade-off — the binding map is a simple object literal and changes are trivial.

### D3: Subscriber Render-on-Fire Pattern

**Decision**: Subscriber components are rendered into the React tree only when their hotkey fires, and self-remove after executing their action.

**Rationale**:
- Preserves the existing GROWI pattern where hotkey actions need access to React hooks (Jotai atoms, SWR, i18n, routing)
- Components call `onDeleteRender()` after completing their effect to clean up
- Uses a monotonically incrementing key ref to avoid React key collisions

### D4: Two Handler Categories

**Decision**: `singleKeyHandler` and `modifierKeyHandler` are separated.

**Rationale**:
- Single-key shortcuts (`e`, `c`, `/`) must be suppressed when the user is typing in input/textarea/contenteditable elements
- Modifier-key shortcuts (`Control+/`, `Meta+/`) and multi-key sequences should fire regardless of focus, as they are unlikely to conflict with text entry
- `isEditableTarget()` check is applied only to single-key handlers

### D5: Client-Only Loading

**Decision**: HotkeysManager is loaded via `next/dynamic({ ssr: false })`.

**Rationale**:
- Keyboard events are client-only; no SSR rendering is needed
- Dynamic import keeps hotkey modules out of initial server-rendered chunks
- Both BasicLayout and AdminLayout follow this pattern

## Implementation Deviations from Requirements

| Requirement | Deviation | Justification |
|-------------|-----------|---------------|
| Req 7 AC 2: "define hotkey without modifying core detection logic" | Adding a new hotkey requires editing HotkeysManager.tsx's binding map | Binding map is a trivial object literal; the simplification from removing HotkeysDetector + getHotkeyStrokes outweighs the minor editing cost |
| Req 8 AC 2: "export typed interfaces for hotkey definitions" | `SubscriberComponent` type is internal only, not exported | No external consumers need the type; exporting it would be unnecessary API surface |

## Key Binding Format (tinykeys)

| Category | Format | Example |
|----------|--------|---------|
| Single key | `"key"` | `e`, `c`, `"/"` |
| Modifier combo | `"Modifier+key"` | `"Control+/"`, `"Meta+/"` |
| Multi-key sequence | `"key1 key2 key3 ..."` (space-separated) | `"ArrowUp ArrowUp ArrowDown ArrowDown ..."` |
| Platform modifier | `"$mod+key"` | `"$mod+/"` (Control on Windows/Linux, Meta on macOS) |

> Note: The current implementation uses explicit `Control+/` and `Meta+/` rather than `$mod+/` to match the original behavior.

## Test Strategy

Tests are in `HotkeysManager.spec.tsx` using Vitest + @testing-library/react.

**Key testing concern**: jsdom does not properly implement `KeyboardEvent.getModifierState()`. The test helper `pressKey()` uses `Object.defineProperty` to override `getModifierState` so that tinykeys can correctly detect modifier keys in the test environment.

**Coverage**:
- Single-key triggers (e, c, /)
- Modifier-key trigger (Ctrl+/)
- Input element suppression (input, textarea)
