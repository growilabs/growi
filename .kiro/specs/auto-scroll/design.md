# Design Document: auto-scroll

## Overview

**Purpose**: This feature provides a reusable hash-based auto-scroll mechanism that handles lazy-rendered content across GROWI's Markdown views. It compensates for layout shifts caused by asynchronous component rendering (e.g., Drawio diagrams, Mermaid charts, PlantUML images) by detecting in-progress renders and re-scrolling to the target.

**Users**: End users navigating to hash-linked sections benefit from reliable scroll positioning. Developers integrating the hook into new views (PageView, SearchResultContent, future views) benefit from a standardized, configurable API.

**Impact**: Refactors the existing `useHashAutoScroll` hook from a PageView-specific implementation into a shared, configurable hook. Renames and updates the rendering status attribute protocol for clarity and declarative usage. Also integrates hash-based auto-scroll into `SearchResultContent`, where the content pane has an independent scroll container.

### Goals
- Provide a single reusable hook for hash-based auto-scroll across all content views
- Support customizable target resolution and scroll behavior per caller
- Establish a clear, declarative rendering-status attribute protocol for async-rendering components
- Maintain robust resource cleanup with timeout-based safety bounds
- Integrate `SearchResultContent` as a second consumer with container-relative scroll strategy

### Non-Goals
- Adding `data-growi-is-content-rendering` to attachment-refs (Ref/Refs/RefImg/RefsImg/Gallery), or RichAttachment — these also cause layout shifts but require more complex integration; deferred to follow-up
- Replacing SearchResultContent's keyword-highlight scroll with hash-based scroll (search pages have no URL hash)
- Supporting non-browser environments (SSR) — this is a client-only hook

## Architecture

### Existing Architecture Analysis

The current implementation lives in `apps/app/src/components/PageView/use-hash-auto-scroll.tsx`, tightly coupled to PageView via:
- Hardcoded `document.getElementById(targetId)` for target resolution
- Hardcoded `element.scrollIntoView()` for scroll execution
- First parameter named `pageId` implying page-specific usage

The rendering attribute `data-growi-rendering` is defined in `@growi/core` and consumed by:
- `remark-drawio` (sets attribute on render start, removes on completion)
- `use-hash-auto-scroll` (observes attribute presence via MutationObserver)

### Architecture Pattern & Boundary Map

> **Note**: This diagram reflects the final architecture after Task 8 module reorganization. See "Task 8 Design" section below for the migration details.

```mermaid
graph TB
    subgraph growi_core[growi core]
        CONST[Rendering Status Constants]
    end

    subgraph shared_util[src/client/util]
        WATCH[watchRenderingAndReScroll]
    end

    subgraph page_view[src/components/PageView]
        UHAS[useHashAutoScroll]
        PV[PageView]
    end

    subgraph search[features/search/.../SearchPage]
        UKR[useKeywordRescroll]
        SRC[SearchResultContent]
    end

    subgraph renderers[Async Renderers]
        DV[DrawioViewer]
        MV[MermaidViewer]
        PUV[PlantUmlViewer]
        LSX[Lsx]
    end

    PV -->|calls| UHAS
    UHAS -->|imports| WATCH
    SRC -->|calls| UKR
    UKR -->|imports| WATCH
    WATCH -->|queries| CONST
    DV -->|sets/toggles| CONST
    MV -->|sets/toggles| CONST
    PUV -->|sets/toggles| CONST
    LSX -->|sets/toggles| CONST
```

**Architecture Integration**:
- Selected pattern: Co-located hooks per consumer + shared utility function — idiomatic React, testable, minimal coupling
- Domain boundaries: `watchRenderingAndReScroll` (shared pure function) in `src/client/util/`, consumer-specific hooks co-located with their components, constants in `@growi/core`, attribute lifecycle in each renderer package
- Existing patterns preserved: MutationObserver + polling hybrid, timeout-based safety bounds
- Steering compliance: Named exports, immutable patterns, co-located tests

