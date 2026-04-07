# Implementation Plan

- [x] 1. Update rendering status constants in @growi/core
  - Rename the attribute constant from the current name to `data-growi-is-content-rendering` to clearly convey boolean rendering-in-progress semantics
  - Update the CSS selector constant to match only the in-progress state (`="true"`) rather than bare attribute presence
  - Remove the old constants — no backward-compatibility aliases since all consumers are updated in the same change
  - _Requirements: 4.1, 4.2, 4.6_

- [x] 2. Update remark-drawio for declarative rendering attribute protocol
- [x] 2.1 (P) Adopt declarative value toggling in DrawioViewer component
  - Change rendering-complete and error paths to set the attribute value to `"false"` instead of removing the attribute entirely
  - Update the initial JSX spread to use the renamed constant while keeping `"true"` as the initial value
  - Verify that the wrapper component (DrawioViewerWithEditButton) continues to function without changes
  - In the ResizeObserver handler, set `attr="true"` before `renderDrawioWithDebounce()` to signal re-render cycles to the auto-scroll system (req 4.8)
  - _Requirements: 4.3, 4.4, 4.8_
- [x] 2.2 (P) Update remark-drawio plugin sanitization and node rewriting
  - Replace the old constant in the supported-attributes array with the new constant name
  - Update node rewriting to set the new attribute name with `"true"` value on drawio nodes
  - Confirm the sanitize export still passes the new attribute through HTML sanitization
  - _Requirements: 4.5_

- [x] 3. Add rendering attribute to MermaidViewer and Lsx
- [x] 3.1 (P) Add rendering-status attribute lifecycle to MermaidViewer
  - Set the rendering-status attribute to `"true"` on the container element at initial render before the async SVG render starts
  - Set the attribute to `"false"` after `mermaid.render()` completes and the SVG is injected into the DOM
  - Set the attribute to `"false"` in the error/catch path as well
  - Update the mermaid remark plugin sanitize options to include the new attribute name in the allowlist
  - _Requirements: 4.3, 4.4, 4.5, 4.7_
- [x] 3.2 (P) Add rendering-status attribute lifecycle to Lsx component
  - Set the rendering-status attribute to `"true"` on the outermost container while the SWR page list fetch is loading
  - Set the attribute to `"false"` when data arrives — success, error, or empty result — using declarative binding from the existing `isLoading` state
  - Update the lsx remark plugin sanitize options to include the new attribute name in the allowlist
  - Add `@growi/core` as a dependency of `remark-lsx` (same pattern as `remark-drawio`)
  - _Requirements: 4.3, 4.4, 4.5, 4.7_

- [x] 4. Implement shared auto-scroll hook
- [x] 4.1 Implement rendering watch function with safety improvements
  - Create the `watchRenderingAndReScroll` function in the new shared hooks directory using the updated rendering-status selector
  - Add a `stopped` boolean flag checked inside timer callbacks to prevent execution after cleanup (race condition fix from PR review)
  - Maintain the existing non-resetting timer pattern: skip scheduling when a timer is already active
  - When `checkAndSchedule` detects no rendering elements remain while a timer is still active, cancel the active timer immediately to avoid a redundant re-scroll after rendering has completed
  - Enforce the 10-second hard timeout that cleans up observer and all timers regardless of remaining rendering elements
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.1, 6.2, 6.3_
  - _Contracts: watchRenderingAndReScroll service interface_
- [x] 4.2 Implement useContentAutoScroll hook with options object API
  - Create the hook accepting an options object with `key`, `contentContainerId`, optional `resolveTarget`, and optional `scrollTo`
  - Implement guard logic: skip processing when key is null/undefined, hash is empty, or container element not found
  - Implement immediate scroll path: resolve target via provided closure (default: `getElementById`), scroll via provided function (default: `scrollIntoView`), then check for rendering elements before delegating to rendering watch — skip watch entirely if no rendering elements exist
  - Implement deferred scroll path: MutationObserver on container until target appears, then scroll and conditionally delegate to rendering watch (same check), with 10-second timeout
  - Store `resolveTarget` and `scrollTo` callbacks in refs to avoid re-triggering the effect on callback identity changes
  - Wire cleanup to disconnect all observers, clear all timers, and invoke rendering watch cleanup
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 6.1, 6.2_
  - _Contracts: UseContentAutoScrollOptions, useContentAutoScroll service interface_
