# Implementation Plan

## Task 1: Foundation — Shared Types and Plugin Interface
- [ ] 1. Foundation — Shared Types and Plugin Interface
- [ ] 1.1 Define `ISearchFilterParams`, `DatePreset`, and `DATE_PRESET_DAYS`
  - Create `apps/app/src/features/search/interfaces/search-filter.ts`
  - Export `DatePreset = '7d' | '30d' | '90d' | '1y'`, `DATE_PRESET_DAYS: Record<DatePreset, number>` (7/30/90/365), and `ISearchFilterParams` with optional fields: `user`, `path`, `createdPreset`, `updatedPreset`, `group`
  - No browser-only or server-only imports — this file is safe for both client and server bundles
  - Done when: the file compiles with `tsc --noEmit` and all 5 `ISearchFilterParams` fields are correctly typed
  - _Requirements: 9.1_

- [ ] 1.2 Define `FilterPlugin<TValue>` interface and `FilterControlProps<TValue>`
  - Create `apps/app/src/features/search/client/plugins/types.ts`
  - Export `FilterPlugin<TValue>` with: `id: string`, `label: string`, `renderControl(props)`, `toUrlParams(value)`, `fromUrlParams(params)`, `isEmpty(value)` — no `toElasticsearchClause` (ES clause building is server-only)
  - Document invariants: `isEmpty(v) === true` → `toUrlParams(v)` returns `{}`; `fromUrlParams` must never throw
  - Done when: TypeScript compiles and the interface is correctly generic with no `any` types
  - _Requirements: 1.3, 2.1, 3.1–3.6_
  - _Depends: 1.1_

---

## Task 2: Server-Side Extension (sequential — each step depends on the prior)
- [ ] 2. Server-Side Extension
- [ ] 2.1 Add `buildFilterClauses()` to `ElasticsearchDelegator`
  - In `apps/app/src/server/service/search-delegator/elasticsearch.ts`, define and **export** the server-internal type `ResolvedFilterParams` (exported so `SearchService` can import it without circular dependency):
    ```
    { user?: { username: string; lastUpdatePageIds: string[] }; path?: string; createdPreset?: DatePreset; updatedPreset?: DatePreset; group?: { memberUsernames: string[] } }
    ```
  - Add private method `buildFilterClauses(resolved: ResolvedFilterParams): object[]` implementing 5 clauses:
    - user → `{ bool: { should: [{ term: { username } }, { ids: { values: lastUpdatePageIds } }], minimum_should_match: 1 } }`
    - path → `{ prefix: { 'path.raw': pathPrefix } }`
    - createdPreset/updatedPreset → `{ range: { created_at/updated_at: { gte: new Date(now - DAYS * 86400000).toISOString() } } }` using `DATE_PRESET_DAYS`
    - group → `{ terms: { username: memberUsernames } }`
  - Call `buildFilterClauses()` inside the existing `search()` method and append returned clauses to `bool.filter[]`; returns `[]` when all params absent — no-op for existing queries (Req 9.7)
  - Done when: `buildFilterClauses({ path: '/team' })` returns `[{ prefix: { 'path.raw': '/team' } }]`; `buildFilterClauses({})` returns `[]`
  - _Requirements: 9.2–9.8_
  - _Boundary: elasticsearch.ts_
  - _Depends: 1.1_

