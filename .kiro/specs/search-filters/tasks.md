# Implementation Plan

- [ ] 1. Type foundation
- [ ] 1.1 Extend shared type definitions in interfaces/search.ts
  - Add six new fields to `QueryTerms`: `author`, `not_author`, `editor`, `not_editor`, `group`, `not_group` (all `string[]`)
  - Add new `ESTermsKey` union members for all six new fields
  - Create `ResolvedFilterData` type with four fields: `editorPageIds`, `notEditorPageIds`, `groupIds`, `notGroupIds` (all `string[]`)
  - Add optional `resolvedFilterData?: ResolvedFilterData` to the `SearchableData<T>` base type; verify the generic instantiation `SearchableData<ESQueryTerms>` still compiles without error after the addition
  - Done when: `pnpm run lint:typecheck` passes with no new errors and the six `QueryTerms` fields and `ResolvedFilterData` type are exported from `interfaces/search.ts`
  - _Requirements: 1.1, 2.1, 3.1, 4.1_
  - _Boundary: interfaces/search.ts_

---

- [ ] 2. Extend query parser
- [ ] 2.1 Recognise new operator prefixes in parseQueryString()
  - Extend the positive and negative regex patterns in `parseQueryString()` to include `author:`, `editor:`, and `group:` alongside the existing `prefix:` and `tag:`
  - Add branching to populate `author[]`, `not_author[]`, `editor[]`, `not_editor[]`, `group[]`, `not_group[]` arrays from matched tokens
  - Add an empty-value guard: if the captured value after the colon is an empty string, skip the token — do not add it to any array
  - Tokens with a recognised operator prefix must not be added to `match[]`; existing `prefix:`, `tag:`, phrase, and negated-word branches must remain unchanged
  - Done when: `parseQueryString('author:jim editor:alice group:dev report')` returns arrays `author:['jim']`, `editor:['alice']`, `group:['dev']`, `match:['report']` and `parseQueryString('author:')` returns `author:[]`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 5.3, 5.4_
  - _Depends: 1.1_

---

- [ ] 3. MongoDB resolution step
- [ ] 3.1 Implement resolveOperatorTerms() private method in SearchService
  - Add a private async method `resolveOperatorTerms(terms: QueryTerms, userGroups: IGrantedGroup[]): Promise<ResolvedFilterData>` to `SearchService`
  - Early-return with all four arrays empty when `terms.editor`, `terms.not_editor`, `terms.group`, and `terms.not_group` are all empty — no MongoDB queries issued in that case
  - **Editor resolution** (applied to both `terms.editor` and `terms.not_editor`): for each username call `User.findOne({ username })` — if null, contribute no page IDs; otherwise call `Page.find({ lastUpdateUser: user._id }).select('_id').sort({ updatedAt: -1 }).limit(1000)` and collect the `_id` strings
  - **Group resolution** (applied to both `terms.group` and `terms.not_group`): for each group name query `UserGroup.findOne({ name })` and `ExternalUserGroup.findOne({ name })` in parallel; collect non-null `_id` strings; if none found, contribute no group IDs (Req 6.3); otherwise intersect with `userGroups.map(g => g._id.toString())` — if the intersection is empty, contribute no group IDs (Req 3.5, 7.5 — user is not a member of this group); otherwise collect the valid group ID strings
  - Done when: method returns correct `ResolvedFilterData` for known identifiers, returns all-empty arrays for unknown group names, and returns empty `groupIds` when the user is not a member of the specified group
  - _Requirements: 2.1, 3.1, 3.5, 4.2, 4.3, 6.2, 6.3, 6.4, 7.5_

- [ ] 3.2 Wire resolution into searchKeyword()
  - In `searchKeyword()`, call `resolveOperatorTerms(data.terms, userGroups)` after `this.resolve(parsedQuery)` and before `delegator.search()`
  - Assign the result to `data.resolvedFilterData` so it is carried through `SearchableData` to the delegator
  - The method signature of `searchKeyword()` must remain unchanged — this is an internal addition only
  - Done when: a call to `searchKeyword` with `editor:alice` in the query causes `resolveOperatorTerms` to execute and `data.resolvedFilterData.editorPageIds` to be non-empty when alice exists
  - _Requirements: 2.1, 2.2, 3.1, 3.2_

---

