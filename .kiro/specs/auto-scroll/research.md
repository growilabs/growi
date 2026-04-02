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
  - Uses MutationObserver to find `.highlighted-keyword` elements and scroll to the first one
  - Debounced at 500ms
  - Does NOT use URL hash for scrolling — scrolls to highlighted search terms
  - No cleanup function (intentional, per inline comment)
- **Implications**: SearchResultContent's scroll target is NOT hash-based. The auto-scroll hook must accept a custom target resolver to support non-hash targets. The two scroll mechanisms (hash-based and keyword-based) may coexist or the keyword-based one may be replaced by the generalized hook.

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
- **Risk**: SearchResultContent's existing scroll logic may conflict with the generalized hook — **Mitigation**: Allow callers to provide custom `resolveTarget` so SearchResultContent can resolve its keyword target independently
- **Risk**: Renaming the attribute requires coordinated changes across `@growi/core`, `remark-drawio`, and consuming apps — **Mitigation**: Constants are centralized; single constant rename propagates via imports
- **Risk**: MutationObserver on `subtree: true` may be expensive on large pages — **Mitigation**: Retained 10s maximum watch timeout from current implementation

## References
- [MutationObserver API](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver) — core browser API used for DOM observation
- [Element.scrollIntoView()](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView) — default scroll behavior
- PR #10853 reviewer feedback from yuki-takei — driving force for this refactoring