- [ ] 2.2 Extend `SearchService.searchKeyword()` with filter resolution
  - In `apps/app/src/server/service/search.ts`, add optional `filterParams?: ISearchFilterParams` parameter (backward-compatible — existing call sites unchanged, Req 9.7)
  - Import `ResolvedFilterParams` from `elasticsearch.ts` (Task 2.1 defines and exports it); build a `ResolvedFilterParams` object in `SearchService` after MongoDB resolution
  - **User resolution** (Req 9.2, 9.9): `User.findById(userId).select('username').lean()` → not found → return `EMPTY_SEARCH_RESULT`; then `Page.find({ lastUpdateUser: userId }).select('_id').sort({ updatedAt: -1 }).limit(USER_FILTER_PAGE_ID_LIMIT).lean()` where `USER_FILTER_PAGE_ID_LIMIT = 1000`
  - **Group resolution** (Req 9.6, 9.9): `UserGroupRelation.findAllUserIdsForUserGroups([groupId])` → empty → return `EMPTY_SEARCH_RESULT`; then `User.find({ _id: { $in: memberIds } }).select('username').lean()`
  - Catch Mongoose `CastError` on malformed ObjectId → return `EMPTY_SEARCH_RESULT` (Req 9.9)
  - Pass assembled `ResolvedFilterParams` to `ElasticsearchDelegator`
  - Done when: calling without `filterParams` returns unchanged results; calling with `{ user: '<validId>' }` triggers two DB queries before the ES call
  - _Requirements: 9.2, 9.6, 9.9_
  - _Boundary: search.ts_
  - _Depends: 2.1_

- [ ] 2.3 Extend Search API route to accept and forward filter parameters
  - In the search API route handler (verify path: `apps/app/src/server/routes/apiv3/search.ts` or equivalent), extract `user`, `path`, `createdPreset`, `updatedPreset`, `group` from `req.query`
  - Validate `createdPreset` and `updatedPreset` against `DatePreset` union; silently drop invalid values
  - Build `ISearchFilterParams` (omit undefined) and pass as `filterParams` to `SearchService.searchKeyword()`
  - Existing params `q`, `sort`, `order`, `limit`, `offset`, `nq` remain untouched (Req 9.10)
  - Done when: `GET /search?user=someId&path=%2Fteam` reaches `SearchService.searchKeyword()` with `filterParams = { user: 'someId', path: '/team' }`
  - _Requirements: 9.1, 9.7, 9.10_
  - _Boundary: routes/apiv3/search.ts_
  - _Depends: 2.2_

---

## Task 3: SWR Hook Extension (P)
- [ ] 3. Extend `ISearchConfigurations` and `useSWRxSearch` to carry filter params (P)
  - In `apps/app/src/stores/search.tsx`, add `filters?: ISearchFilterParams` to `ISearchConfigurations`
  - `filters` is automatically included in the SWR key (since `configurations` is already part of the key) — filter changes cause a cache miss and re-fetch without additional wiring
  - Update the SWR fetcher to spread `configurations.filters` as GET query params (omit `undefined` keys)
  - Done when: TypeScript compiles and a change to `filters` in `configurations` causes a new network request in the browser
  - _Requirements: 9.1_
  - _Boundary: stores/search.tsx_
  - _Depends: 1.1_

---

## Task 4: Filter Control Components (parallel within this task)
- [ ] 4. Filter Control Components
- [ ] 4.1 Build `UserFilterControl` (P)
  - Create `apps/app/src/features/search/client/components/filter-controls/UserFilterControl.tsx`
  - Use react-bootstrap-typeahead v6 (already installed) in async mode; on typing, fetch `/api/v3/users?q=<query>` for suggestions; display `user.name`; store `user._id` (ObjectId string) as filter value
  - On load with pre-populated URL value: call `/api/v3/users?id=<objectId>` to resolve display name — **verify this query param is supported on the existing endpoint before implementing**; if `?id=` is not supported, investigate whether `?q=<username>` is a viable fallback or whether the route needs a small extension (add a prerequisite task 2.0 if an endpoint change is required)
  - Label: "User"; placeholder: "Search by creator or editor..."
  - Done when: selecting a user from the typeahead shows the user's display name and fires `onChange(userId)` with the ObjectId string
  - _Requirements: 4.1, 4.2_
  - _Boundary: filter-controls/UserFilterControl.tsx_
  - _Depends: 1.2_