**Co-location rationale**: `watchRenderingAndReScroll` lives in `src/client/util/` (not `hooks/`) because it is a plain function, not a React hook — co-located with `smooth-scroll.ts` as both are DOM scroll utilities. `useHashAutoScroll` lives next to `PageView.tsx` because it is hash-navigation–specific (`window.location.hash`) and PageView is its only consumer. `useKeywordRescroll` lives next to `SearchResultContent.tsx` for the same reason. The old `src/client/hooks/use-content-auto-scroll/` shared directory was removed because the hook was never truly shared — only the underlying utility function was.

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Frontend | React 18 hooks (`useEffect`) | Hook lifecycle management | No new dependencies |
| Browser API | MutationObserver, `setTimeout`, `requestAnimationFrame` | DOM observation, polling, and layout timing | Standard Web APIs |
| Shared Constants | `@growi/core` | Rendering attribute definitions | Existing package |

No new external dependencies are introduced.

## System Flows

### Auto-Scroll Lifecycle

```mermaid
sequenceDiagram
    participant Caller as Content View (PageView)
    participant Hook as useHashAutoScroll
    participant DOM as DOM
    participant Watch as watchRenderingAndReScroll

    Caller->>Hook: useHashAutoScroll options
    Hook->>Hook: Guard checks key, hash, container

    alt Target exists in DOM
        Hook->>DOM: resolveTarget
        DOM-->>Hook: HTMLElement
        Hook->>DOM: scrollTo target
        Hook->>Watch: start rendering watch (always)
    else Target not yet in DOM
        Hook->>DOM: MutationObserver on container
        DOM-->>Hook: target appears
        Hook->>DOM: scrollTo target
        Hook->>Watch: start rendering watch (always)
    end

    Note over Watch: MutationObserver detects rendering elements,<br/>including those that mount after the initial scroll

    loop While rendering elements exist and within timeout
        Watch->>DOM: query rendering-status attr
        DOM-->>Watch: elements found
        Watch-->>Watch: wait 5s
        Watch->>DOM: scrollTo target
    end

    Note over Watch: Auto-cleanup after 10s timeout
```

Key decisions:
- The two-phase approach (target observation → rendering watch) runs sequentially.
- The rendering watch uses a non-resetting timer to prevent starvation from rapid DOM mutations.
- **The rendering watch always starts after the initial scroll**, regardless of whether rendering elements exist at that moment. This is necessary because async renderers (Mermaid loaded via `dynamic()`, PlantUML images) may mount into the DOM *after* the hook's effect runs. The MutationObserver inside `watchRenderingAndReScroll` (`childList: true, subtree: true`) detects these late-mounting elements.

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1, 1.2 | Immediate scroll to hash target | useHashAutoScroll | UseHashAutoScrollOptions.resolveTarget | Auto-Scroll Lifecycle |
| 1.3, 1.4, 1.5 | Guard conditions | useHashAutoScroll | UseHashAutoScrollOptions.key, contentContainerId | — |
| 2.1, 2.2, 2.3 | Deferred scroll for lazy targets | useHashAutoScroll (target observer) | — | Auto-Scroll Lifecycle |
| 3.1–3.6 | Re-scroll after rendering | watchRenderingAndReScroll | scrollToTarget callback | Auto-Scroll Lifecycle |
| 4.1–4.7 | Rendering attribute protocol | Rendering Status Constants, DrawioViewer, MermaidViewer, PlantUmlViewer, Lsx | GROWI_IS_CONTENT_RENDERING_ATTR | — |
| 4.8 | ResizeObserver re-render cycle | DrawioViewer | GROWI_IS_CONTENT_RENDERING_ATTR | — |
| 5.1–5.5 | Page-type agnostic design | watchRenderingAndReScroll (shared), useHashAutoScroll (PageView), useKeywordRescroll (Search) | — | — |
| 5.6, 5.7, 6.1–6.3 | Cleanup and safety | useHashAutoScroll, useKeywordRescroll, watchRenderingAndReScroll | cleanup functions | — |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies | Contracts |
|-----------|--------------|--------|--------------|------------------|-----------|
| useHashAutoScroll | src/components/PageView | Hash-based auto-scroll hook for PageView with configurable target resolution and scroll behavior | 1, 2, 5, 6 | watchRenderingAndReScroll (P0), Rendering Status Constants (P1) | Service |
| useKeywordRescroll | features/search/.../SearchPage | Keyword-highlight scroll hook with rendering watch integration for SearchResultContent | 5, 6 | watchRenderingAndReScroll (P0), scrollWithinContainer (P0) | Service |
| watchRenderingAndReScroll | src/client/util | Shared utility: polls for rendering-status attributes and re-scrolls until complete or timeout | 3, 6 | Rendering Status Constants (P0) | Service |
| Rendering Status Constants | @growi/core | Shared attribute name, value, and selector constants | 4 | None | State |
| DrawioViewer (modification) | remark-drawio | Declarative rendering-status attribute toggle | 4.3, 4.4, 4.8 | Rendering Status Constants (P0) | State |
| MermaidViewer (modification) | features/mermaid | Add rendering-status attribute lifecycle to async SVG render | 4.3, 4.4, 4.7 | Rendering Status Constants (P0) | State |
| PlantUmlViewer (new) | features/plantuml | Wrap PlantUML `<img>` to provide rendering-status attribute lifecycle | 4.3, 4.4, 4.7 | Rendering Status Constants (P0) | State |
| Lsx (modification) | remark-lsx | Add rendering-status attribute lifecycle to async page list fetch | 4.3, 4.4, 4.7 | Rendering Status Constants (P0) | State |

