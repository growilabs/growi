# Research & Design Decisions

---

## Summary
- **Feature**: `search-filters`
- **Discovery Scope**: Complex Extension (new plugin framework layered on existing search stack)
- **Key Findings (updated after requirements revision)**:
  - ES indexes `username` (string) for creator only — `lastUpdateUser` is a Mongoose-only field not in the ES index — User filter requires a two-phase MongoDB+ES approach
  - `UserGroupRelation.findAllUserIdsForUserGroups([groupId])` is an existing static method — Group filter resolves creator membership without schema changes
  - Date filters are now preset-only (4 buttons) — `react-datepicker` is no longer needed by this feature; `DatePresetControl` uses a simple Reactstrap ButtonGroup
  - `ISearchConfigurations` must be extended with optional `filters` to carry filter params through the existing SWR hook without breaking backward compatibility
  - The brief's `toElasticsearchClause()` on the client FilterPlugin interface violates server-client boundary — ES clause building belongs entirely on the server

---

## Research Log

### Elasticsearch Document Field Mapping
- **Context**: Need exact ES field names for each filter type
- **Sources**: `apps/app/src/server/service/search-delegator/elasticsearch.ts` (mappings), subagent code analysis
- **Findings**:
  - `username` — creator's username string (keyword). NOT an ObjectId.
  - `path` — page path with `.raw`, `.ja`, `.en` variants
  - `created_at` — creation date (ISO `date_optional_time` format)
  - `updated_at` — last updated date (ISO `date_optional_time` format)
  - `granted_users` — array of user ObjectId strings (keyword)
  - `granted_groups` — array of group ObjectId strings (keyword)
- **Implications**:
  - Author filter: client sends user ObjectId → server resolves → queries `username` field
  - Group filter: client sends group ObjectId → server queries `granted_groups` field directly (no resolution needed)
  - Date filters: ES range query on `created_at` / `updated_at` with ISO strings
  - Path filter: prefix query on `path.raw` (consistent with existing prefix: operator behavior)

### User Filter: Two-Phase MongoDB+ES Approach
- **Context**: Req 4 requires matching pages where the selected user is creator OR most recent editor (`lastUpdateUser`). ES only indexes `username` (creator) — no last-editor field.
- **Sources**: `apps/app/src/server/models/page.ts` (line 254), ES mappings
- **Findings**:
  - `Page.lastUpdateUser` — ObjectId ref to User, set on every page save. Confirmed in `packages/core/src/interfaces/page.ts` as `lastUpdateUser?: Ref<IUser>`.
  - NOT indexed in Elasticsearch — no `lastUpdateUser` in ES mappings.
  - `/api/v3/users` endpoint exists; `useSWRxUsernames()` hook available for typeahead.
- **Implications**:
  - Phase 1: resolve `userId` → `username` via `User.findById(userId).select('username')`
  - Phase 2: query MongoDB for page IDs where `lastUpdateUser = userId`: `Page.find({ lastUpdateUser: userId }).select('_id').sort({ updatedAt: -1 }).limit(USER_FILTER_PAGE_ID_LIMIT).lean()`
  - ES clause: `{ bool: { should: [{ term: { username } }, { ids: { values: pageIds } }], minimum_should_match: 1 } }`
  - Cap lastUpdateUser page lookup at 1000 most recent pages to keep ES `ids` query manageable. Documented limitation.

### Group Filter: UserGroupRelation Membership Expansion
- **Context**: Req 8 requires filtering by creator's group membership — not by page grants.
- **Sources**: `apps/app/src/server/models/user-group-relation.ts`
- **Findings**:
  - `UserGroupRelation` model with `relatedGroup` and `relatedUser` ObjectId fields.
  - Static method: `UserGroupRelation.findAllUserIdsForUserGroups([groupId])` — returns array of unique user ObjectIds.
  - Follow-up: get usernames via `User.find({ _id: { $in: memberIds } }).select('username').lean()`
  - ES clause: `{ terms: { username: memberUsernames } }`
- **Implications**: Two DB queries per search with group filter (group relations + user usernames). For large groups, the ES `terms` query can handle hundreds of usernames without issue. No ES schema change required.

### Existing Typeahead Library and Date Preset Simplification
- **Context**: Need UI components for User (user select), Group (group select), and Date filters
- **Sources**: `apps/app/package.json`, `SearchUsernameTypeahead.tsx`
- **Findings**:
  - `react-bootstrap-typeahead` v6.3.2 — already used in `Admin/AuditLog/SearchUsernameTypeahead.tsx`
  - Date filters now use **preset buttons** (Last 7, 30, 90 Days, Last Year) — NOT free-form date inputs. `react-datepicker` is no longer needed by this feature (still used in AuditLog; not removed).
  - No existing `UserPicker` or `GroupPicker` component in search feature — needs to be built.