- [x] 4.3 (P) Write tests for watchRenderingAndReScroll
  - Test that no timer is scheduled when no rendering elements exist
  - Test that a re-scroll fires after the 5-second poll interval when rendering elements are present
  - Test that the timer is not reset by intermediate DOM mutations
  - Test that late-appearing rendering elements are detected by the observer and trigger a timer
  - Test that only one re-scroll executes per cycle even with multiple rendering elements
  - Test that the 10-second watch timeout cleans up all resources
  - Test that the stopped flag prevents timer callbacks from executing after cleanup
  - Test that an active timer is cancelled when rendering elements are removed before the timer fires
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.1, 6.2, 6.3_
- [x] 4.4 (P) Write tests for useContentAutoScroll
  - Test guard conditions: no-op when key is null, hash is empty, or container not found
  - Test immediate scroll when target already exists in DOM
  - Test deferred scroll when target appears after initial render via MutationObserver
  - Test that encoded hash values are decoded correctly before target resolution
  - Test that a custom `resolveTarget` closure is called instead of the default
  - Test that a custom `scrollTo` function is called instead of the default
  - Test cleanup on key change: observers and timers from previous run are released
  - Test cleanup on unmount: all resources are released
  - Test rendering watch integration: re-scroll fires when rendering elements exist after initial scroll
  - Test that rendering watch is skipped when no rendering elements exist after initial scroll
  - Test 10-second timeout for target observation when target never appears
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 5.1, 5.2, 5.3, 5.6, 5.7, 6.1, 6.2_