### Client Hooks

#### useHashAutoScroll

| Field | Detail |
|-------|--------|
| Intent | Hash-based auto-scroll hook for PageView that scrolls to a target element identified by URL hash, with support for lazy-rendered content and customizable scroll behavior |
| Requirements | 1.1–1.5, 2.1–2.3, 5.1–5.7, 6.1–6.3 |

**Responsibilities & Constraints**
- Orchestrates the full hash-based auto-scroll lifecycle: guard → resolve target → scroll → watch rendering
- Always delegates to `watchRenderingAndReScroll` after the initial scroll — does **not** skip the watch even when no rendering elements are present at scroll time, because async renderers may mount later
- Co-located with `PageView.tsx` — this hook is hash-navigation–specific (`window.location.hash`)

**Dependencies**
- Outbound: `watchRenderingAndReScroll` from `~/client/util/watch-rendering-and-rescroll` (P0)

**Contracts**: Service [x]

##### Service Interface

```typescript
/** Configuration for the hash-based auto-scroll hook */
interface UseHashAutoScrollOptions {
  /**
   * Unique key that triggers re-execution when changed.
   * When null/undefined, all scroll processing is skipped.
   */
  key: string | undefined | null;

  /** DOM id of the content container element to observe */
  contentContainerId: string;

  /**
   * Optional function to resolve the scroll target element.
   * Receives the decoded hash string (without '#').
   * Defaults to: (hash) => document.getElementById(hash)
   */
  resolveTarget?: (decodedHash: string) => HTMLElement | null;

  /**
   * Optional function to scroll to the target element.
   * Defaults to: (el) => el.scrollIntoView()
   */
  scrollTo?: (target: HTMLElement) => void;
}

/** Hook signature */
function useHashAutoScroll(options: UseHashAutoScrollOptions): void;
```

- Preconditions: Called within a React component; browser environment with `window.location.hash` available
- Postconditions: On unmount or key change, all observers and timers are cleaned up
- Invariants: At most one target observer and one rendering watch active per hook instance

**Implementation Notes**
- File location: `apps/app/src/components/PageView/use-hash-auto-scroll.ts`
- Test file: `apps/app/src/components/PageView/use-hash-auto-scroll.spec.tsx`
- The `resolveTarget` and `scrollTo` callbacks should be wrapped in `useRef` to avoid re-triggering the effect when callback identity changes

---

#### useKeywordRescroll

| Field | Detail |
|-------|--------|
| Intent | Keyword-highlight scroll hook for SearchResultContent that scrolls to the first `.highlighted-keyword` element and re-scrolls after async renderers settle |
| Requirements | 5.1–5.7, 6.1–6.3 |