- **Implications**: Zero new npm dependencies required. `DatePresetControl` is a simple Reactstrap `ButtonGroup` — no vendor CSS concerns for date controls.

### URL Sync Pattern
- **Context**: How does GROWI currently sync search state to URL?
- **Sources**: `apps/app/src/states/search/keyword-manager.ts`
- **Findings**:
  - Uses `useRouter()` directly, `router.query.q` for keyword
  - `router.beforePopState()` for back/forward navigation
  - No generalized URL param utility exists
- **Implications**: `useFilterUrlSync` will follow the same `router.push()` + `beforePopState` pattern, extended to handle multiple filter keys atomically.

### SWR Hook Extension Point
- **Context**: How to pass filter params through the existing data-fetching layer
- **Sources**: `apps/app/src/stores/search.tsx`
- **Findings**:
  - `useSWRxSearch(keyword, nqName, configurations)` where `configurations: ISearchConfigurations`
  - SWR key includes `configurations` — filter params in configurations automatically invalidate the cache key
  - Backward-compatible: making `filters` optional in `ISearchConfigurations` means existing call sites need no changes
- **Implications**: Extend `ISearchConfigurations` with `filters?: ISearchFilterParams`. The SWR key will naturally include filter state, triggering refetch when filters change.

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Decision |
|--------|-------------|-----------|---------------------|----------|
| Static Plugin Registry (chosen) | Fixed array of `FilterPlugin` descriptors; `FilterBar` iterates generically | Simple, type-safe at plugin boundary, zero runtime overhead, trivially extensible by adding one file + one registry line | `FilterBar` sees `unknown` value type (acceptable: plugins are typed internally) | **Selected** |
| Jotai Atom Registry | Each filter registers a Jotai atom; `atomWithHash` for URL sync | Reactive URL sync, consistent with Jotai-first state | `atomWithHash` not used in GROWI (new dependency or custom impl); complex registration ceremony for 5 known filters | Rejected |
| React Context Registry | `SearchFilterProvider` holds plugin map; plugins self-register on mount | Self-registration feels clean | Mount-order fragility; Context re-renders on any filter change; harder to test | Rejected |

---

## Design Decisions

### Decision: User Filter Uses Two-Phase MongoDB+ES Query (creator OR lastUpdateUser)
- **Context**: `lastUpdateUser` is not indexed in ES; Req 4.3 requires matching creator OR last editor
- **Alternatives Considered**:
  1. Add `last_updated_username` to ES index — schema change, reindex required (out of scope)
  2. Two-phase: resolve username + get lastUpdateUser page IDs from MongoDB, combine in ES `bool.should` with `ids` query
  3. Query MongoDB for all matching page IDs, skip ES entirely — loses keyword relevance ranking
- **Selected Approach**: Option 2 — two-phase MongoDB+ES. Phase 1: `User.findById` for username. Phase 2: `Page.find({ lastUpdateUser: userId })` limited to 1000 most recent. ES: `bool.should [term username, ids pageIds]`.
- **Rationale**: Avoids ES schema change; preserves keyword relevance from ES; ES `ids` query is fast and doesn't depend on any indexed field.
- **Trade-offs**: Cap of 1000 pages for lastUpdateUser match (documented limitation). Two extra DB queries per search with user filter.
- **Follow-up**: Constant `USER_FILTER_PAGE_ID_LIMIT = 1000` defined in SearchService.

### Decision: Group Filter Uses Creator Membership Expansion (not granted_groups)
- **Context**: Requirements changed from "pages granted to group" to "pages whose creator is in the group"
- **Alternatives**:
  1. `granted_groups` ES field — wrong semantics (about page access, not authorship)
  2. `UserGroupRelation.findAllUserIdsForUserGroups()` → usernames → ES `terms: { username }` — correct semantics, no schema change
- **Selected Approach**: Option 2. Existing `UserGroupRelation.findAllUserIdsForUserGroups([groupId])` method; then `User.find` for usernames; then ES `terms`.
- **Rationale**: Correct semantics per Req 8.3. Reuses existing model method. No schema change.
- **Trade-offs**: Two DB queries per search with group filter. For groups with 0 members, return empty immediately.

### Decision: Date Presets as Enum String (not DateRange object)
- **Context**: Date filters simplified from free-form inputs to 4 fixed presets
- **Selected Approach**: `DatePreset = '7d' | '30d' | '90d' | '1y'` string literal union. `createDatePresetPlugin(config)` factory replaces `createDateRangePlugin(config)`. Server translates preset to ES range clause at query time.
- **Rationale**: Simpler URL representation (single param vs two); simpler UI (ButtonGroup vs two datepickers); server-side translation is trivial and keeps client free of date arithmetic.
- **Trade-offs**: Cannot express arbitrary date ranges. Accepted by requirements design.

