# Implementation Plan

- [ ] 1. Type foundation
- [ ] 1.1 Extend shared search type definitions
  - Add six new fields to `QueryTerms`: `author`, `not_author`, `editor`, `not_editor`, `group`, `not_group` (all `string[]`)
  - Add the six new `ESTermsKey` union members for those fields
  - Create the `ResolvedFilterData` type carrying **group IDs only**: `groupIds`, `notGroupIds` (both `string[]`) — editor is no longer resolved to page IDs, so no editor fields here
  - Add an optional `resolvedFilterData?: ResolvedFilterData` to `SearchableData`, keeping its existing generic parameter (`SearchableData<T = Partial<QueryTerms>>`) intact
  - Done when: `pnpm run lint:typecheck` passes with no new errors, the six `QueryTerms` fields and the group-only `ResolvedFilterData` are exported, and `SearchableData<ESQueryTerms>` still compiles
  - _Requirements: 1.1, 2.1, 2.5, 3.1, 4.1_
  - _Boundary: interfaces/search.ts_

---

- [ ] 2. Indexing: add and populate the `last_update_username` field
- [ ] 2.1 (P) Add `last_update_username` to all Elasticsearch mappings
  - Add `last_update_username: { type: 'keyword' }` alongside the existing `username` property in `mappings-es7.ts`, `mappings-es8.ts`, and `mappings-es9.ts`
  - Keep the three files structurally identical for this field, matching the existing `username` precedent
  - Done when: each of the three mapping files declares a `last_update_username` keyword property and `pnpm run lint:typecheck` passes
  - _Requirements: 2.1, 2.6_
  - _Boundary: mappings-es7.ts, mappings-es8.ts, mappings-es9.ts_

- [ ] 2.2 Populate `last_update_username` through the indexing pipeline
  - In the indexing aggregation, add a `lastUpdateUser` `$lookup`/`$unwind` (with `preserveNullAndEmptyArrays: true`) mirroring the existing `creator` join, and project `lastUpdateUser.username`
  - Extend the aggregated-page type to carry `lastUpdateUser?: { username: string }` and the bulk-write document type to carry `last_update_username?: string` (mirror `creator?` / `username?`)
  - In the document body builder (`prepareBodyForCreate`), write `last_update_username` from the page's last updater username; omit it gracefully when the page has no last updater
  - Both the full rebuild (`addAllPages`) and every incremental write (`updateOrInsertPages`) share this builder, so no second code path needs changing
  - Done when: indexing a page whose last updater is a known user produces an ES document containing `last_update_username` set to that username, and a page with no last updater indexes without error and without the field
  - _Requirements: 2.1, 2.6_
  - _Boundary: aggregate-to-index.ts, bulk-write.d.ts, elasticsearch.ts (prepareBodyForCreate)_

---

- [ ] 3. Query parser
- [ ] 3.1 Recognise the new operator prefixes in `parseQueryString()`
  - Extend the positive and negative regex patterns to include `author:`, `editor:`, and `group:` alongside the existing `prefix:` and `tag:`
  - Add branching to populate `author`, `not_author`, `editor`, `not_editor`, `group`, `not_group` from matched tokens
  - Add an empty-value guard: if the captured value after the colon is empty, skip the token entirely (no array entry)
  - Tokens with a recognised operator prefix must never be added to `match[]`; existing `prefix:`, `tag:`, phrase, and negated-word branches stay unchanged
  - Done when: `parseQueryString('author:jim editor:alice group:dev report')` yields `author:['jim']`, `editor:['alice']`, `group:['dev']`, `match:['report']`; `parseQueryString('author:')` yields `author:[]`; and `parseQueryString('regular keyword')` is unchanged from current behavior
  - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.3, 2.4, 3.1, 3.3, 3.4, 4.1, 4.2, 4.3, 5.3, 5.4_
  - _Depends: 1.1_

---