- [ ] 4. Elasticsearch delegator extension
- [ ] 4.1 (P) Implement new filter clauses in appendCriteriaForQueryString()
  - Add `resolvedFilterData?: ResolvedFilterData` as a third parameter to `appendCriteriaForQueryString()`
  - Add six new conditional blocks pushed to `query.body.query.bool.filter[]`, following the existing `tag:` / `prefix:` pattern:
    - `author` terms → `{ bool: { must: [{ term: { username: value } }] } }` for each value
    - `not_author` terms → `{ bool: { must_not: [{ term: { username: value } }] } }`
    - `editorPageIds` non-empty → `{ bool: { must: [{ ids: { values: editorPageIds } }] } }`
    - `notEditorPageIds` non-empty → `{ bool: { must_not: [{ ids: { values: notEditorPageIds } }] } }`
    - `groupIds` non-empty → `{ bool: { must: [{ terms: { granted_groups: groupIds } }] } }`
    - `notGroupIds` non-empty → `{ bool: { must_not: [{ terms: { granted_groups: notGroupIds } }] } }`
  - When `resolvedFilterData` is absent or an array is empty, skip that clause — no change to `bool.filter[]`
  - Add all six new `QueryTerms` key names to the `AVAILABLE_KEYS` constant so `isTermsNormalized()` and `validateTerms()` accept them without error
  - Done when: calling `appendCriteriaForQueryString` with `author:['jim']` adds a `term: { username: 'jim' }` clause to `bool.filter[]`; calling it with no `resolvedFilterData` leaves the existing filter array unchanged
  - _Requirements: 1.1, 1.3, 2.1, 2.3, 3.1, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.4, 6.1_
  - _Boundary: elasticsearch.ts — appendCriteriaForQueryString and AVAILABLE_KEYS_
  - _Depends: 1.1_

- [ ] 4.2 Update the search() call site to pass resolvedFilterData
  - In `ElasticsearchDelegator.search()`, update the internal call to `appendCriteriaForQueryString()` to pass `data.resolvedFilterData` as the third argument
  - Done when: an end-to-end call with `editor:alice` reaches `appendCriteriaForQueryString` with a non-empty `editorPageIds` array and the resulting ES query contains an `ids` filter clause
  - _Requirements: 2.1, 3.1_
  - _Depends: 3.2, 4.1_

---

- [ ] 5. Tests
- [ ] 5.1 (P) Unit tests for parser and resolution
  - Co-locate with `service/search.ts` (e.g. `search.spec.ts`)
  - **Parser tests**: `parseQueryString('author:jim report')` → correct arrays; `parseQueryString('author:')` → empty author array (empty-value guard); `parseQueryString('-author:jim')` → `not_author:['jim']`; `parseQueryString('author:jim tag:wiki prefix:/team')` → all operators separated, match empty; existing behavior regression: `parseQueryString('regular keyword')` unchanged
  - **Resolution tests** (mock `User.findOne`, `User.find`, `Page.find`, `UserGroup.findOne`, `ExternalUserGroup.findOne`): known editor → non-empty `editorPageIds`; unknown editor → `editorPageIds:[]`; known group + user is member → correct `groupIds`; known group + user is NOT member → `groupIds:[]`; `group:A group:C` where user belongs to A but not C → `groupIds` contains only A's ID; unknown group → `groupIds:[]`; no editor/group terms → early return with all-empty arrays
  - Done when: `pnpm vitest run search.spec` passes all cases
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.3, 5.4, 6.2, 6.3, 6.4, 7.5_
  - _Boundary: search.spec.ts_
  - _Depends: 2.1, 3.1_

- [ ] 5.2 (P) Unit tests for ES clause builder
  - Co-locate with `service/search-delegator/elasticsearch.ts` (e.g. `elasticsearch.spec.ts`)
  - `author:['jim']` → `bool.filter` contains `term: { username: 'jim' }`
  - `not_author:['jim']` → `bool.filter` contains `must_not: { term: { username: 'jim' } }`
  - `editorPageIds:['id1','id2']` → `bool.filter` contains `ids: { values: ['id1','id2'] }`
  - `editorPageIds:[]` → no `ids` clause added
  - `groupIds:['id1','id2']` → `bool.filter` contains `terms: { granted_groups: ['id1','id2'] }`
  - No `resolvedFilterData` → existing `bool.filter` content unchanged (regression)
  - Done when: `pnpm vitest run elasticsearch.spec` passes all clause cases
  - _Requirements: 1.1, 1.3, 2.1, 2.3, 3.1, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.4, 6.1_
  - _Boundary: elasticsearch.spec.ts_
  - _Depends: 4.1_

- [ ] 5.3 Full searchKeyword() integration test
  - Test the complete pipeline: `searchKeyword('author:jim report')` → ES query has `term: { username: 'jim' }` in `bool.filter` and `multi_match` on `report` in `bool.must`
  - `searchKeyword('group:dev-team')` where user is a member → MongoDB resolution fires; ES query contains `terms: { granted_groups: [groupId] }`
  - `searchKeyword('group:dev-team')` where user is NOT a member → returns empty result; no `granted_groups` clause built
  - `searchKeyword('group:A group:C')` where user belongs to A but not C → `granted_groups` clause contains only A's ID
  - `searchKeyword('author:jim tag:wiki prefix:/team')` → all three filter clauses present; existing operators unaffected
  - `searchKeyword('author:nonexistent')` → returns empty result, not a server error
  - `searchKeyword('group:nonexistent')` → returns empty result, not a server error
  - `searchKeyword('regular keyword')` → result identical to pre-change behavior (no regressions)
  - Done when: all integration scenarios pass via `pnpm vitest run`
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.5, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.5_
  - _Depends: 3.2, 4.2_
