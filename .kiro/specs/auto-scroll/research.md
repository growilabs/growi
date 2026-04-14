# Research & Design Decisions

## Summary
- **Feature**: `auto-scroll`
- **Discovery Scope**: Extension (refactoring existing hook for reusability)
- **Key Findings**:
  - `src/client/hooks/` does not exist; hooks are collocated with features — a new shared hooks directory is needed
  - SearchResultContent has independent scroll-to-highlighted-keyword logic using MutationObserver; coordination needed
  - MermaidViewer does not implement the rendering attribute protocol; DrawioViewer is the only adopter

## Research Log

### Hook Location and Existing Patterns
- **Context**: Requirement 5.5 specifies placing the hook in `src/client/hooks/`
- **Findings**:
  - `apps/app/src/client/hooks/` does not exist
  - Existing hooks are collocated: `features/page-tree/hooks/`, `features/openai/client/components/.../hooks/`
  - No precedent for a top-level shared hooks directory in `src/client/`
- **Implications**: Creating `src/client/hooks/` establishes a new pattern for cross-feature hooks

### SearchResultContent Scroll Behavior
- **Context**: Requirement 5 mandates reusability for search result pages
- **Sources**: `apps/app/src/features/search/client/components/SearchPage/SearchResultContent.tsx`
- **Findings**:
  - Container ID: `search-result-content-body-container`
  - Container has `overflow-y-scroll` — is the scroll unit, not the viewport
  - Uses MutationObserver to find `.highlighted-keyword` elements and scroll to the first one using `scrollWithinContainer`
  - Debounced at 500ms; `SCROLL_OFFSET_TOP = 30`
  - Does NOT use URL hash — scrolls to highlighted search terms
  - `useEffect` has no dependency array (fires on every render); no cleanup (intentional per inline comment)
- **Implications (updated)**:
  - `scrollIntoView()` default is inappropriate; custom `scrollTo` using `scrollWithinContainer` is required
  - When `window.location.hash` is non-empty, the keyword scroll overrides hash scroll after 500ms debounce — must be suppressed via early return guard
  - The `resolveTarget` default (`document.getElementById`) works correctly; heading `id` attributes are set by the remark pipeline

### DrawioViewer Rendering Attribute Pattern
- **Context**: Requirement 4.4 mandates declarative true/false toggling
- **Sources**: `packages/remark-drawio/src/components/DrawioViewer.tsx`
- **Findings**:
  - Initial render: `{[GROWI_RENDERING_ATTR]: 'true'}` in JSX spread (line 188)
  - On error: `removeAttribute(GROWI_RENDERING_ATTR)` (line 131)
  - On complete: `removeAttribute(GROWI_RENDERING_ATTR)` (line 148)
  - This is imperative add/remove, not declarative value toggle
- **Implications**: Needs refactoring to `setAttribute(attr, 'false')` on completion/error instead of `removeAttribute`

### MermaidViewer Status
- **Context**: Could benefit from rendering attribute protocol
- **Sources**: `apps/app/src/features/mermaid/components/MermaidViewer.tsx`
- **Findings**:
  - Does NOT use `GROWI_RENDERING_ATTR`
  - Uses `mermaid.render()` async with direct `innerHTML` assignment
  - Mermaid sanitize options only allow `value` attribute
- **Implications**: Adding Mermaid support is a separate task, not in scope for this spec, but the design should be compatible

### Rendering Attribute Naming
- **Context**: Reviewer feedback requests a more descriptive name
- **Findings**:
  - Current: `data-growi-rendering` — ambiguous (rendering what?)
  - Candidates considered:
    - `data-growi-is-rendering-in-progress` — explicit but verbose
    - `data-growi-rendering-status` — implies multiple states
    - `data-growi-content-rendering` — slightly more specific
  - With declarative true/false, a boolean-style name like `data-growi-is-content-rendering` works well
- **Implications**: Selected `data-growi-is-content-rendering` — clearly a boolean predicate, reads naturally as `is-content-rendering="true"/"false"`

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Custom hook with options object | Single hook with configurable resolveTarget and scrollTo callbacks | Clean API, single import, testable | Options object may grow over time | Selected approach |
| Separate hooks per page type | usePageHashScroll, useSearchScroll | Type-specific optimization | Duplicated watch/cleanup logic | Rejected — violates DRY |
| HOC wrapper | Higher-order component wrapping scroll behavior | Framework-agnostic | Harder to compose, less idiomatic React | Rejected — hooks are idiomatic |

## Design Decisions

### Decision: Hook API Shape
- **Context**: Hook must support PageView (hash-based) and SearchResultContent (keyword-based) with different scroll strategies
- **Alternatives Considered**:
  1. Positional parameters — `useAutoScroll(key, containerId, resolveTarget?, scrollFn?)`
  2. Options object — `useAutoScroll(options)`
