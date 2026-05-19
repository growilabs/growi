# Brief: search-filters

## Problem
GROWI's search page currently supports only keyword-based search with minimal controls (sort axis, include user/trash page toggles). Users have no way to narrow results by page author, last editor, or user group membership without knowing opaque internal query syntax. The search service already supports inline operators (`prefix:`, `tag:`) that are extracted directly from the `?q=` query string in `parseQueryString()`. There are no equivalent operators for people or group-based filtering, which is a significant gap in large team wikis.

## Current State
- `parseQueryString()` in `SearchService` parses `prefix:` and `tag:` tokens (and their `-` negation variants) directly from the `?q=` string and populates `QueryTerms` arrays
- `appendCriteriaForQueryString()` in `ElasticsearchDelegator` maps each `QueryTerms` array to an ES bool filter clause
- No `author:`, `editor:`, or `group:` operators exist; users who want to filter by these must know Elasticsearch query syntax
- `username` is already an indexed field in Elasticsearch — direct `term` filtering on it is possible without schema changes
- `SearchControl.tsx` exposes sort dropdowns and two binary toggles; no new UI controls are planned

## Desired Outcome
- Three new inline search operators — `author:username`, `editor:username`, `group:groupname` — and their negation variants (`-author:`, `-editor:`, `-group:`) work inside the existing search box alongside free-text keywords and existing operators
- `author:username` returns only pages whose creator has that username
- `editor:username` returns only pages whose most recent editor has that username
- `group:groupname` returns only pages authored by members of the named user group (internal and external)
- Unknown usernames and group names return an empty result set rather than an error
- Zero regression on existing operators (`prefix:`, `tag:`, quoted phrases, negated keywords) and existing search behavior
- No new UI components, no new URL parameters, no Elasticsearch schema changes

## Approach
**Extend the existing inline operator pipeline** — the same parse → resolve → delegate flow that already handles `prefix:` and `tag:`:

1. **Parse**: extend the regex and branching in `parseQueryString()` to recognise the three new operator prefixes and populate six new `QueryTerms` fields (`author`, `not_author`, `editor`, `not_editor`, `group`, `not_group`)
2. **Resolve**: add a `resolveOperatorTerms()` private method in `SearchService` that converts `editor` usernames to page IDs and `group` names to member usernames via read-only MongoDB queries, before the delegator is called; `author` terms need no resolution as `username` is already indexed
3. **Delegate**: extend `appendCriteriaForQueryString()` to push the corresponding ES clauses (`term`, `ids`, `terms`) into `bool.filter[]` using the parsed and resolved data

All changes are additive. No existing file's public surface is broken.

## Scope
- **In**:
  - Six new fields in `QueryTerms` and `ESTermsKey`; new `ResolvedFilterData` type; extended `SearchableData`
  - Regex and branching extension in `parseQueryString()`
  - `resolveOperatorTerms()` private method in `SearchService` + wiring into `searchKeyword()`
  - Six new ES clause builders in `appendCriteriaForQueryString()` + updated `AVAILABLE_KEYS`
  - Unit tests for parser, resolution, and ES clause builder; integration tests for the full `searchKeyword()` pipeline
- **Out**:
  - New UI components, filter bars, or dedicated filter controls
  - New URL parameters beyond `?q=`
  - Elasticsearch index schema or mapping changes
  - Date-based operators (planned for a future iteration)
  - Named query (`nq:`) system changes
  - Mobile `SearchOptionModal` changes
  - Changes to existing operator semantics (`prefix:`, `tag:`, phrase, negated keywords)

## Boundary Candidates
- **Types layer** (`interfaces/search.ts`): `QueryTerms` extension, `ResolvedFilterData`, `SearchableData` extension, `ESTermsKey` extension — pure type definitions, no runtime logic
- **Parser** (`service/search.ts` — `parseQueryString`): regex and branching; postcondition is that new tokens never appear in `match[]`
- **Resolution step** (`service/search.ts` — `resolveOperatorTerms` + `searchKeyword` wiring): MongoDB read-only queries; early-exit when no `editor`/`group` terms are present
- **ES clause builder** (`service/search-delegator/elasticsearch.ts` — `appendCriteriaForQueryString` + `AVAILABLE_KEYS`): no-op when resolved arrays are absent or empty

## Out of Boundary
- Modifying the existing `?q=` keyword parameter format or any existing operator regex branch
- Changing the Elasticsearch index schema or mappings
- Client-side code — no React, no Jotai, no SWR changes
- `UserGroup`, `ExternalUserGroup`, `User`, `Page`, `UserGroupRelation`, `ExternalUserGroupRelation` models — called read-only, not modified
- Changes to the audit log search or any other ES query path outside `SearchService`

## Upstream / Downstream
- **Upstream**: `SearchService.parseQueryString()` (token parsing), MongoDB models for resolution, `ElasticsearchDelegator.appendCriteriaForQueryString()` (clause building), Elasticsearch backend
- **Downstream**: Potential future operators (date ranges, tag combinations as inline operators), saved search, audit log filter (separate spec)

## Existing Spec Touchpoints
- **Extends**: The existing inline-operator mechanism in `SearchService` and `ElasticsearchDelegator` — no new subsystem, only additive changes to three existing files
- **Adjacent**: `suggest-path` spec (shares path-input patterns); `hotkeys` spec (search keyboard shortcuts are unaffected as the search box behavior is unchanged)

## Constraints
- All changes MUST be confined to three server-side files: `interfaces/search.ts`, `service/search.ts`, `service/search-delegator/elasticsearch.ts`
- Must NOT import server-side modules from client components (no client changes at all)
- Elasticsearch query extensions must use the existing `ElasticsearchDelegator` interface; no new ES client instances
- `EDITOR_PAGE_ID_LIMIT = 1000` — if a user has last-edited more than 1000 pages, only the 1000 most recently updated are matched; this is a documented, accepted limitation for V1
- `ExternalUserGroup` lookup uses `name` only (not the compound `{name, provider}` index) — a `group:` token may match the first external group with that name; acceptable approximation for V1
- Author and group filter values are raw strings in `?q=`; server resolves them to MongoDB ObjectIds and ES field values
- New `QueryTerms` fields must be registered in `AVAILABLE_KEYS` so existing `isTermsNormalized()` and `validateTerms()` calls continue to work without modification