- [ ] 4.2 Build `PathFilterControl` (P)
  - Create `apps/app/src/features/search/client/components/filter-controls/PathFilterControl.tsx`
  - Plain HTML `<input type="text">` with 300 ms debounce; fires `onChange(trimmedValue)` after debounce elapses; clearing the input fires `onChange('')`
  - Done when: typing `/team` waits 300 ms then fires `onChange('/team')`; clearing fires `onChange('')`
  - _Requirements: 5.1–5.3_
  - _Boundary: filter-controls/PathFilterControl.tsx_
  - _Depends: 1.2_

- [ ] 4.3 Build `DatePresetControl` (P)
  - Create `apps/app/src/features/search/client/components/filter-controls/DatePresetControl.tsx`
  - Reactstrap v9 `ButtonGroup` with exactly 4 `<Button>` elements: "Last 7 Days", "Last 30 Days", "Last 90 Days", "Last Year"
  - Receives `value: DatePreset | null`; active preset is visually highlighted; clicking an already-active preset deselects it (fires `onChange(null)`)
  - CSS Modules for layout — no global CSS imports (Turbopack Pages Router restriction)
  - Done when: clicking "Last 30 Days" highlights that button and fires `onChange('30d')`; clicking it again fires `onChange(null)`
  - _Requirements: 6.1–6.3, 7.1–7.3_
  - _Boundary: filter-controls/DatePresetControl.tsx_
  - _Depends: 1.1, 1.2_

- [ ] 4.4 Build `GroupFilterControl` (P)
  - Create `apps/app/src/features/search/client/components/filter-controls/GroupFilterControl.tsx`
  - react-bootstrap-typeahead v6 async mode; on typing, fetch `/api/v3/user-groups?q=<query>`; display `group.name`; store `group._id` as filter value
  - On load with pre-populated URL value, call the group endpoint to resolve display name
  - Done when: selecting a group fires `onChange(groupId)` with the ObjectId string and shows the group's name in the control
  - _Requirements: 8.1, 8.2_
  - _Boundary: filter-controls/GroupFilterControl.tsx_
  - _Depends: 1.2_

---

## Task 5: Plugin Implementations (parallel within this task, except 5.5)
- [ ] 5. Filter Plugin Implementations
- [ ] 5.1 Implement `user-filter-plugin.ts` (P)
  - Create `apps/app/src/features/search/client/plugins/user-filter-plugin.ts`
  - `TValue = string | null`; URL key `user`; `isEmpty = value === null`
  - `fromUrlParams`: returns the `user` param string if non-empty, else `null`; malformed/missing → `null` (Req 4.5)
  - `toUrlParams`: returns `{ user: value }` when non-null; `{}` when null
  - `renderControl`: returns `<UserFilterControl ...>`
  - Done when: `fromUrlParams(new URLSearchParams('user=abc'))` returns `'abc'`; `fromUrlParams(new URLSearchParams(''))` returns `null`; `toUrlParams(null)` returns `{}`
  - _Requirements: 4.1–4.5_
  - _Boundary: client/plugins/user-filter-plugin.ts_
  - _Depends: 1.2, 4.1_

- [ ] 5.2 Implement `path-filter-plugin.ts` (P)
  - Create `apps/app/src/features/search/client/plugins/path-filter-plugin.ts`
  - `TValue = string`; URL key `path`; `isEmpty = value === ''`
  - `renderControl`: returns `<PathFilterControl ...>`
  - Done when: `toUrlParams('')` returns `{}`; `toUrlParams('/team')` returns `{ path: '/team' }`
  - _Requirements: 5.1–5.4_
  - _Boundary: client/plugins/path-filter-plugin.ts_
  - _Depends: 1.2, 4.2_

