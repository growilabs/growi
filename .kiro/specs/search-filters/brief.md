# Brief: search-filters

## Problem
GROWI's search page currently supports only keyword-based search with minimal controls (sort axis, include user/trash page toggles). Users have no way to narrow results by page author, last editor, or user group membership without knowing opaque internal query syntax. The search service already supports inline operators (`prefix:`, `tag:`) that are extracted directly from the `?q=` query string in `parseQueryString()`. There are no equivalent operators for people or group-based filtering, which is a significant gap in large team wikis.

## Current State
- `parseQueryString()` in `SearchService` parses `prefix:` and `tag:` tokens (and their `-` negation variants) directly from the `?q=` string and populates `QueryTerms` arrays
- `appendCriteriaForQueryString()` in `ElasticsearchDelegator` maps each `QueryTerms` array to an ES bool filter clause
- No `author:`, `editor:`, or `group:` operators exist; users who want to filter by these must know Elasticsearch query syntax
- `username` (page creator) is already an indexed field in Elasticsearch — direct `term` filtering on it is possible without schema changes
- There is **no** indexed last-editor field; `lastUpdateUser` lives only in MongoDB as an `ObjectId`. This spec adds a new `last_update_username` keyword field to the ES index so `editor:` can filter on it directly (symmetric with `author:`)
- `SearchControl.tsx` exposes sort dropdowns and two binary toggles; no new UI controls are planned

## Desired Outcome
- Three new inline search operators — `author:username`, `editor:username`, `group:groupname` — and their negation variants (`-author:`, `-editor:`, `-group:`) work inside the existing search box alongside free-text keywords and existing operators
- `author:username` returns only pages whose creator has that username
- `editor:username` returns only pages whose most recent editor has that username
- `group:groupname` returns only pages granted to the named user group (internal and external), scoped to groups the requesting user actually belongs to — specifying a group the user is not a member of yields no results for that group (e.g. a user in A,B who types `group:A,C` gets results for A only)
- Unknown usernames and group names return an empty result set rather than an error
- Zero regression on existing operators (`prefix:`, `tag:`, quoted phrases, negated keywords) and existing search behavior
- No new UI components, no new URL parameters
- One additive Elasticsearch schema change: a new `last_update_username` keyword field. `editor:` works only after administrators run a **full index rebuild** to populate it; there is no MongoDB fallback and no automatic backfill (rebuild required, communicated in release notes)

## Approach
**Extend the existing inline operator pipeline** — the same parse → resolve → delegate flow that already handles `prefix:` and `tag:` — plus a new indexed field so `editor:` can be a direct `term` match like `author:`:

0. **Index**: add a `last_update_username` keyword field to the ES mappings (es7/es8/es9), join `lastUpdateUser` in `aggregatePipelineToIndex()`, and write `last_update_username` in `prepareBodyForCreate()`. Both the full rebuild and every incremental edit share this path, so the field stays fresh after the initial rebuild
1. **Parse**: extend the regex and branching in `parseQueryString()` to recognise the three new operator prefixes and populate six new `QueryTerms` fields (`author`, `not_author`, `editor`, `not_editor`, `group`, `not_group`)
2. **Resolve**: add a `resolveGroupTerms()` private method in `SearchService` that converts `group` names to group IDs, then intersects them with the requesting user's own groups (so a user can only filter by groups they belong to), via read-only MongoDB queries, before the delegator is called. `author` and `editor` need **no** resolution — both map directly to indexed keyword fields (`username` / `last_update_username`)
3. **Delegate**: extend `appendCriteriaForQueryString()` to push the corresponding ES clauses into `bool.filter[]` — `term` for `author`/`editor`, `terms` on `granted_groups` for `group` — using the parsed and resolved data

All changes are additive. No existing file's public surface is broken.

## Scope
- **In**:
  - New `last_update_username` keyword field across all ES mappings (es7/es8/es9), the indexing aggregation (`aggregate-to-index.ts`), the doc body builder (`prepareBodyForCreate`), and the `AggregatedPage` / `BulkWriteBody` types (`bulk-write.d.ts`)
  - Six new fields in `QueryTerms` and `ESTermsKey`; new `ResolvedFilterData` type (group IDs only); extended `SearchableData`
  - Regex and branching extension in `parseQueryString()`
  - `resolveGroupTerms()` private method in `SearchService` + wiring into `searchKeyword()`
  - Six new ES clause builders in `appendCriteriaForQueryString()` + updated `AVAILABLE_KEYS`
  - Unit tests for parser, group resolution, indexing field, and ES clause builder; integration tests for the full `searchKeyword()` pipeline, including an incremental-edit test confirming `editor:` tracks `lastUpdateUser`