**Responsibilities & Constraints**
- MutationObserver on container for keyword highlight detection (debounced 500ms)
- `watchRenderingAndReScroll` integration for async renderer layout shift compensation
- Cleanup of both MO and rendering watch on key change or unmount
- Co-located with `SearchResultContent.tsx`

**Dependencies**
- Outbound: `watchRenderingAndReScroll` from `~/client/util/watch-rendering-and-rescroll` (P0)
- Outbound: `scrollWithinContainer` from `~/client/util/smooth-scroll` (P0)

**Contracts**: Service [x]

##### Service Interface

```typescript
interface UseKeywordRescrollOptions {
  /** Ref to the scrollable container element */
  scrollElementRef: RefObject<HTMLElement | null>;
  /** Unique key that triggers re-execution (typically page._id) */
  key: string;
}

function useKeywordRescroll(options: UseKeywordRescrollOptions): void;
```

- Preconditions: `scrollElementRef.current` is a mounted scroll container
- Postconditions: On unmount or key change, MO disconnected, rendering watch cleaned up, debounce cancelled

**Implementation Notes**
- File location: `apps/app/src/features/search/client/components/SearchPage/use-keyword-rescroll.ts`
- Test file: `apps/app/src/features/search/client/components/SearchPage/use-keyword-rescroll.spec.tsx`
- Helper functions (`scrollToKeyword`, `scrollToTargetWithinContainer`) are defined in the hook file since only this hook uses them

---

#### watchRenderingAndReScroll

| Field | Detail |
|-------|--------|
| Intent | Pure function (not a hook) that monitors rendering-status attributes and periodically re-scrolls until rendering completes or timeout. Shared utility consumed by both `useHashAutoScroll` and `useKeywordRescroll`. |
| Requirements | 3.1–3.6, 6.1–6.3 |

**Responsibilities & Constraints**
- Sets up MutationObserver to detect rendering-status attribute changes **and** new rendering elements added to the DOM (childList + subtree)
- Manages a non-resetting poll timer (5s interval)
- Enforces a hard timeout (10s) to prevent unbounded observation
- Returns a cleanup function

**Dependencies**
- External: `@growi/core` rendering status constants — attribute selector (P0)

**Contracts**: Service [x]

##### Service Interface

```typescript
/**
 * Watches for elements with in-progress rendering status in the container.
 * Periodically calls scrollToTarget while rendering elements remain.
 * Returns a cleanup function that stops observation and clears timers.
 */
function watchRenderingAndReScroll(
  contentContainer: HTMLElement,
  scrollToTarget: () => boolean,
): () => void;
```

- Preconditions: `contentContainer` is a mounted DOM element
- Postconditions: Cleanup function disconnects observer, clears all timers
- Invariants: At most one poll timer active at any time; stopped flag prevents post-cleanup execution

**Implementation Notes**
- File location: `apps/app/src/client/util/watch-rendering-and-rescroll.ts` (co-located with `smooth-scroll.ts`)
- Test file: `apps/app/src/client/util/watch-rendering-and-rescroll.spec.tsx`
- Add a `stopped` boolean flag checked inside timer callbacks to prevent race conditions between cleanup and queued timer execution
- When `checkAndSchedule` detects that no rendering elements remain and a timer is currently active, cancel the active timer immediately — avoids a redundant re-scroll after rendering has already completed
- The MutationObserver watches `childList`, `subtree`, and `attributes` (filtered to the rendering-status attribute) — the `childList` + `subtree` combination is what detects late-mounting async renderers
- **Performance trade-off**: The function is always started regardless of whether rendering elements exist at call time. This means one MutationObserver + one 10s cleanup timeout run for every hash navigation, even on pages with no async renderers. The initial `checkAndSchedule()` call returns early if no rendering elements are present, so no poll timer is ever scheduled in that case — the only cost is the MO observation and the 10s cleanup timeout itself, which is acceptable.
- **`querySelector` frequency**: The `checkAndSchedule` callback fires on every `childList` mutation (in addition to attribute changes). Each invocation runs `querySelector(GROWI_IS_CONTENT_RENDERING_SELECTOR)` on the container. This call is O(n) on the subtree but stops at the first match and is bounded by the 10s timeout, making it acceptable even for content-heavy pages.