- **Selected Approach**: Options object with required `key` and `contentContainerId`, optional `resolveTarget` and `scrollTo`
- **Rationale**: Options object is extensible without breaking existing call sites and self-documents parameter intent
- **Trade-offs**: Slightly more verbose at call site; mitigated by clear defaults

### Decision: Attribute Name
- **Context**: Reviewer feedback: name should clearly convey "rendering in progress"
- **Selected Approach**: `data-growi-is-content-rendering` with values `"true"` / `"false"`
- **Rationale**: Boolean predicate naming (`is-*`) is natural for a two-state attribute; `content-rendering` disambiguates from other rendering concepts
- **Follow-up**: Update `@growi/core` constant and all consumers

### Decision: CSS Selector for In-Progress State
- **Context**: Requirement 4.6 — selector must match only in-progress state
- **Selected Approach**: `[data-growi-is-content-rendering="true"]` instead of bare attribute selector
- **Rationale**: With declarative true/false toggling, bare `[attr]` matches both states; value selector is required

## Risks & Mitigations
- **Risk**: SearchResultContent's existing keyword-highlight scroll may conflict with hash-based scroll — **Mitigation**: Guard the keyword-scroll `useEffect` with `if (window.location.hash.length > 0) return;` so hash scroll takes priority when a hash is present; keyword scroll proceeds unchanged otherwise
- **Risk**: `scrollIntoView()` default scrolls the viewport when SearchResultContent's container has `overflow-y-scroll` — **Mitigation**: Provide a custom `scrollTo` closure using `scrollWithinContainer` with offset from the container's bounding rect
- **Risk**: Renaming the attribute requires coordinated changes across `@growi/core`, `remark-drawio`, and consuming apps — **Mitigation**: Constants are centralized; single constant rename propagates via imports
- **Risk**: MutationObserver on `subtree: true` may be expensive on large pages — **Mitigation**: Retained 10s maximum watch timeout from current implementation

## Post-Implementation Finding: SearchResultContent Integration Misalignment

**Discovered after task 6 implementation** during code review conversation.

### Problem

The task 6 implementation added `useContentAutoScroll` to `SearchResultContent`, but this was architecturally incorrect. `useContentAutoScroll` is URL-hash–driven (`if (hash.length === 0) return`) and will never activate in the search results context — the search page URL (`/search?q=foo`) carries no fragment identifier.

### Actual Requirement

The real requirement for SearchResultContent is:
1. **Keyword scroll** (already working): scroll to the first `.highlighted-keyword` element when content loads, via MutationObserver + 500ms debounce
2. **Re-scroll after rendering** (missing): when drawio / mermaid diagrams render asynchronously after the initial keyword scroll, the layout shifts and the keyword moves out of view — `watchRenderingAndReScroll` should re-scroll to the keyword once rendering settles

### Current Code State (as of this writing)

`apps/app/src/features/search/client/components/SearchPage/SearchResultContent.tsx` contains:
- `useContentAutoScroll(...)` call — **should be removed**
- keyword scroll `useEffect` with hash guard (`if (window.location.hash.length > 0) return`) — the guard may also be removable depending on how the hook is refactored
- `scrollToTargetWithinContainer` local helper (shared distance calculation) — **keep**

### Proposed Refactoring Direction

Two-phase refactor, designed for the next session:

**Phase 1 — Immediate fix (SearchResultContent)**

Wire `watchRenderingAndReScroll` directly into the keyword scroll `useEffect`:

```typescript
useEffect(() => {
  const scrollElement = scrollElementRef.current;
  if (scrollElement == null) return;

  const scrollToKeyword = (): boolean => {
    const toElem = scrollElement.querySelector('.highlighted-keyword') as HTMLElement | null;
    if (toElem == null) return false;
    scrollToTargetWithinContainer(toElem, scrollElement);
    return true;
  };

  // MutationObserver for incremental content loading (debounced)
  const observer = new MutationObserver(() => {
    scrollToFirstHighlightedKeywordDebounced(scrollElement);
  });
  observer.observe(scrollElement, MUTATION_OBSERVER_CONFIG);

  // Rendering watch: re-scroll after drawio/mermaid layout shifts
  const cleanupWatch = watchRenderingAndReScroll(scrollElement, scrollToKeyword);
  return cleanupWatch;
}, [page._id]);
```

Remove the `useContentAutoScroll` import and call entirely.

**Phase 2 — Architecture improvement (shared hook)**

Reorganize the relationship between `useContentAutoScroll` and `watchRenderingAndReScroll`:

- `watchRenderingAndReScroll` (pure function) is the core shared primitive — **promote it to a named export** so callers other than `useContentAutoScroll` can use it directly
- Consider introducing a thin React wrapper hook `useRenderingRescroll(scrollToTarget, deps)` that manages the `useEffect` lifecycle for `watchRenderingAndReScroll`, making it composable
- `useContentAutoScroll` becomes the **hash-navigation–specific** hook: hash guard → target resolution → initial scroll → delegates to `useRenderingRescroll`
- `SearchResultContent` keyword scroll becomes: MO-debounce → initial scroll → delegates to `useRenderingRescroll`
- PageView-specific logic (default `scrollIntoView`, `getElementById` resolver) stays in PageView or in `useContentAutoScroll`

Resulting dependency graph:

```
useContentAutoScroll  ─┐
                        ├── useRenderingRescroll ── watchRenderingAndReScroll
SearchResultContent   ─┘
```

### Key Questions for Next Session Design

1. Should `useRenderingRescroll` be a hook (managing `useEffect` internally) or should callers be responsible for calling it inside their own effect? A hook is more ergonomic; a plain function is more flexible.
2. The current keyword-scroll `useEffect` has no dependency array (fires every render) and no cleanup — intentional per inline comment. Adding `[page._id]` deps and a cleanup changes this behavior. Is that safe?
3. Should the hash guard on the keyword-scroll `useEffect` be removed once `useContentAutoScroll` is also removed from `SearchResultContent`?

## Task 8 Analysis: useRenderingRescroll Hook Extraction

### Investigation (2026-04-06)

**Objective**: Determine whether extracting a shared `useRenderingRescroll` hook is architecturally beneficial after tasks 1–7 completion.

**Method**: Code review of current implementations — `useContentAutoScroll` (108 lines), `watchRenderingAndReScroll` (85 lines), `SearchResultContent` keyword-scroll effect (lines 133–161).

### Findings

**1. Hook extraction is architecturally infeasible for `useContentAutoScroll`**

`useContentAutoScroll` calls `watchRenderingAndReScroll` conditionally inside its `useEffect`:
- On the immediate path: only after `scrollToTarget()` returns true (line 77)
- On the deferred path: only after the MutationObserver detects the target element (line 91)

React hooks cannot be called conditionally or inside callbacks. A `useRenderingRescroll` hook would need an "enabled" flag pattern, adding complexity without simplification.

**2. Co-located cleanup in SearchResultContent prevents separation**

The keyword-scroll `useEffect` in `SearchResultContent` (lines 135–160) combines:
- MutationObserver for keyword highlight detection
- `watchRenderingAndReScroll` for async renderer compensation
- Single cleanup return that handles both

Extracting the watch into a separate hook would split cleanup across two effects, making the lifecycle harder to reason about.

**3. All three design questions from the original research are resolved**

| Question | Resolution | How |
|----------|------------|-----|
| Hook vs. function | Plain function | Conditional call inside effect prevents hook usage |
| `[page._id]` deps + cleanup safe? | Yes, safe | Implemented in task 7.1, working correctly |
| Hash guard removal | Already done | Removed in task 7.1 alongside `useContentAutoScroll` removal |

**4. Current architecture is already optimal**

`watchRenderingAndReScroll` as a plain function returning a cleanup closure is the correct abstraction level:
- Composable into any `useEffect` (conditional or unconditional)
- No React runtime coupling (testable without `renderHook`)
- Clean dependency graph with two independent consumers

### Initial Recommendation (superseded)

Initially recommended closing Task 8 without code changes. However, after discussion the scope was revised from "hook extraction" to "module reorganization" — see below.

### Revised Direction: Module Reorganization (2026-04-06)

**Context**: The user observed that while a shared `useRenderingRescroll` hook adds no value (confirmed by analysis above), the current file layout is inconsistent:

1. `useContentAutoScroll` lives in `src/client/hooks/` (shared) but is PageView-specific (hash-dependent)
2. `watchRenderingAndReScroll` lives next to that hook as if internal, but is the actual shared primitive
3. SearchResultContent's scroll logic is inlined rather than extracted

**Revised approach**:
- Move `watchRenderingAndReScroll` to `src/client/util/` — co-located with `smooth-scroll.ts` (both are DOM scroll utilities)
- Rename `useContentAutoScroll` → `useHashAutoScroll` and move next to `PageView.tsx`
- Extract keyword-scroll effect from `SearchResultContent` into co-located `useKeywordRescroll` hook
- Delete `src/client/hooks/use-content-auto-scroll/` directory

**Rationale**: Module co-location over shared directory. Each hook lives next to its only consumer. Only the truly shared primitive (`watchRenderingAndReScroll`) stays in a shared directory — and it moves from `hooks/` to `util/` since it's a plain function, not a hook.

## References
- [MutationObserver API](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver) — core browser API used for DOM observation
- [Element.scrollIntoView()](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView) — default scroll behavior
- PR #10853 reviewer feedback from yuki-takei — driving force for this refactoring