- [ ] 5.3 Implement `date-preset-filter-plugin.ts` (P)
  - Create `apps/app/src/features/search/client/plugins/date-preset-filter-plugin.ts`
  - Export `createDatePresetPlugin(config: { id: 'created' | 'updated'; label: string })` factory
  - URL key: `createdPreset` when `id = 'created'`; `updatedPreset` when `id = 'updated'`
  - `fromUrlParams`: validates against `DatePreset` union; returns `null` for unrecognized or missing values (Req 6.6, 7.6)
  - `renderControl`: returns `<DatePresetControl value={...} onChange={...} />` — shared component handles both plugins
  - Done when: `fromUrlParams(new URLSearchParams('createdPreset=30d'))` returns `'30d'`; `fromUrlParams(new URLSearchParams('createdPreset=bad'))` returns `null`; factory with `id='updated'` uses `updatedPreset` key
  - _Requirements: 6.1–6.6, 7.1–7.6_
  - _Boundary: client/plugins/date-preset-filter-plugin.ts_
  - _Depends: 1.1, 1.2, 4.3_

- [ ] 5.4 Implement `group-filter-plugin.ts` (P)
  - Create `apps/app/src/features/search/client/plugins/group-filter-plugin.ts`
  - `TValue = string | null`; URL key `group`; `isEmpty = value === null`
  - `fromUrlParams`: returns `group` param string if non-empty, else `null` (Req 8.5)
  - `renderControl`: returns `<GroupFilterControl ...>`
  - Done when: `fromUrlParams(new URLSearchParams('group=abc'))` returns `'abc'`; `fromUrlParams(new URLSearchParams(''))` returns `null`
  - Note: the `(P)` marker means this task runs in parallel with 5.1–5.3 only; Task 5.5 is **not** parallel — it depends on all four of 5.1–5.4
  - _Requirements: 8.1–8.5_
  - _Boundary: client/plugins/group-filter-plugin.ts_
  - _Depends: 1.2, 4.4_

- [ ] 5.5 Assemble `SEARCH_FILTER_PLUGINS` registry in `plugins/index.ts`
  - Create `apps/app/src/features/search/client/plugins/index.ts`
  - Import all 5 plugin instances (userFilterPlugin, pathFilterPlugin, createdDatePresetPlugin, updatedDatePresetPlugin, groupFilterPlugin); export `SEARCH_FILTER_PLUGINS: readonly FilterPlugin<unknown>[]`
  - Registry order (left-to-right FilterBar rendering): user, path, createdDatePreset, updatedDatePreset, group
  - Done when: `SEARCH_FILTER_PLUGINS.length === 5`, all `id` values are unique, and TypeScript compiles
  - _Requirements: 1.1_
  - _Boundary: client/plugins/index.ts_
  - _Depends: 5.1, 5.2, 5.3, 5.4_

---

## Task 6: URL Sync Hook and FilterBar Container (parallel between 6.1 and 6.2)
- [ ] 6. URL Sync Hook and FilterBar Container
- [ ] 6.1 Implement `useFilterUrlSync` hook (P)
  - Create `apps/app/src/features/search/client/hooks/use-filter-url-sync.ts`
  - State derives entirely from `router.query` on every render — no separate `useState`
  - `setFilter(pluginId, value)`: calls `router.push()` spreading current query with `plugin.toUrlParams(value)`; removes keys when `isEmpty(value) === true` (Req 3.1, 3.2)
  - `clearAllFilters()`: removes all plugin URL keys from current query via `router.push()` (Req 1.4)
  - `activeApiParams`: reduces all plugins' `toUrlParams` output for non-empty values; returned as `ISearchFilterParams` for `useSWRxSearch`
  - Register `router.beforePopState(() => true)` on mount — filter state re-derives from URL after browser back/forward (Req 3.4)
  - Preserves existing URL params `q`, `sort`, `order`, `nq`, `limit`, `offset` in all operations (Req 3.5)
  - Done when: mock-router test confirms `setFilter('user', 'abc')` calls `router.push` with `?user=abc` merged into existing params, and `clearAllFilters()` removes all 5 plugin keys without touching `q`
  - _Requirements: 3.1–3.6, 2.2_
  - _Boundary: hooks/use-filter-url-sync.ts_
  - _Depends: 5.5_