---

### @growi/core Constants

#### Rendering Status Constants

| Field | Detail |
|-------|--------|
| Intent | Centralized constants for the rendering-status attribute name, values, and CSS selector |
| Requirements | 4.1, 4.2, 4.6 |

**Contracts**: State [x]

##### State Management

```typescript
/** Attribute name applied to elements during async content rendering */
const GROWI_IS_CONTENT_RENDERING_ATTR = 'data-growi-is-content-rendering' as const;

/**
 * CSS selector matching elements currently rendering.
 * Matches only the "true" state, not completed ("false").
 */
const GROWI_IS_CONTENT_RENDERING_SELECTOR =
  `[${GROWI_IS_CONTENT_RENDERING_ATTR}="true"]` as const;
```

- File location: `packages/core/src/consts/renderer.ts` (replaces existing constants)
- Old constants (`GROWI_RENDERING_ATTR`, `GROWI_RENDERING_ATTR_SELECTOR`) are removed and replaced — no backward compatibility shim needed since all consumers are updated in the same change

---

### remark-drawio Modifications

#### DrawioViewer (modification)

| Field | Detail |
|-------|--------|
| Intent | Adopt declarative attribute value toggling instead of imperative add/remove |
| Requirements | 4.3, 4.4, 4.8 |

**Implementation Notes**
- Replace `removeAttribute(GROWI_RENDERING_ATTR)` calls with `setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false')`
- Initial JSX: `{[GROWI_IS_CONTENT_RENDERING_ATTR]: 'true'}` (unchanged pattern, new constant name)
- Update `SUPPORTED_ATTRIBUTES` in `remark-drawio.ts` to use new constant name
- Update sanitize option to allow the new attribute name
- **ResizeObserver re-render cycle** (req 4.8): In the ResizeObserver handler, call `drawioContainerRef.current?.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true')` before `renderDrawioWithDebounce()`. The existing inner MutationObserver (childList) completion path already sets the attribute back to `"false"` after each render.

---

### MermaidViewer Modification

#### MermaidViewer (modification)

| Field | Detail |
|-------|--------|
| Intent | Add rendering-status attribute lifecycle to async `mermaid.render()` SVG rendering |
| Requirements | 4.3, 4.4, 4.7 |

**Implementation Notes**
- Set `data-growi-is-content-rendering="true"` on the container element at initial render (via JSX spread before `mermaid.render()` is called)
- After `mermaid.render()` completes and SVG is injected via `innerHTML`, delay the `"false"` signal using **`requestAnimationFrame`** so that the browser can compute the SVG layout before the auto-scroll system re-scrolls. Setting `"false"` synchronously after `innerHTML` assignment would signal completion before the browser has determined the element's final dimensions.
- Set attribute to `"false"` immediately (without rAF) in the error/catch path, since no layout shift is expected on error
- Cancel the pending rAF on effect cleanup to prevent state updates on unmounted components
- File: `apps/app/src/features/mermaid/components/MermaidViewer.tsx`
- The mermaid remark plugin sanitize options must be updated to include the new attribute name

---

### PlantUmlViewer (new component)

#### PlantUmlViewer

| Field | Detail |
|-------|--------|
| Intent | Wrap PlantUML image rendering in a component that signals rendering status, enabling the auto-scroll system to compensate for the layout shift when the external image loads |
| Requirements | 4.3, 4.4, 4.7 |

**Background**: PlantUML diagrams are rendered as `<img>` tags pointing to an external PlantUML server. The image load is asynchronous and causes a layout shift. The previous implementation had no `data-growi-is-content-rendering` support, so layout shifts from PlantUML images were never compensated.