- [x] 5. Integrate hook into PageView and remove old implementation
  - Replace the import of the old hook with the new shared hook in PageView
  - Update the call site to use the options object API with `key: currentPageId` and `contentContainerId` — no custom `resolveTarget` or `scrollTo` needed (defaults match PageView's behavior)
  - Delete the old hook file and its test file from the PageView directory
  - Verify that PageView auto-scroll behavior is preserved with manual testing or existing test coverage
  - _Requirements: 5.1, 5.4, 5.5_

- [x] 6. Integrate useContentAutoScroll into SearchResultContent
- [x] 6.1 (P) Add hash-based auto-scroll with container-relative scroll strategy
  - Call `useContentAutoScroll` with `key: page._id` and `contentContainerId: 'search-result-content-body-container'`
  - Provide a custom `scrollTo` closure that calculates the target element's offset relative to the container's bounding rect and calls `scrollWithinContainer` with the same `SCROLL_OFFSET_TOP` constant already used for keyword scroll
  - Capture the container via the existing `scrollElementRef` in the closure to avoid a redundant `getElementById` lookup
  - Do not provide a custom `resolveTarget` — heading elements have `id` attributes set by the remark pipeline, so the default `getElementById` resolver works correctly
  - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [x] 6.2 (P) Suppress keyword-highlight scroll when a URL hash is present
  - Add an early return guard at the top of the existing keyword-scroll `useEffect`: if `window.location.hash` is non-empty, return immediately so hash-based scroll is not overridden by the debounced keyword scroll
  - Preserve the existing keyword-scroll behavior fully when no hash is present — the MutationObserver, debounce interval, and `scrollWithinContainer` call remain unchanged
  - _Requirements: 5.1, 5.5_

- [x] 6.3 Write tests for SearchResultContent auto-scroll integration
  - Test that `useContentAutoScroll` is called with the correct `key` and `contentContainerId` when the component mounts
  - Test that the custom `scrollTo` scrolls within the container (not the viewport) by verifying `scrollWithinContainer` is called with the correct distance
  - Test that the keyword-scroll `useEffect` skips observation when `window.location.hash` is non-empty
  - Test that the keyword-scroll `useEffect` sets up the MutationObserver normally when no hash is present
  - _Requirements: 5.1, 5.2, 5.3, 5.5_

---

## Phase 2: Module Reorganization

> **Context**: Tasks 1–7 delivered all functional requirements. Task 8 reorganizes modules for co-location: each hook moves next to its consumer, and the shared rendering watch utility moves to `src/client/util/`. No behavior changes — pure structural improvement.

- [x] 7. Fix SearchResultContent: replace `useContentAutoScroll` with `watchRenderingAndReScroll`
- [x] 7.1 Wire `watchRenderingAndReScroll` into keyword-scroll effect
  - Remove `useContentAutoScroll` import and call from `SearchResultContent.tsx`
  - Import `watchRenderingAndReScroll` (already exported from `watch-rendering-and-rescroll.ts`)
  - Inside the keyword-scroll `useEffect`, after setting up the MutationObserver, call `watchRenderingAndReScroll(scrollElement, scrollToKeyword)` where `scrollToKeyword` calls `scrollToTargetWithinContainer` on the first `.highlighted-keyword` element
  - Add `[page._id]` to the dependency array (currently has no deps) and return the watch cleanup function
  - Remove the hash guard (`if (window.location.hash.length > 0) return`) — no longer needed once `useContentAutoScroll` is removed
  - _See research.md for proposed code sketch_

- [x] 7.2 Update SearchResultContent tests
  - Remove tests that assert `useContentAutoScroll` is called
  - Add tests that `watchRenderingAndReScroll` re-scrolls to `.highlighted-keyword` after a rendering element settles
  - Update MutationObserver suppression test: remove the hash-guard test (guard will be gone)

- [x] 8. Reorganize auto-scroll modules by co-locating hooks with their consumers
- [x] 8.1 Move the rendering watch utility to the shared utility directory
  - Move the rendering watch function and its test file from the shared hooks directory to the client utility directory, alongside the existing smooth-scroll utility
  - Update the import path in the hash-based auto-scroll hook to reference the new location
  - Update the import path in SearchResultContent to reference the new location
  - Run existing tests to verify no regressions from the path change
  - _Requirements: 5.4, 5.5_
- [x] 8.2 Rename and move the hash-based auto-scroll hook next to PageView
  - Rename the hook and its options type to reflect its hash-navigation–specific purpose (not a generic "content auto-scroll")
  - Move the hook file and its test file to the PageView component directory
  - Update PageView's import to use the co-located hook with the new name
  - Update the hook's internal import of the rendering watch utility to use the path established in 8.1
  - Run existing tests to verify the rename and move introduce no regressions
  - _Requirements: 5.4, 5.5_
- [x] 8.3 Extract the keyword-scroll effect from SearchResultContent into a co-located hook
  - Create a new hook that encapsulates the MutationObserver-based keyword detection, debounced scroll, and rendering watch integration currently inlined in the component
  - Accept a ref to the scrollable container and a trigger key as inputs
  - Move the scroll helper functions (container-relative scroll calculation, first-highlighted-keyword lookup) into the hook file if they are used only by this logic
  - Replace the inline useEffect in SearchResultContent with a single call to the new hook
  - _Requirements: 5.4, 5.5, 6.1_
- [x] 8.4 (P) Write tests for the extracted keyword-rescroll hook
  - Migrate rendering watch assertions from SearchResultContent tests into the new hook's test file
  - Add tests for keyword scroll behavior: MutationObserver setup, debounced scroll to the first highlighted keyword, cleanup on key change and unmount
  - Simplify SearchResultContent tests to verify the hook is called with the correct container ref and key, without re-testing internal scroll behavior
  - _Requirements: 6.1, 6.2_
- [x] 8.5 (P) Remove the old shared hooks directory and verify no stale imports
  - Delete the now-empty auto-scroll hooks directory
  - Search the codebase for any remaining references to the old directory path and fix them
  - Run the full test suite and type check to confirm the reorganization is complete
  - _Requirements: 5.5_