- [ ] 6.2 Implement `FilterBar` generic container component (P)
  - Create `apps/app/src/features/search/client/components/FilterBar/index.tsx`
  - Props: `filterValues: Readonly<Record<string, unknown>>`, `onFilterChange: (pluginId, value) => void`, `onClearAll: () => void`
  - Iterates `SEARCH_FILTER_PLUGINS`; renders `plugin.renderControl({ value: filterValues[plugin.id], onChange })` for each
  - Shows active-state badge/indicator when `!plugin.isEmpty(filterValues[plugin.id])` (Req 1.3)
  - Renders "Clear All" button when at least one plugin is non-empty (Req 1.4)
  - CSS Modules for layout — no global CSS imports (Turbopack Pages Router restriction)
  - Pure renderer: no `useRouter` calls, no internal state
  - Done when: rendered `FilterBar` shows 5 controls; a non-empty entry in `filterValues` triggers the active badge; "Clear All" button fires `onClearAll`
  - _Requirements: 1.1–1.5_
  - _Boundary: components/FilterBar/index.tsx_
  - _Depends: 5.5_

---

## Task 7: SearchPage Integration
- [ ] 7. SearchPage Integration
- [ ] 7.1 Wire `useFilterUrlSync` and `<FilterBar>` into `SearchPage`
  - In `apps/app/src/features/search/client/components/SearchPage/SearchPage.tsx`:
    - Call `useFilterUrlSync()` to get `filterValues`, `setFilter`, `clearAllFilters`, `activeApiParams`
    - Render `<FilterBar filterValues={filterValues} onFilterChange={setFilter} onClearAll={clearAllFilters} />` below `SearchControl`, guarded by `isSearchServiceConfigured && isSearchServiceReachable` (Req 1.1, 1.2)
    - Pass `filters: activeApiParams as ISearchFilterParams` into the `configurations` object consumed by `useSWRxSearch`
  - `FilterBar` is rendered inside the desktop layout block; `SearchOptionModal` is not modified (Req 1.5)
  - Done when: running the app shows `FilterBar` below `SearchControl`; selecting a user filter triggers a new API request with `?user=<id>` visible in network DevTools
  - _Requirements: 1.1, 1.2, 1.5, 2.1–2.3, 9.1_
  - _Boundary: SearchPage.tsx_
  - _Depends: 2.3, 3, 6.1, 6.2_

---

