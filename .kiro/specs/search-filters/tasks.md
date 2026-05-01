# Implementation Plan

- [ ] 1. Type foundation
- [ ] 1.1 Extend shared type definitions in interfaces/search.ts
  - Add six new fields to `QueryTerms`: `author`, `not_author`, `editor`, `not_editor`, `group`, `not_group` (all `string[]`)
  - Add new `ESTermsKey` union members for all six new fields
  - Create `ResolvedFilterData` type with four fields: `editorPageIds`, `notEditorPageIds`, `groupMemberUsernames`, `notGroupMemberUsernames` (all `string[]`)
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
  - Add a private async method `resolveOperatorTerms(terms: QueryTerms): Promise<ResolvedFilterData>` to `SearchService`
  - Early-return with all four arrays empty when `terms.editor`, `terms.not_editor`, `terms.group`, and `terms.not_group` are all empty — no MongoDB queries issued in that case
  - **Editor resolution** (applied to both `terms.editor` and `terms.not_editor`): for each username call `User.findOne({ username })` — if null, contribute no page IDs; otherwise call `Page.find({ lastUpdateUser: user._id }).select('_id').sort({ updatedAt: -1 }).limit(1000)` and collect the `_id` strings
  - **Group resolution** (applied to both `terms.group` and `terms.not_group`): for each group name query `UserGroup.findOne({ name })` and `ExternalUserGroup.findOne({ name })` in parallel; collect non-null `_id` values; if none found, contribute no usernames; otherwise call `UserGroupRelation.findAllUserIdsForUserGroups` and `ExternalUserGroupRelation.findAllUserIdsForUserGroups` in parallel, deduplicate the merged member ID arrays, then call `User.find({ _id: { $in: memberIds } }).select('username')` and collect username strings
  - Done when: method returns correct `ResolvedFilterData` for known identifiers and returns all-empty arrays for unknown usernames or group names
  - _Requirements: 2.1, 3.1, 4.2, 4.3, 6.2, 6.3, 6.4_

- [ ] 3.2 Wire resolution into searchKeyword()
  - In `searchKeyword()`, call `resolveOperatorTerms(data.terms)` after `this.resolve(parsedQuery)` and before `delegator.search()`
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
    - `groupMemberUsernames` non-empty → `{ bool: { must: [{ terms: { username: groupMemberUsernames } }] } }`
    - `notGroupMemberUsernames` non-empty → `{ bool: { must_not: [{ terms: { username: notGroupMemberUsernames } }] } }`
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
  - **Resolution tests** (mock `User.findOne`, `User.find`, `Page.find`, `UserGroupRelation.findAllUserIdsForUserGroups`, `ExternalUserGroupRelation.findAllUserIdsForUserGroups`, `UserGroup.findOne`, `ExternalUserGroup.findOne`): known editor → non-empty `editorPageIds`; unknown editor → `editorPageIds:[]`; known group → correct `groupMemberUsernames` from both internal and external relations; unknown group → `groupMemberUsernames:[]`; group with no members → `groupMemberUsernames:[]`; no editor/group terms → early return with all-empty arrays
  - Done when: `pnpm vitest run search.spec` passes all cases
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 5.3, 5.4, 6.2, 6.3, 6.4_
  - _Boundary: search.spec.ts_
  - _Depends: 2.1, 3.1_

- [ ] 5.2 (P) Unit tests for ES clause builder
  - Co-locate with `service/search-delegator/elasticsearch.ts` (e.g. `elasticsearch.spec.ts`)
  - `author:['jim']` → `bool.filter` contains `term: { username: 'jim' }`
  - `not_author:['jim']` → `bool.filter` contains `must_not: { term: { username: 'jim' } }`
  - `editorPageIds:['id1','id2']` → `bool.filter` contains `ids: { values: ['id1','id2'] }`
  - `editorPageIds:[]` → no `ids` clause added
  - `groupMemberUsernames:['alice','bob']` → `bool.filter` contains `terms: { username: ['alice','bob'] }`
  - No `resolvedFilterData` → existing `bool.filter` content unchanged (regression)
  - Done when: `pnpm vitest run elasticsearch.spec` passes all clause cases
  - _Requirements: 1.1, 1.3, 2.1, 2.3, 3.1, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.4, 6.1_
  - _Boundary: elasticsearch.spec.ts_
  - _Depends: 4.1_

- [ ] 5.3 Full searchKeyword() integration test
  - Test the complete pipeline: `searchKeyword('author:jim report')` → ES query has `term: { username: 'jim' }` in `bool.filter` and `multi_match` on `report` in `bool.must`
  - `searchKeyword('group:dev-team')` → MongoDB resolution fires; ES query contains `terms: { username: [...memberUsernames] }`
  - `searchKeyword('author:jim tag:wiki prefix:/team')` → all three filter clauses present; existing operators unaffected
  - `searchKeyword('author:nonexistent')` → returns empty result, not a server error
  - `searchKeyword('group:nonexistent')` → returns empty result, not a server error
  - `searchKeyword('regular keyword')` → result identical to pre-change behavior (no regressions)
  - Done when: all integration scenarios pass via `pnpm vitest run`
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_
  - _Depends: 3.2, 4.2_
