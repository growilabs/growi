# Requirements Document

## Introduction

This specification defines the behavior of the **hash-based auto-scroll** mechanism used across GROWI's content pages. When a user navigates to a URL containing a fragment hash (e.g., `#section-title`), the system scrolls to the corresponding element in the rendered content. Because GROWI pages contain lazily-rendered elements (Drawio diagrams, Mermaid charts, etc.) that cause layout shifts after initial paint, the system must detect in-progress renders and re-scroll to compensate.

This hook is designed to be **page-type agnostic** — it must work in any view that renders Markdown content with a hash-addressable container (PageView, search result previews, etc.).

## Review Feedback (from yuki-takei, PR #10853)

The following reviewer feedback is incorporated into these requirements:

1. **Rendering attribute value**: Use declarative `true`/`false` toggling instead of `setAttribute`/`removeAttribute` — the attribute should always be present with a boolean-like value, not added/removed.
2. **Attribute naming**: The attribute name should more clearly convey "rendering in progress" status. The name will be finalized in the design phase but must be more descriptive than `data-growi-rendering`.
3. **Hook generalization**: Move to `src/client/hooks/` for shared use; accept a target-resolving closure instead of hardcoded `getElementById`; support customizable scroll behavior (e.g., `scrollIntoView` for PageView vs. a different method for SearchResultContent); rename the hook accordingly.

## Requirements

### Requirement 1: Immediate Scroll to Hash Target

**Objective:** As a user, I want to be scrolled to the section referenced by the URL hash when I open a page, so that I can directly access the content I was linked to.

#### Acceptance Criteria

1. When the page loads with a URL hash and the target element already exists in the DOM, the hook shall scroll the target element into view immediately.
2. When the page loads with a URL hash containing encoded characters (e.g., `%E6%97%A5%E6%9C%AC%E8%AA%9E`), the hook shall decode the hash and locate the corresponding element by its `id` attribute.
3. If the key parameter is null or undefined, the hook shall skip all scroll processing.
4. If the URL hash is empty, the hook shall skip all scroll processing.
5. If the content container element is not found in the DOM, the hook shall skip all scroll processing.

### Requirement 2: Deferred Scroll for Lazy-Rendered Targets

**Objective:** As a user, I want the page to scroll to my target section even when the content is rendered after initial page load, so that dynamically rendered headings are still reachable via URL hash.

#### Acceptance Criteria

1. When the page loads with a URL hash and the target element does not yet exist in the DOM, the hook shall observe the content container for DOM mutations until the target appears.
2. When the target element appears in the DOM during observation, the hook shall immediately scroll it into view.
3. If the target element does not appear within the watch timeout period (default: 10 seconds), the hook shall stop observing and give up without error.

### Requirement 3: Re-Scroll After Rendering Completion

**Objective:** As a user, I want the view to re-adjust after lazy-rendered content (e.g., Drawio diagrams) finishes rendering, so that layout shifts do not push my target section out of view.

#### Acceptance Criteria

1. When an initial scroll completes and elements whose rendering-status attribute indicates "in progress" exist in the content container, the hook shall schedule a re-scroll after a poll interval (default: 5 seconds).
2. While elements with in-progress rendering status remain in the container after a re-scroll, the hook shall repeat the poll-and-re-scroll cycle.
3. When no elements with in-progress rendering status remain after a re-scroll check, the hook shall stop re-scrolling.
4. When new elements with in-progress rendering status appear in the container (detected via MutationObserver), the hook shall schedule a re-scroll if one is not already pending.
5. The hook shall not reset a running poll timer when additional DOM mutations occur — only schedule a new timer when no timer is active.
6. The rendering watch shall automatically terminate after the watch timeout period (default: 10 seconds) regardless of remaining rendering elements.

### Requirement 4: Rendering Status Attribute Protocol

**Objective:** As a developer, I want a standardized attribute for components to signal their rendering status declaratively, so that the auto-scroll system can detect layout-shifting content generically.

#### Acceptance Criteria

1. The attribute name and its CSS selector for the "in progress" state shall be defined as shared constants in `@growi/core`.
2. The attribute name shall clearly convey that rendering is in progress (e.g., more descriptive than a generic `data-growi-rendering`). The final name will be determined in the design phase.
3. When a component begins rendering content that will change its dimensions (e.g., Drawio diagram initialization), the component shall set the attribute value to indicate "in progress" (e.g., `"true"`).
4. When the component finishes rendering or encounters an error, the component shall set the attribute value to indicate "completed" (e.g., `"false"`) rather than removing the attribute entirely — the attribute lifecycle shall be declarative (value toggle), not imperative (add/remove).
5. The attribute shall be included in the component's HTML sanitization allowlist so that it survives remark/rehype processing.
6. The CSS selector used by the auto-scroll system shall match only the "in progress" state (e.g., `[attr="true"]`), not the completed state.
7. The following async-rendering components shall adopt the attribute protocol in this scope: DrawioViewer, MermaidViewer, and lsx (Lsx). Other async renderers (PlantUML, attachment-refs, RichAttachment) are deferred to follow-up work.

### Requirement 5: Page-Type Agnostic Design

**Objective:** As a developer, I want the auto-scroll hook to be reusable across different page types (wiki pages, search results, etc.), so that hash-based scrolling behaves consistently throughout the application.

#### Acceptance Criteria

1. The hook shall accept a generic key parameter (not limited to page IDs) and a content container element ID as its inputs.
2. The hook shall accept an optional target-resolving function (closure) that returns the target `HTMLElement | null`. When not provided, the hook shall default to resolving the target via `document.getElementById` using the decoded hash.
3. The hook shall accept an optional scroll function that defines how to scroll to the target element. When not provided, the hook shall default to `element.scrollIntoView()`. This allows callers (e.g., SearchResultContent) to supply a custom scroll strategy.
4. The hook shall not import or depend on any page-specific state (Jotai atoms, SWR hooks, or page models).
5. The hook shall be located in a shared directory (e.g., `src/client/hooks/`) and named to reflect its general-purpose nature — not tied to a specific page component.
6. When the key parameter changes, the hook shall clean up any active observers and timers from the previous run and re-execute the scroll logic.
7. When the component using the hook unmounts, the hook shall clean up all MutationObservers, timers, and rendering watch resources.

### Requirement 6: Resource Cleanup and Safety

**Objective:** As a developer, I want the hook to be safe against memory leaks and runaway timers, so that it can be used in any component lifecycle without side effects.

#### Acceptance Criteria

1. When the hook's effect cleanup runs, the hook shall disconnect all MutationObservers, clear all pending timers, and invoke any rendering watch cleanup functions.
2. The hook shall enforce a maximum watch duration (default: 10 seconds) for both target observation and rendering watch, preventing indefinite resource consumption.
3. While multiple elements with the rendering-status attribute (in-progress state) exist simultaneously, the hook shall execute only one re-scroll (not one per element).
