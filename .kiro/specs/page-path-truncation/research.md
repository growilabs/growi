# Research & Design Decisions: page-path-truncation

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.
---

## Summary
- **Feature**: `page-path-truncation`
- **Discovery Scope**: Extension (existing system) — light discovery
- **Key Findings**:
  - The two "Research Needed" bridging problems identified during gap analysis (backward `LinkedPagePath` vs. forward `formatTruncatedPagePath` array; highlight-segment-boundary assumption) both resolve cleanly because `formatTruncatedPagePath`'s truncated layout is structurally fixed: it is always either "all ancestors" or exactly "first ancestor + ellipsis + last ancestor (parent)". No index-matching by text is needed.
  - The existing `PageListItemL` row already separates the ancestor breadcrumb (row 1, via `PagePathHierarchicalLink`) from the page name (row 2, a separate `<Clamp>`-wrapped H5 link). The new truncation behavior is scoped to row 1 only; row 2 is unaffected in structure, but its `DevidedPagePath` split point shifts when `evalDatePath` is unified (Requirement 7), which changes its displayed text for date-suffixed paths — this is the accepted, in-scope side effect Requirement 7.2 names.
  - `PageList.tsx` and `IdenticalPathPage.tsx` pass no path-truncation-related props to `PageListItemL` today, so a new prop defaulting to the current behavior leaves both untouched (confirmed by reading both call sites).

## Research Log