## Task 8: Tests
- [ ] 8. Tests
- [ ] 8.1 Unit tests — plugin `fromUrlParams` / `toUrlParams` (all 5 plugins) (P)
  - Co-locate test files next to each plugin file (`*.spec.ts`)
  - For each plugin: valid params → correct value; missing params → empty default; malformed/unrecognized params → empty default (null / ''); round-trip invariant: `isEmpty(fromUrlParams(new URLSearchParams(toUrlParams(v))))` holds for empty value
  - `createDatePresetPlugin` factory: verify `createdPreset` vs `updatedPreset` URL key distinction; verify `fromUrlParams` rejects unrecognized preset strings
  - Done when: `pnpm vitest run` passes all plugin spec files
  - _Requirements: 3.6, 4.5, 6.6, 7.6, 8.5_
  - _Boundary: client/plugins/*.spec.ts_
  - _Depends: 5.5_

- [ ] 8.2 Unit tests — `useFilterUrlSync` hook (P)
  - Create `use-filter-url-sync.spec.ts` co-located with the hook; mock `next/router`
  - `setFilter('user', 'abc')` → `router.push` called with `?user=abc` merged into existing params; existing `q`, `sort`, `order` preserved
  - `setFilter('user', null)` → `user` key removed from URL
  - `clearAllFilters()` → all 5 plugin URL keys removed; `q` and other non-filter params preserved
  - `activeApiParams` → only includes non-empty filter values
  - `router.beforePopState` is registered on mount (confirms Req 3.4 wiring is in place)
  - Done when: `pnpm vitest run use-filter-url-sync` passes all cases
  - _Requirements: 3.1–3.6, 2.2_
  - _Boundary: hooks/use-filter-url-sync.spec.ts_
  - _Depends: 6.1_

- [ ] 8.3 Unit tests — `buildFilterClauses()` (P)
  - Add test file co-located with `elasticsearch.ts`
  - User clause: `bool.should` with `term { username }` + `ids { values: lastUpdatePageIds }` + `minimum_should_match: 1`
  - Path clause: `prefix { 'path.raw': '/team' }`
  - `createdPreset: '30d'`: `range { created_at: { gte: <30-days-ago ISO> } }`; `updatedPreset: '30d'`: uses `updated_at` field
  - Group clause: `terms { username: [...memberUsernames] }`
  - Empty / undefined `resolvedFilterParams`: returns `[]`
  - AND combination: two active filters → two entries in the returned array, both appended to `bool.filter[]`
  - Done when: `pnpm vitest run elasticsearch.spec` passes all clause cases
  - _Requirements: 9.2–9.8_
  - _Boundary: search-delegator/elasticsearch.spec.ts_
  - _Depends: 2.1_

- [ ] 8.4 Unit tests — `SearchService` user/group resolution (P)
  - Mock `User.findById`, `Page.find`, `UserGroupRelation.findAllUserIdsForUserGroups`, `User.find`
  - User filter: not-found user → `EMPTY_SEARCH_RESULT` returned without calling delegator
  - User filter: valid user → correct `resolvedFilterParams.user = { username, lastUpdatePageIds }` passed to delegator
  - Group filter: empty group (0 members) → `EMPTY_SEARCH_RESULT`; valid group → correct `resolvedFilterParams.group = { memberUsernames }` passed to delegator
  - Malformed ObjectId → `CastError` caught → `EMPTY_SEARCH_RESULT`
  - No `filterParams` argument → delegator called without filter clauses; results identical to current behavior
  - Done when: `pnpm vitest run search.spec` passes all resolution cases
  - _Requirements: 9.2, 9.6, 9.7, 9.9_
  - _Boundary: server/service/search.spec.ts_
  - _Depends: 2.2_

- [ ] 8.5 Integration and E2E tests
  - **Integration**: User filter round-trip (`user=<objectId>` in request → server resolves → ES receives `bool.should` clause with `term { username }` + `ids`); group filter expansion (groupId → member usernames → ES `terms`); AND combination (two active filters → two entries in `bool.filter[]`); malformed ObjectId → API returns empty results, not 500
  - **E2E (critical user paths)**:
    - Apply User filter → filtered results contain only pages created or last-edited by that user; control shows user's name
    - Apply Created Date preset "Last 30 Days" → preset button highlighted; results are pages created within last 30 days
    - Apply Group filter → results show only pages whose creator is a member of that group; group name shown in control
    - Deep-link with `?user=<id>&group=<id>` → both filter controls pre-populated on page load; correct filtered results shown immediately
    - Back navigation → browser back restores previous filter values and results
    - Clear all filters → all controls reset; results match unfiltered keyword search
    - **Invalid user param**: load `?user=not-a-valid-objectid` → User filter control renders in default empty state (Req 4.5)
    - **Invalid group param**: load `?group=not-a-valid-objectid` → Group filter control renders in default empty state (Req 8.5)
  - Done when: integration tests pass via `pnpm vitest run`; E2E flows verified in browser (manually or via existing Playwright/Cypress harness if available)
  - _Requirements: 4.5, 8.5, 9.2, 9.6, 9.8, 9.9_
  - _Depends: 7.1_