- **Out**:
  - New UI components, filter bars, or dedicated filter controls
  - New URL parameters beyond `?q=`
  - A MongoDB-based fallback for `editor:`, or automatic backfill/migration of `last_update_username` onto already-indexed pages (full rebuild is the supported path)
  - Date-based operators (planned for a future iteration)
  - Named query (`nq:`) system changes
  - Mobile `SearchOptionModal` changes
  - Changes to existing operator semantics (`prefix:`, `tag:`, phrase, negated keywords)

## Boundary Candidates
- **Types layer** (`interfaces/search.ts`): `QueryTerms` extension, `ResolvedFilterData` (group IDs only), `SearchableData` extension, `ESTermsKey` extension — pure type definitions, no runtime logic
- **Indexing field** (`mappings/mappings-es7|8|9.ts`, `aggregate-to-index.ts`, `bulk-write.d.ts`, `elasticsearch.ts` — `prepareBodyForCreate`): add and populate `last_update_username`, mirroring the existing `creator.username` precedent; shared by full rebuild and incremental writes
- **Parser** (`service/search.ts` — `parseQueryString`): regex and branching; postcondition is that new tokens never appear in `match[]`
- **Resolution step** (`service/search.ts` — `resolveGroupTerms` + `searchKeyword` wiring): MongoDB read-only queries for groups only; early-exit when no `group`/`not_group` terms are present (`author`/`editor` are not resolved here)
- **ES clause builder** (`service/search-delegator/elasticsearch.ts` — `appendCriteriaForQueryString` + `AVAILABLE_KEYS`): `term` for `author`/`editor`; no-op for `group` when resolved arrays are absent or empty

## Out of Boundary
- Modifying the existing `?q=` keyword parameter format or any existing operator regex branch
- Changing existing Elasticsearch fields or mappings beyond the additive `last_update_username` keyword field
- Automatic backfill/migration of `last_update_username` onto already-indexed pages, or a MongoDB fallback for `editor:`
- Client-side code — no React, no Jotai, no SWR changes
- `UserGroup`, `ExternalUserGroup`, `User`, `Page` models — called read-only, not modified (`UserGroupRelation` / `ExternalUserGroupRelation` are not used: `group:` resolves a group ID and filters on the ES `granted_groups` field, with no member-user resolution)
- Changes to the audit log search or any other ES query path outside `SearchService`

## Upstream / Downstream
- **Upstream**: `SearchService.parseQueryString()` (token parsing), MongoDB models for resolution, `ElasticsearchDelegator.appendCriteriaForQueryString()` (clause building), Elasticsearch backend
- **Downstream**: Potential future operators (date ranges, tag combinations as inline operators), saved search, audit log filter (separate spec)

## Existing Spec Touchpoints
- **Extends**: The existing inline-operator mechanism in `SearchService` and `ElasticsearchDelegator` — no new subsystem, only additive changes to three existing files
- **Adjacent**: `suggest-path` spec (shares path-input patterns); `hotkeys` spec (search keyboard shortcuts are unaffected as the search box behavior is unchanged)

## Constraints
- All changes are server-side only, confined to: `interfaces/search.ts`, `service/search.ts`, `service/search-delegator/elasticsearch.ts`, `service/search-delegator/aggregate-to-index.ts`, `service/search-delegator/bulk-write.d.ts`, and `service/search-delegator/mappings/mappings-es7|8|9.ts`
- Must NOT import server-side modules from client components (no client changes at all)
- Elasticsearch query extensions must use the existing `ElasticsearchDelegator` interface; no new ES client instances
- The new `last_update_username` field must mirror the existing `creator.username` indexing precedent exactly (same `$lookup`/`$unwind`/project shape, same `keyword` mapping type) across all three ES major versions
- `editor:` requires a full index rebuild to take effect on existing pages; no MongoDB fallback, no incremental backfill — administrators must be informed via release notes
- `ExternalUserGroup` lookup uses `name` only (not the compound `{name, provider}` index) — a `group:` token may match the first external group with that name; acceptable approximation for V1
- `group:` filter values are raw strings in `?q=`; the server resolves them to MongoDB ObjectIds and ES field values. `author`/`editor` values are passed straight through as exact `term` matches
- New `QueryTerms` fields must be registered in `AVAILABLE_KEYS` so existing `isTermsNormalized()` and `validateTerms()` calls continue to work without modification
