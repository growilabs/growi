# Brief: search-filters

## Problem
GROWI's search page currently supports only keyword-based search with minimal controls (sort axis, include user/trash page toggles). Users have no way to narrow results by author, page path prefix, creation/update date range, or user group without embedding raw query operators in the keyword field — which is not discoverable and requires knowledge of GROWI's internal query syntax. This friction is especially acute for team wikis with thousands of pages.

## Current State
- `SearchControl.tsx` exposes sort dropdowns and two binary toggles (user pages, trash pages)
- Path filtering exists at the service layer (`prefix:/path` query operator) but is not surfaced as a UI control
- The URL only carries `?q=keyword`; no filter state is persisted to the URL
- `SearchService.ts` parses embedded operators from the `q` string and builds Elasticsearch bool queries; no separate filter API parameters exist

## Desired Outcome
- A **Filter Bar** component sits below or alongside `SearchControl` on the Search page
- Users can apply Author, Path, Created Date, Updated Date, and Group filters via purpose-built UI controls
- Active filter state is reflected in URL query parameters (e.g., `?q=foo&author=userId&path=/team&createdFrom=2024-01-01&group=groupId`) for bookmarking and deep-linking
- The server accepts the new filter parameters and folds them into the existing Elasticsearch query pipeline
- Adding a new filter in the future requires: one new plugin descriptor file + one line in the registry — no changes to `FilterBar` itself

## Approach
**Static Plugin Registry (Approach A)**

Each filter is a descriptor object implementing a `FilterPlugin` interface:
```typescript
interface FilterPlugin<TValue> {
  id: string;                                         // URL param key
  renderControl(props: FilterControlProps<TValue>): ReactNode;
  toUrlParams(value: TValue): Record<string, string>; // URL serialization
  fromUrlParams(params: URLSearchParams): TValue;     // URL deserialization
  toElasticsearchClause(value: TValue): object | null; // ES query fragment
  isEmpty(value: TValue): boolean;                    // for "clear" logic
}
```

A static `SEARCH_FILTER_PLUGINS` array registers the five concrete plugins. `FilterBar` iterates this array, renders each plugin's control, and applies active filters to the URL and search SWR key. A single `useFilterUrlSync` hook bridges filter state ↔ Next.js router query params.

## Scope
- **In**:
  - `FilterPlugin` interface and registry types
  - `FilterBar` generic container component
  - `useFilterUrlSync` hook (read/write URL params for all filter keys)
  - Five filter plugins: Author, Path, Created Date, Updated Date, Group
  - Server-side: new query parameters on `/search` endpoint, parsed and folded into ES bool query in `SearchService`
  - Integration into `SearchPage` / `SearchControl` layout
- **Out**:
  - Tag filter (tags already have a separate UI surface)
  - Full-text operator embedding in `q` string (keep that as-is)
  - Saved/named filter sets (future feature)
  - Mobile-specific FilterBar layout (initial implementation targets desktop; `SearchOptionModal` extension is out of scope)
  - Admin-level filter configuration UI

## Boundary Candidates
- **Plugin interface layer**: `FilterPlugin<T>` type, registry array, `FilterBar` renderer — pure client-side, no Elasticsearch knowledge
- **URL sync layer**: `useFilterUrlSync` hook — reads/writes Next.js router; isolated from ES logic
- **Server integration layer**: new `/search` API params + `SearchService` extension — pure server-side, no React knowledge
- **Five concrete filter plugins**: each in its own file; independently reviewable

## Out of Boundary
- Modifying the existing `?q=` keyword parameter format
- Changing the Elasticsearch index schema or mappings
- Changes to the audit log search (separate feature using its own ES queries)
- Mobile `SearchOptionModal` — existing toggles remain there; new FilterBar targets desktop only initially

## Upstream / Downstream
- **Upstream**: Next.js Pages Router (URL management), Jotai atoms (`searchKeywordAtom`, `isSearchServiceConfiguredAtom`), SWR `useSWRxSearch` hook, `SearchService` (ES query builder), Elasticsearch backend
- **Downstream**: Potential future filters (Tag filter UI, full-text operators as UI controls), saved search feature, audit log filter bar (separate spec)

## Existing Spec Touchpoints
- **Extends**: None — search-filters is a net-new surface in the existing search feature directory
- **Adjacent**: `suggest-path` spec (shares path input patterns); `hotkeys` spec (search keyboard shortcuts may interact with filter focus)

## Constraints
- All new source files MUST live under `apps/app/src/features/search/`
- Must NOT import server-side modules (`SearchService`, Mongoose models) from client components
- Elasticsearch query extensions must use the existing `ElasticsearchDelegator` interface; no new ES client instances
- New URL params must coexist safely with existing `?q=`, `?sort=`, `?order=` params — no collisions
- Author and Group filter values must resolve to MongoDB ObjectIds server-side; client sends string IDs
- Date filter values are ISO 8601 strings in URL; ES range queries use epoch milliseconds
- Reactstrap + Bootstrap 5 for UI components (consistent with `SearchControl`, `SortControl`)
- No new global CSS imports from client components (Turbopack Pages Router restriction; use CSS Modules or inline styles)
