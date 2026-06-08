# Research Log: search-filters

## Discovery Scope

Extension discovery (light process). Feature extends existing `parseQueryString()` + `ElasticsearchDelegator` pipeline with three new inline operators.

---

## Key Findings

### Existing QueryTerms (interfaces/search.ts)

```typescript
export type QueryTerms = {
  match: string[];        // free-text words → ES multi_match (must)
  not_match: string[];
  phrase: string[];       // quoted phrases → ES multi_match phrase
  not_phrase: string[];
  prefix: string[];       // prefix: operator → ES prefix on path.raw (filter)
  not_prefix: string[];
  tag: string[];          // tag: operator → ES term on tag_names (filter)
  not_tag: string[];
};
```

All current keys are `ESTermsKey`. `MongoTermsKey` covers `match | not_match | prefix | not_prefix` only.

### ES Clause Pattern (elasticsearch.ts)

`appendCriteriaForQueryString()` pushes all filter clauses into `query.body.query.bool.filter[]`:

```typescript
// tag: pattern (template for author: and group:)
if (parsedKeywords.tag.length > 0) {
  const queries = parsedKeywords.tag.map(tag => ({ term: { tag_names: tag } }));
  query.body.query.bool.filter.push({ bool: { must: queries } });
}
if (parsedKeywords.not_tag.length > 0) {
  const queries = parsedKeywords.not_tag.map(tag => ({ term: { tag_names: tag } }));
  query.body.query.bool.filter.push({ bool: { must_not: queries } });
}
```

### ES Indexed Fields

| ES field | ES type | Source |
|---|---|---|
| `username` | `keyword` | `page.creator.username` — already indexed |
| `tag_names` | `keyword` | PageTagRelation |
| `path.raw` | `keyword` (subfield) | page.path |
| `created_at` | `date` | |
| `updated_at` | `date` | |

**Critical**: No `last_update_username` field exists in ES. `lastUpdateUser` in the Page model is `ObjectId` (ref User) — not projected into the ES index. `editor:` operator requires MongoDB pre-resolution.

### Page.lastUpdateUser

```typescript
lastUpdateUser: { type: Schema.Types.ObjectId, ref: 'User' }
```

Not in ES index — `editor:` must resolve `username → User._id → Page._id[]` via MongoDB before building ES clause.

### UserGroup / ExternalUserGroup

- `UserGroup.name` — required, globally unique string — the identifier users type in `group:groupname`
- `ExternalUserGroup.name` — unique per `{name, provider}` compound index (not globally unique)
- Only the group **name → group ID** lookup is needed (`UserGroup.findOne({ name })` / `ExternalUserGroup.findOne({ name })`). The resolved group ID is used directly against the ES `granted_groups` field — there is **no** member-user resolution step, so `UserGroupRelation` / `ExternalUserGroupRelation` are not queried by this feature.
- `IGrantedGroup[]` (the requesting user's groups, already passed into `searchKeyword()`) supplies the membership set the resolved group IDs are intersected against — no relation query is needed to obtain it.

### User.username

```typescript
username: { type: String, required: true, unique: true }
```

Globally unique login identifier. Correct field for `author:` and `editor:` operators.

---

## Design Decisions

### D1: author: maps directly to ES `username` field

`author:jim` → `term: { username: 'jim' }` in `bool.filter`. No MongoDB resolution needed. Same pattern as `tag:` on `tag_names`. Rationale: `username` is already indexed as `keyword`; exact match is the correct semantic.

### D2: editor: resolved via MongoDB to page IDs

Since `last_update_username` is not in ES, `editor:alice` requires:
1. `User.findOne({ username: 'alice' })` → `userId`
2. `Page.find({ lastUpdateUser: userId }).select('_id').limit(EDITOR_PAGE_ID_LIMIT)` → `pageIds[]`
3. ES `ids: { values: pageIds }` clause in `bool.filter`

`EDITOR_PAGE_ID_LIMIT = 1000` — documented limitation. Adding a new ES field was ruled out (no ES schema changes per requirements boundary).

### D3: group: resolved to a group ID, intersected with the user's groups, applied to ES `granted_groups`

`group:dev-team` requires:
1. `UserGroup.findOne({ name: 'dev-team' })` + `ExternalUserGroup.findOne({ name: 'dev-team' })` → resolved groupId(s)
2. **Intersect** the resolved IDs with the requesting user's own groups (`IGrantedGroup[]` already passed into `searchKeyword()`). Only IDs the user belongs to survive.
3. ES `terms: { granted_groups: [validGroupIds] }` clause in `bool.filter`

No member-user resolution: the page documents are already indexed with a `granted_groups` field, so a group ID matches pages directly. There is no `User.find` / `memberUsernames` step.

**Intersection is a hard requirement, not an optimization (Req 3.5, 7.5).** A user who belongs to groups A and B but types `group:A,C` must get results scoped to **A only** — C is silently dropped because the user is not a member. Without the intersect, `group:C` would let a non-member enumerate pages granted to C, widening access. The resolved-then-intersected set can therefore only ever be a subset of the user's existing group access, so the clause can never broaden the permission filter that already lives in the same `bool.filter[]`.

Rationale for including ExternalUserGroup: external groups also appear in `granted_groups` and in the user's `IGrantedGroup[]`, so both must be resolvable by name.

### D4: ResolvedFilterData separates parsed tokens from resolved values

MongoDB-resolved values (`editorPageIds`, `groupIds`, and their `not_` counterparts) cannot live in `QueryTerms` (parsed strings only). A new `ResolvedFilterData` type is added to `SearchableData` and populated by `SearchService` before calling the delegator.

### D5: Empty/unknown identifiers return empty results naturally

- Unknown `author:` username → ES term matches nothing → empty result (no special handling)
- Unknown `editor:` username → `User.findOne()` returns null → `editorPageIds = []` → ES `ids: { values: [] }` → no match
- Unknown `group:` name → both group lookups return null → `groupIds = []` → `granted_groups` clause skipped → no match
- `group:` name the user is not a member of → resolved ID survives the lookup but is dropped by the intersect → `groupIds = []` → clause skipped → no match (Req 3.5, 7.5)
- Empty operator value (e.g., `author:` with no value) → parser skips token (regex or explicit guard)

### D6: Negation mirrors positive with must_not

`-author:jim` → `must_not: { term: { username: 'jim' } }`. `-editor:alice` and `-group:dev-team` follow same resolution path, clause pushed to `must_not`. Consistent with existing `-prefix:` / `-tag:` behavior.

### D7: AVAILABLE_KEYS and ESTermsKey must include new fields

`elasticsearch.ts` maintains `AVAILABLE_KEYS` array used by `isTermsNormalized()` and `validateTerms()`. All six new `QueryTerms` keys must be added there and to `ESTermsKey` in `interfaces/search.ts`.

---

## Synthesis Outcomes

- **Generalization**: All three operators end up as `bool.filter` clauses, but on different ES fields — `author:` on `username` (direct), `editor:` on `_id` via resolved `ids` values, `group:` on `granted_groups` via resolved-then-intersected group IDs. The `bool.filter` push pattern is uniform even though the target fields differ.
- **Build vs Adopt**: Pure extension — no new libraries, no new ES fields. `author:` reuses the already-indexed `username` field; `group:` reuses the already-indexed `granted_groups` field.
- **Simplification**: Three file changes only. No new files. `author:` follows `tag:` verbatim. `group:` needs only a name→ID lookup plus the membership intersect — no member-user resolution. The only new abstraction is `ResolvedFilterData` — required to keep MongoDB resolution out of the delegator.