- [ ] 4. Group resolution
- [ ] 4.1 Implement group-name resolution against the user's own groups in `SearchService`
  - Add a private async method `resolveFilterData(terms, userGroups)` that resolves `group`/`not_group` names to the user's own group IDs and returns `ResolvedFilterData`. `userGroups` is `ObjectIdLike[] | null` (an ObjectId list, **not** `IGrantedGroup[]`)
  - Early-return with empty arrays — and issue **zero** MongoDB queries — when the user is a guest (`userGroups == null`) OR both `terms.group` and `terms.not_group` are empty. Guard on array emptiness, **not** on `groupTerms == null` (the parser initializes these to `[]`, so a `== null` guard never fires and would query on every search). Since `terms` is `Partial<QueryTerms>`, write it null-safely: `(terms.group?.length ?? 0) === 0 && (terms.not_group?.length ?? 0) === 0`
  - Fetch only the user's **own** groups in parallel: `UserGroup.find({ _id: { $in: userGroups } }).select('_id name')` + the `ExternalUserGroup` equivalent. `userGroups` is used directly as the `$in` operand — no element-shape handling (`id.toString()` / `g._id`) needed
  - Build a `name → [groupId]` map (read `group.id`; same-name groups accumulate all their IDs), then resolve each typed name against it (`names.flatMap(n => map.get(n) ?? [])`). A name the user has no group for resolves to `[]` — membership is enforced implicitly by the `_id ∈ userGroups` scope, so there is **no** separate intersect step
  - This method must NOT query `User` or `Page` — editor terms are not resolved here
  - Done when: the method returns correct `groupIds` for a known group the user belongs to, `[]` for an unknown group, `[]` when the user is not a member, and `[]` for a guest (`userGroups` null) — all without throwing; for `group:A group:C` where the user belongs only to A, `groupIds` contains only A's ID; and it issues zero MongoDB queries when no group operator is typed
  - _Requirements: 3.1, 3.5, 4.3, 6.3, 6.4, 7.5_
  - _Depends: 1.1_

- [ ] 4.2 Wire group resolution into `searchKeyword()`
  - Call the resolution method after the existing `resolve()` step and before the delegator search, and attach its result to the searchable data carried to the delegator
  - The public signature of `searchKeyword()` must remain unchanged — this is an internal addition only
  - Done when: a `searchKeyword` call containing `group:<known-group-the-user-belongs-to>` produces searchable data whose `resolvedFilterData.groupIds` is non-empty
  - _Requirements: 3.1, 3.2_
  - _Depends: 4.1_

---

- [ ] 5. Elasticsearch clause builder
- [ ] 5.1 Build the new filter clauses in `appendCriteriaForQueryString()`
  - Accept the resolved group data as an optional third parameter
  - Push clauses into the existing `bool.filter[]` array, following the existing `tag:`/`prefix:` pattern:
    - `author` → `term` on `username` (must); `not_author` → `term` on `username` (must_not)
    - `editor` → `term` on `last_update_username` (must); `not_editor` → `term` on `last_update_username` (must_not) — direct match, identical shape to author, no resolution
    - `group` (positive) → push `terms` on `granted_groups` (must) whenever the user typed `group:` (`terms.group.length > 0`), using the resolved `groupIds`. An empty `groupIds` becomes `terms: { granted_groups: [] }`, which matches **nothing** — so an unknown group (Req 6.3) or a group the user is not a member of (Req 3.5, 7.5) returns 0 results, NOT every remaining match. Do **not** gate this on `groupIds.length > 0`.
    - `not_group` (negation) → push `terms` on `granted_groups` (must_not) only when `notGroupIds` is non-empty. An unknown/non-member negated group must exclude nobody, so skipping on empty is correct here (Req 4.3) — this is the deliberate positive/negative asymmetry.
  - The group clause is omitted entirely **only** when neither `group` nor `not_group` was typed (both `terms` arrays empty) — that is regression safety (Req 5.4), distinct from "typed but resolved to empty". (`resolvedFilterData` is always present with possibly-empty arrays; gate on the typed `terms`, not on its presence.) `author:`/`editor:` always push their `term` (ES returns 0 for a non-matching value). Never widen access — all clauses are AND-ed into the same `bool.filter[]` so they cannot override the existing permission filter
  - NOTE: whether the group clauses live inside `appendCriteriaForQueryString` or a dedicated helper, the builder **must** receive `terms` (not just the resolved data) — gating the positive clause requires knowing whether `group:` was typed. A helper that takes only `resolvedFilterData` cannot tell "not typed" from "typed but resolved empty" and will incorrectly skip, returning everything
  - Register all six new `QueryTerms` keys in `AVAILABLE_KEYS` so `isTermsNormalized()` and `validateTerms()` accept them
  - Done when: an `author:['jim']` term adds a `term: { username: 'jim' }` clause; an `editor:['alice']` term adds a `term: { last_update_username: 'alice' }` clause; a typed `group:` whose resolved `groupIds` is empty adds a match-nothing `terms: { granted_groups: [] }` clause (NOT skipped); calling with no group terms typed at all leaves the existing filter array byte-for-byte unchanged
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.5, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4_
  - _Depends: 1.1_

