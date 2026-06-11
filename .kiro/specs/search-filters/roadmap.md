# Roadmap

## Overview
Extend GROWI's search with three new **inline search operators** — `author:`, `editor:`, and `group:` (plus their `-` negation variants) — typed directly into the existing `?q=` search box alongside free-text keywords and the existing `prefix:` / `tag:` operators. There are **no new UI components and no new URL parameters**; all state stays in `?q=`. Parsing, resolution, and filter application are entirely server-side, extending the existing `parseQueryString()` → delegate pipeline.

This is a single-spec project. The operators reuse the existing inline-operator mechanism in `SearchService` and `ElasticsearchDelegator`, adding one new indexed Elasticsearch field so `editor:` can filter as efficiently as `author:`.

## Approach Decision
- **Chosen**: Extend the existing inline-operator pipeline (parse → resolve → delegate), and add a new indexed `last_update_username` field so `editor:` maps directly to it.
- **Why**:
  - The search box already supports inline operators (`prefix:`, `tag:`); users get structured filtering with zero new UI and zero new URL params.
  - `author:` reuses the already-indexed `username` field; `group:` reuses the already-indexed `granted_groups` field.
  - `editor:` is made symmetric with `author:` by indexing a new `last_update_username` keyword field, rather than resolving usernames to page IDs via MongoDB. This removes a query-time round-trip and the previous 1000-page cap.
- **Rejected alternatives**:
  - **UI Filter Bar with a plugin registry** (the prior direction): new client components, `FilterPlugin<T>` interface, dedicated URL params per filter. Rejected in favor of the lower-surface-area inline-operator approach, which requires no client changes and no new URL params.
  - **MongoDB resolution for `editor:`** (the prior inline-operator design): resolve `username → User._id → Page._id[]` and filter on `ids`. Rejected because it caps results at 1000 pages and adds query-time MongoDB load; the indexed-field approach is simpler and cap-free.

## Scope
- **In**: `author:` / `editor:` / `group:` inline operators and their negation variants; server-side parsing extension; group name→ID resolution scoped to the requesting user's groups; new `last_update_username` indexed ES field (mappings + indexing pipeline) so `editor:` filters directly; new ES filter clauses in the delegator; unit and integration tests.
- **Out**:
  - New UI components, filter bars, or dedicated filter controls
  - New URL parameters beyond `?q=`
  - **Date-based operators and a `path:`-style operator** (deferred to a future iteration / V2)
  - A MongoDB fallback for `editor:`, or automatic backfill/migration of `last_update_username` onto already-indexed pages
  - Named query (`nq:`) system changes; mobile `SearchOptionModal` changes; changes to existing operator semantics

## Operational Precondition
- `editor:` filters against the new `last_update_username` field, which exists only on pages indexed after the mapping change. **Administrators must run a full index rebuild** for `editor:` to return results on existing pages. There is no MongoDB fallback and no incremental backfill — this must be communicated in the release notes.
- `author:` and `group:` are unaffected (they use fields already present on indexed documents).

## Constraints
- Server-side only: changes confined to `interfaces/search.ts`, `service/search.ts`, `service/search-delegator/elasticsearch.ts`, `service/search-delegator/aggregate-to-index.ts`, `service/search-delegator/bulk-write.d.ts`, and the three ES mapping files (`mappings-es7|8|9.ts`).
- No server-side imports from client components (no client changes at all).
- Elasticsearch extensions via the existing `ElasticsearchDelegator` only; no new ES client.
- The new `last_update_username` field must mirror the existing `creator.username` indexing precedent exactly (same `$lookup`/`$unwind`/project shape, `keyword` mapping type) across all three ES major versions.
- New `QueryTerms` keys must be registered in `AVAILABLE_KEYS` so existing `isTermsNormalized()` / `validateTerms()` continue to work unchanged.

## Boundary Strategy
- **Why this split** (within the single spec): types, indexing field, parser, group resolution, and the ES clause builder are kept as separate concerns so each can be implemented, tested, and reviewed independently.
- **Shared seams to watch**:
  - The indexing field touches `aggregate-to-index.ts`, `bulk-write.d.ts`, and `prepareBodyForCreate` together — all must agree on the `last_update_username` shape. Both full rebuild and incremental writes share this path.
  - The ES clauses pushed by `appendCriteriaForQueryString()` go into the same `bool.filter[]` (AND) as the existing permission filter, so the new operators can never widen access.

## Specs (dependency order)
- [ ] search-filters -- Inline search operators `author:`, `editor:`, `group:` (with negation), server-side only, plus a new indexed `last_update_username` field for `editor:`. Dependencies: none