### Decision: Remove `toElasticsearchClause()` from Client FilterPlugin
- **Context**: Brief included `toElasticsearchClause()` in the `FilterPlugin` interface, which would require importing server-side ES logic in client modules
- **Alternatives Considered**:
  1. Keep it — share ES clause building between client and server
  2. Remove it — server builds all ES clauses from URL params independently
- **Selected Approach**: Remove it. Server independently maps `ISearchFilterParams` → ES clauses in `ElasticsearchDelegator.buildFilterClauses()`. Client FilterPlugin is responsible only for UI and URL serialization.
- **Rationale**: Server-client boundary is a hard constraint in GROWI (Turbopack externalisation, `apps/app/src/server/` separation). Having ES import logic in client bundle would violate this.
- **Trade-offs**: The plugin definition is split between client (UI/URL) and server (ES clause) — a contributor adding a new filter must update both sides. Documented in the plugin implementation guide.
- **Follow-up**: Ensure server-side `buildFilterClauses` handles unknown/missing params gracefully.

### Decision: `useFilterUrlSync` Called in SearchPage, Not FilterBar
- **Context**: Where to call the hook that owns filter state
- **Alternatives**:
  1. Inside `FilterBar` — FilterBar owns state, exposes `activeApiParams` via prop callback
  2. In `SearchPage` — state lifted to page level, passed down to both FilterBar and useSWRxSearch
- **Selected Approach**: Option 2 — `SearchPage` calls `useFilterUrlSync`, passes values + callbacks to `FilterBar`, passes `activeApiParams` to `useSWRxSearch`.
- **Rationale**: `useSWRxSearch` needs filter params; lifting state to the common parent avoids prop drilling or additional global state. Keeps `FilterBar` as a pure rendering component.
- **Trade-offs**: `SearchPage` grows slightly, but the data flow is unambiguous (URL → hook → SearchPage → children).

### Decision: Author Filter Sends ObjectId, Server Resolves Username
- **Context**: ES stores `username` (string), clients work with user ObjectIds
- **Alternatives**:
  1. Client sends username directly, server uses it directly in ES query
  2. Client sends ObjectId, server resolves to username before ES query
- **Selected Approach**: Option 2 — ObjectId in URL (`?author=<objectId>`), server resolves to username via MongoDB.
- **Rationale**: Username can change; ObjectId is the stable identifier. The `/api/v3/users` typeahead returns user objects with ObjectIds, so storing ObjectId in the URL is natural. One extra DB query per search with author filter is negligible.
- **Trade-offs**: Extra DB query per request; if user is not found, return empty results (Req 4.5).

### Decision: createDateRangePlugin Factory for Created/Updated Date Filters
- **Context**: Created Date and Updated Date filters are structurally identical
- **Selected Approach**: A `createDateRangePlugin(config: DateRangePluginConfig)` factory function produces both plugins with shared logic. Each plugin specifies which ES fields (`created_at` / `updated_at`) and which URL param keys (`createdFrom`/`createdTo` vs `updatedFrom`/`updatedTo`).
- **Rationale**: Avoids code duplication; any bug fix or improvement to date range behavior applies to both filters automatically.
- **Trade-offs**: One extra level of indirection (factory vs direct object literal).

---

## Risks & Mitigations
- **Author username resolution latency**: Extra DB query on every search with author filter. Mitigation: MongoDB indexed on `_id` (O(1) lookup); negligible in practice. If it becomes a bottleneck, cache in Redis (future optimization).
- **Turbopack CSS restriction**: `react-datepicker` injects global CSS. Mitigation: Follow the vendor-styles-components pattern established in the app. Import datepicker CSS via a pre-compiled vendor stylesheet (see `apps/app/.claude/skills/vendor-styles-components`).
- **Back/forward navigation with mixed filter + keyword state**: `useFilterUrlSync` must update `beforePopState` to handle all filter keys together, or browser back/forward may restore an inconsistent URL state. Mitigation: Reconstruct full filter state from router.query on every `popstate` event.
- **Path filter collision with existing `prefix:` operator**: If user has both a Path filter active AND embeds `prefix:/path` in the keyword, duplicate prefix clauses appear in ES query. Mitigation: Documented as expected (additive behavior); both constraints apply.

---

## References
- `apps/app/src/server/service/search.ts` — SearchService main implementation
- `apps/app/src/server/service/search-delegator/elasticsearch.ts` — ES query builder
- `apps/app/src/stores/search.tsx` — useSWRxSearch hook
- `apps/app/src/states/search/keyword-manager.ts` — existing URL sync pattern
- `apps/app/src/client/components/Admin/AuditLog/DateRangePicker.tsx` — react-datepicker usage reference
- `apps/app/src/client/components/Admin/AuditLog/SearchUsernameTypeahead.tsx` — react-bootstrap-typeahead usage reference