- [ ] 5.2 Pass resolved group data at the delegator search call site
  - Update the delegator's internal `appendCriteriaForQueryString()` call to forward the resolved group data from the searchable data
  - Done when: an end-to-end `searchKeyword` call with `group:<member-group>` produces an ES query whose `bool.filter[]` contains a `terms: { granted_groups: [...] }` clause
  - _Requirements: 3.1, 3.2_
  - _Depends: 4.2, 5.1_

---

- [ ] 6. Tests
- [ ] 6.1 (P) Unit tests for the parser and group resolution
  - Parser: `author:jim report` → correct arrays with `match` free of the operator token; `author:` → empty author array (empty-value guard); `-author:jim` → `not_author:['jim']`; `-editor:alice` → `not_editor:['alice']`; `author:jim editor:alice group:dev tag:wiki prefix:/team` → all operators separated, `match` empty; `regular keyword` → unchanged (regression)
  - Group resolution (mock the group-model lookups): known group + member → correct `groupIds`; known group + non-member → empty `groupIds`; `group:A group:C` with membership in A only → only A's ID; unknown group → empty; guest (`userGroups` is `null`) → empty `groupIds`, no throw; no group terms → early return with **zero** `UserGroup`/`ExternalUserGroup` calls (guard on emptiness, not `== null`); assert `User`/`Page` are never queried; assert the lookup is `find({ _id: { $in: userGroups } })` (scoped to the user's own groups) and reads `group.id`
  - Done when: `pnpm vitest run search.spec` passes all cases
  - _Requirements: 1.1, 1.3, 1.4, 2.3, 2.4, 3.1, 3.4, 3.5, 4.1, 4.2, 4.3, 5.3, 5.4, 6.3, 6.4, 7.5_
  - _Boundary: search.spec.ts_
  - _Depends: 3.1, 4.2_

- [ ] 6.2 (P) Unit tests for the clause builder and document body
  - Clause builder: `author:['jim']` → `term: { username: 'jim' }`; `not_author:['jim']` → `must_not` `term` on `username`; `editor:['alice']` → `term: { last_update_username: 'alice' }`; `not_editor:['alice']` → `must_not` `term` on `last_update_username`; non-empty group IDs → `terms: { granted_groups: [...] }`; typed `group:` with empty group IDs → match-nothing `terms: { granted_groups: [] }` clause (NOT skipped); no group term typed → filter array unchanged (regression)
  - Document body: building the body for a page with a last updater sets `last_update_username`; building it for a page without one leaves the field undefined and does not throw
  - Done when: `pnpm vitest run elasticsearch.spec` passes all cases
  - _Requirements: 1.1, 2.1, 2.5, 2.6, 3.1, 4.1, 4.2, 5.4, 6.1, 6.2, 6.3_
  - _Boundary: elasticsearch.spec.ts_
  - _Depends: 5.1, 2.2_

- [ ] 6.3 (P) Unit test for the indexing aggregation shape
  - Assert the generated aggregation pipeline contains a `lastUpdateUser` lookup against the users collection and projects `lastUpdateUser.username`
  - Done when: `pnpm vitest run aggregate-to-index.spec` passes and confirms the lookup and projection are present
  - _Requirements: 2.6_
  - _Boundary: aggregate-to-index.spec.ts_
  - _Depends: 2.2_

- [ ] 6.4 Full pipeline and indexing integration tests
  - `searchKeyword('author:jim report')` → `bool.filter` has `term: { username: 'jim' }` and `bool.must` has `multi_match` on `report`
  - `searchKeyword('editor:alice report')` → `bool.filter` has `term: { last_update_username: 'alice' }`; confirm no MongoDB resolution fired for the editor term
  - `searchKeyword('group:dev')` where the user is a member → `terms: { granted_groups: [groupId] }` present; where the user is NOT a member → empty result via a match-nothing `terms: { granted_groups: [] }` clause (clause present, not skipped); `group:A group:C` (member of A only) → clause contains only A's ID
  - `searchKeyword('author:jim editor:alice tag:wiki prefix:/team')` → all clauses present, existing operators unaffected
  - `author:nonexistent`, `editor:nonexistent`, `group:nonexistent` → empty result, not a server error; `regular keyword` → identical to pre-change behavior
  - Incremental refresh: index a page (last updater = alice), edit it so the last updater becomes bob, re-index via the incremental path → `editor:bob` returns the page and `editor:alice` no longer does
  - Done when: all scenarios pass via `pnpm vitest run`
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.6, 3.1, 3.2, 3.5, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.5_
  - _Depends: 5.2, 4.2, 2.2_