### Extension Point Analysis: where does the new behavior plug in?
- **Context**: Requirement 8 requires the change to be opt-in so only `/_search` is affected.
- **Sources Consulted**: `apps/app/src/client/components/PageList/PageListItemL.tsx`, `PageList.tsx`, `apps/app/src/client/components/IdenticalPathPage.tsx`, `apps/app/src/features/search/client/components/SearchPage/SearchResultList.tsx`.
- **Findings**: `PageListItemL` is the sole renderer of the ancestor breadcrumb (via `PagePathHierarchicalLink`, fed `pageData.path`'s "former" segment) across all three consumers. Only `SearchResultList.tsx` is exclusive to `/_search`.
- **Implications**: A new boolean prop on `PageListItemL`, read only by `SearchResultList.tsx`, is the minimal opt-in seam. `PagePathHierarchicalLink.tsx` itself stays untouched — the new component lives beside it, not inside it.

### Bridging backward `LinkedPagePath` with forward truncation output
- **Context**: Gap analysis Research-Needed item 1 — `LinkedPagePath.parent` walks leaf→root; `formatTruncatedPagePath`'s `parts` array is root→leaf.
- **Findings**: `formatTruncatedPagePath`'s truncation decision has exactly two shapes:
  1. units ≤ 3 → every ancestor segment appears, in root→leaf order.
  2. units ≥ 4 → exactly `ancestors[0]` (first), an ellipsis, `ancestors[length-1]` (parent), then the page name.
  There is never a partial/sliding-window case. This means the surviving ancestor *positions* are always either "all of them" or "the first and the last" — no text-based matching against the ancestors array is required.
- **Implications**: A small pure helper can flatten a `LinkedPagePath` chain into a root→leaf array once (`toRootFirstChain`), and the renderer picks index `0` and index `length - 1` directly for the truncated case, or the whole array for the untruncated case. This removes the need for any generic index-mapping abstraction.

### Highlight-segment-boundary assumption
- **Context**: Gap analysis Research-Needed item 2 — does `highlightedPath`'s `<em>` markup ever change where `/` segment boundaries fall relative to the plain path?
- **Findings**: `DevidedPagePath`'s `PATTERN_DEFAULT` regex already special-cases a `/` immediately following `</em>` so it is not misread as a segment boundary (`PagePathHierarchicalLink` already depends on this for its own dual-tree walk). Elasticsearch highlighting wraps only matched substrings *within* a path segment (segment text never contains a literal `/`), so segment count parity between the plain and highlighted chains holds for all realistic inputs.
- **Implications**: Build the plain and highlighted `LinkedPagePath` chains in parallel (mirroring `PagePathHierarchicalLink`'s existing dual-tree pattern) and zip them by index. As a defensive fallback (not expected to trigger in practice, but cheap to guard), if the two chains ever differ in length, fall back to rendering the plain (non-highlighted) text for that ancestor rather than risking a misaligned zip or a crash.

### Row 1 (ancestor breadcrumb) vs. Row 2 (page name) scope
- **Context**: Requirement 1's acceptance criteria describe the truncated format as "first + ellipsis + parent + page name" — the Project Description's scope list (item 2), however, only asks for a new component that keeps ancestor-segment links, maps highlight markup for surviving ancestor segments, and adds a hover tooltip. It does not ask to change how the page name itself is rendered.
- **Findings**: `PageListItemL` already renders the page name in a structurally separate row (own `<Clamp lines={1}>` + H5 link, next to `UserPicture` and `PageListMeta`), which already guarantees single-line, non-overflowing page-name display. Folding the page name into row 1's markup would duplicate it visually and would require rebuilding the existing title row, which is out of the stated scope (Non-Goals: "検索クエリ挙動・データ取得ロジックの変更は対象外" plus the explicit two-bullet scope for the new component).
- **Selected Approach**: The unit-counting algorithm (ancestors + page name) from `formatTruncatedPagePath` is reused as-is to decide *whether/how much* to collapse the ancestor row, but the page-name segment it returns is dropped before rendering row 1. The hover tooltip (Requirement 4) still exposes the complete path *including* the page name via `fullPath`, so the full hierarchy remains discoverable even though the page name is not duplicated into row 1's text.
- **Rationale**: Matches the Project Description's explicit two-bullet scope for the new component, avoids an unrequested redesign of the title row, and keeps Requirement 9 (non-destructive of unrelated row elements) easy to satisfy.
- **Trade-off**: Requirement 1's literal wording ("...ページ名の形式で表示") is satisfied at the level of the row *pair* (breadcrumb ends at parent, title row shows the page name immediately below) rather than within a single DOM node.
- **Confirmed during `/kiro-validate-design`**: Presented both options (2-row split vs. folding the page name into row 1, which would duplicate it against the existing title row and require restructuring row 2) to the user with a concrete before/after example. User selected the 2-row split (this decision) explicitly. No further action needed on this point.

### Root-icon duplication vs. extraction
- **Context**: `PagePathHierarchicalLink`'s root case (home icon / trash icon + link) must still render identically when a search result has zero ancestors, but the Project Description frames `PagePathHierarchicalLink` as an unmodified, pre-existing component.
- **Alternatives Considered**:
  1. Extract the root-icon JSX into a small shared sub-component imported by both `PagePathHierarchicalLink` and the new component.
  2. Duplicate the ~15-line root-icon JSX block into the new component.
- **Selected Approach**: Option 2 (duplicate).
- **Rationale**: The block is small, has no independent behavior to unit-test beyond what `PagePathHierarchicalLink`'s existing tests already cover, and avoids touching a component the spec explicitly treats as stable/unmodified. Per the Simplification lens, introducing a shared abstraction for two call sites of a ~15-line static block is not justified.
- **Trade-off**: If the icon block changes in the future, both places need updating. Acceptable given its size and low change frequency (it hasn't changed across the `search-modal-path-truncation` effort).

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: Extend `PageListItemL` only | Branch inside `PageListItemL` between old/new rendering, no new component | Fewest new files | Adds a conditional to an already 380-line file; mixes concerns | Rejected: violates file cohesion guidance |
| B: New component only | New component, but no opt-in seam in `PageListItemL` | Clean separation | Every `PageListItemL` consumer would need its own call-site branching, duplicating the wiring 3x | Rejected: pushes the decision to the wrong layer |
| C: Hybrid (selected) | Opt-in prop on `PageListItemL` (Option A's seam) + dedicated new component for the ancestor row (Option B's separation) | Existing consumers (`PageList.tsx`, `IdenticalPathPage.tsx`) stay untouched; new logic is isolated and independently testable | One prop threading point to keep in sync | Matches gap-analysis recommendation |

## Design Decisions

### Decision: Track the "page path truncation" theme via `roadmap.md`, not a merged spec
- **Context**: `search-modal-path-truncation` (#141445, shipped), this spec (#188233/#188237), and at least one more future surface (`PagePathNav`/`PagePathHeader`/`PagePathNavSticky`, and possibly `RecentChangesSubstance`) all implement the same underlying truncation behavior. Reviewer feedback raised the concern that three-plus independent, uncoordinated specs for one theme is too fragmented, while also confirming that per-surface components should stay separate (different rendering needs).
- **Alternatives Considered**:
  1. Merge all surfaces into one spec (rejected earlier in this document — mixes independent responsibility boundaries, risks an oversized `design.md`, couples unrelated approval/task gates).
  2. Leave the specs fully independent with no cross-reference, relying on each new spec's author to rediscover the shared logic.
  3. Add a `roadmap.md` (matching the project's existing convention, e.g. `bulk-export-pdf-rendering/roadmap.md`, `search-filters/roadmap.md`) that names the phases, their dependency order, and the shared seams to watch, without merging their requirements/design/tasks lifecycles.
- **Selected Approach**: Option 3 — `roadmap.md` added to this spec's directory, phasing `search-modal-path-truncation` (done) → `page-path-truncation` (this spec) → `page-path-truncation-navigation` (future, working name, brief created just-in-time).
- **Rationale**: Matches actual project convention (not the possibly-stale `.kiro/steering/roadmap.md` location described in the `kiro-discovery` skill doc — this repo's real precedent keeps per-initiative roadmaps inside the current/anchor spec's own directory). Gives the theme a single place to look up phase status and shared-contract seams, without forcing unrelated approval gates together.
- **Trade-off**: The roadmap needs to be kept in sync manually (no tooling parses it automatically the way `/kiro-spec-batch` parses `.kiro/steering/roadmap.md`); acceptable since this is a 3-phase, human-paced initiative, not a batch-generated one.

### Decision: Relocate `formatTruncatedPagePath` without changing its contract
- **Context**: Requirement scope item 1 — move to a shared location, behavior unchanged.
- **Alternatives Considered**:
  1. Copy the function into a new shared module and keep the original as a re-export (compatibility shim).
  2. Move the file outright and update the single existing import site.
- **Selected Approach**: Option 2 — move `apps/app/src/features/search/client/utils/format-truncated-page-path.ts` (and its spec) to `apps/app/src/client/util/format-truncated-page-path.ts`, matching the existing flat `src/client/util/*.ts` + co-located `*.spec.ts` convention (e.g. `mongo-id.ts`). Update the one existing import in `SearchResultPagePath.tsx`.
- **Rationale**: There is exactly one existing consumer, so a compatibility shim would be pure indirection with no migration benefit (Simplification lens; also project guidance disfavors re-export shims for "removed" locations).
- **Trade-off**: None material — a single import line changes.

### Decision: New pure function to bridge truncation decision with linked/highlighted ancestor chains
- **Context**: The new ancestor-row component needs both *what to show* (from `formatTruncatedPagePath`) and *how to link/highlight it* (from `LinkedPagePath`).
- **Selected Approach**: A new pure function, `buildAncestorPathNodes(path, highlightedPath)`, internally calls `formatTruncatedPagePath(path)`, drops the trailing page-name part, builds the plain and highlighted `LinkedPagePath` chains via `toRootFirstChain`, and returns an ordered, React-agnostic list of `{ type: 'link', href, text, highlightedHtml? } | { type: 'ellipsis' }` plus `fullPath` and a `hasAncestors` flag (for the root-icon-only case). The rendering component only maps this list to JSX.
- **Rationale**: Follows the Pure Function Extraction principle — the non-trivial bridging logic becomes independently unit-testable (root case, short path, truncated path, highlight mapping, mismatched-length fallback) without React Testing Library.
- **Trade-off**: One more file, justified by testability.
- **Follow-up (revised after user review)**: Placed in `client/util/` (not `features/search/`), not `features/search`-scoped, because the bridging problem it solves (truncation decision ⇔ `LinkedPagePath` backward chain) is not specific to search — the requirements' own Non-Goals name `PagePathNav`/`PagePathHeader`/`PagePathNavSticky`/`RecentChangesSubstance` as deferred future consumers of the exact same truncation-with-links need. `highlightedPath` is an optional parameter so a future highlight-less caller can use the same function unmodified. Only the call site (this spec's `SearchResultAncestorPath`) stays scoped to search results — no other consumer is wired up in this spec. See the new `page-path-truncation-navigation` roadmap entry in `roadmap.md`.

### Decision: Opt-in prop name and default
- **Context**: Requirement 8 — non-search consumers of `PageListItemL` must be unaffected by default.
- **Selected Approach**: Add `isPathTruncationEnabled?: boolean` to `PageListItemL`'s `Props`, defaulting to `false` when omitted. Only `SearchResultList.tsx` passes `true`. When `true`, `PageListItemL` also switches `evalDatePath` to `true` for the `DevidedPagePath` calls that back both the ancestor row and the existing page-name row (Requirement 7's unification applies to both, since they are two views over the same former/latter split).
- **Rationale**: A single flag keeps the two Requirement-7-driven behavior changes (breadcrumb truncation, date-bundled page name) consistently gated together, matching "opt-in wholesale for `/_search`" rather than introducing two independently-toggleable flags nothing in requirements asks for.

## Risks & Mitigations
- **Risk**: The row-1/row-2 scope reading (see Research Log) turns out not to match reviewer intent. — **Mitigation**: Called out explicitly in `design.md` boundary section for confirmation before/at `/kiro-validate-design`.
- **Risk**: CSS `flex-shrink` priorities tuned for the modal's compact row (`SearchResultPagePath.module.scss`) do not directly transfer to `PageListItemL`'s wider, differently-composed row (checkbox + icon + "last update" sibling). — **Mitigation**: New, independent `.module.scss` for the new component; verified visually against the `/_search` page during implementation, not assumed from the modal's CSS.
- **Risk**: Highlighted/plain `LinkedPagePath` chain length mismatch (extremely unlikely per the highlight-boundary research, but not provably impossible for all ES outputs). — **Mitigation**: `buildAncestorPathNodes` falls back to plain text for the **entire** ancestor path (not per-node) when the two chains' total lengths differ, since a length mismatch gives no reliable way to know which index caused the drift — a partial/per-node fallback would risk silently misaligning the remaining nodes. (Corrected during `/kiro-validate-design`: the initial research/design wording said "fall back for that node," which implied a per-node granularity that isn't actually safe.)
- **Effort**: M (3–7 days) — unchanged from gap analysis; the bridging risk that drove this estimate is now resolved to a small, well-scoped pure function rather than an open design question.

## References
- `.kiro/specs/page-path-truncation/roadmap.md` — phased plan for the "page path truncation" theme across search modal / search results / future nav surfaces.
- `.kiro/specs/search-modal-path-truncation/design.md` — prior spec this one extends; source of `formatTruncatedPagePath` and its unit-counting algorithm.
- `packages/core/src/models/devided-page-path.ts` — `DevidedPagePath`, including the `evalDatePath` date-bundling rule and the `<em>`-aware segment regex.
- `apps/app/src/models/linked-page-path.ts` — `LinkedPagePath`, the backward-linked ancestor chain model reused (not modified) by the new component.