**Implementation Notes**
- New component at `apps/app/src/features/plantuml/components/PlantUmlViewer.tsx`
- Wraps `<img>` in a `<div>` container with `data-growi-is-content-rendering="true"` initially
- Sets attribute to `"false"` via `onLoad` and `onError` handlers on the `<img>` element
- The plantuml remark plugin (`plantuml.ts`) is updated to output a custom `<plantuml src="...">` HAST element instead of a plain `<img>`. This allows the renderer to map the `plantuml` element to the `PlantUmlViewer` React component.
- `sanitizeOption` is exported from the plantuml service and merged in `renderer.tsx` (same pattern as drawio and mermaid)
- `PlantUmlViewer` is registered as `components.plantuml` in all view option generators (`generateViewOptions`, `generateSimpleViewOptions`, `generatePreviewOptions`)

---

### remark-lsx Modification

#### Lsx (modification)

| Field | Detail |
|-------|--------|
| Intent | Add rendering-status attribute lifecycle to async SWR page list fetching |
| Requirements | 4.3, 4.4, 4.7 |

**Implementation Notes**
- Set `data-growi-is-content-rendering="true"` on the outermost container element while `isLoading === true` (SWR fetch in progress)
- Set attribute to `"false"` when data arrives — whether success, error, or empty result
- Use declarative attribute binding via the existing `isLoading` state (no imperative DOM manipulation needed)
- File: `packages/remark-lsx/src/client/components/Lsx.tsx`
- The lsx remark plugin sanitize options must be updated to include the new attribute name
- `@growi/core` must be added as a dependency of `remark-lsx` (same pattern as `remark-drawio`)
- **SWR cache hit behavior**: When SWR returns a cached result immediately (`isLoading=false` on first render), the attribute starts at `"false"` and no re-scroll is triggered. This is correct: a cached result means the list renders without a layout shift, so no compensation is needed. The re-scroll mechanism only activates when `isLoading` starts as `"true"` (no cache) and transitions to `"false"` after the fetch completes.

---

### SearchResultContent Integration

#### SearchResultContent (modification)

| Field | Detail |
|-------|--------|
| Intent | Integrate rendering-watch into SearchResultContent's keyword scroll so that layout shifts from async renderers are compensated |
| Requirements | 5.1, 5.4, 5.5, 6.1 |

**Background**: `SearchResultContent` renders page content inside a div with `overflow-y-scroll` (`#search-result-content-body-container`). The keyword-highlight scroll mechanism was originally inlined as a `useEffect` with no dependency array and no cleanup.

**Post-Implementation Correction**: The initial design (tasks 6.1–6.3) attempted to integrate `useContentAutoScroll` (hash-based) into SearchResultContent. This was architecturally incorrect — search pages use `/search?q=foo` with no URL hash, so the hash-driven hook would never activate. See `research.md` "Post-Implementation Finding" for details.

**Final Architecture**: The keyword scroll effect was extracted into a dedicated `useKeywordRescroll` hook (co-located with SearchResultContent), which directly integrates `watchRenderingAndReScroll` for rendering compensation. No hash-based scroll is used in SearchResultContent.

**Hook Call Site**

```typescript
useKeywordRescroll({ scrollElementRef, key: page._id });
```

- `scrollElementRef` is the existing React ref pointing to the scroll container
- `key: page._id` triggers re-execution when the selected page changes
- The hook internally handles MutationObserver setup, debounced keyword scroll, rendering watch, and full cleanup

**File**: `apps/app/src/features/search/client/components/SearchPage/SearchResultContent.tsx`

---

## Error Handling

### Error Strategy

This feature operates entirely in the browser DOM layer with no server interaction. Errors are limited to DOM state mismatches.

### Error Categories and Responses

**Target Not Found** (2.3): If the hash target never appears within 10s, the observer disconnects silently. No error is surfaced to the user — this matches browser-native behavior for invalid hash links.

**Container Not Found** (1.5): If the container element ID does not resolve, the hook returns immediately with no side effects.

**Rendering Watch Timeout** (3.6): After 10s, all observers and timers are cleaned up regardless of remaining rendering elements. This prevents resource leaks from components that fail to signal completion.

