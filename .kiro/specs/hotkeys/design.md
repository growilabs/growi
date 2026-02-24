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
| `src/client/components/Hotkeys/Subscribers/*.tsx` | Individual action handlers rendered when their hotkey fires |
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

### D2: Subscriber-Owned Binding Definitions

**Decision**: Each subscriber component exports its own `hotkeyBindings` metadata alongside its React component. `HotkeysManager` imports these definitions and auto-builds the tinykeys binding map — it never hardcodes specific keys or subscriber references.

**Rationale**:
- True "1 module = 1 hotkey" encapsulation: each subscriber owns its key binding, handler category, and action logic
- Adding a new hotkey requires creating only one file (the new subscriber); `HotkeysManager` needs no modification
- Fully satisfies Req 7 AC 2 ("define hotkey without modifying core detection logic")
- Self-documenting: looking at a subscriber file tells you everything about that hotkey

**Type contract**:
```typescript
// Shared type definition in HotkeysManager.tsx or a shared types file
type HotkeyCategory = 'single' | 'modifier';

type HotkeyBindingDef = {
  keys: string | string[];   // tinykeys key expression(s)
  category: HotkeyCategory;  // determines handler wrapper (single = input guard, modifier = no guard)
};

type HotkeySubscriber = {
  component: React.ComponentType<{ onDeleteRender: () => void }>;
  bindings: HotkeyBindingDef;
};
```

**Subscriber example**:
```typescript
// CreatePage.tsx
export const hotkeyBindings: HotkeyBindingDef = {
  keys: 'c',
  category: 'single',
};

export const CreatePage = ({ onDeleteRender }: Props): null => { /* ... */ };
```

```typescript
// ShowShortcutsModal.tsx
export const hotkeyBindings: HotkeyBindingDef = {
  keys: ['Control+/', 'Meta+/'],
  category: 'modifier',
};
```

**HotkeysManager usage**:
```typescript
// HotkeysManager.tsx
import * as createPage from './Subscribers/CreatePage';
import * as editPage from './Subscribers/EditPage';
// ... other subscribers

const subscribers: HotkeySubscriber[] = [
  { component: createPage.CreatePage, bindings: createPage.hotkeyBindings },
  { component: editPage.EditPage, bindings: editPage.hotkeyBindings },
  // ...
];

// In useEffect: iterate subscribers to build tinykeys binding map
```

**Trade-off**: Slightly more structure than a plain object literal, but the pattern is minimal and each subscriber file is fully self-contained.

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
| Req 8 AC 2: "export typed interfaces for hotkey definitions" | `HotkeyBindingDef` and `HotkeySubscriber` types are exported for subscriber use but not published as a package API | These types are internal to the Hotkeys module; no external consumers need them |

> **Note (task 5)**: Req 8 AC 1 is now fully satisfied — all 6 subscriber components converted from `.jsx` to `.tsx` with TypeScript `Props` types and named exports.
> **Note (D2 revision)**: Req 7 AC 2 is now fully satisfied — subscriber-owned binding definitions mean adding a hotkey requires only creating a new subscriber file.

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
