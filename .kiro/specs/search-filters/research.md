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
| `last_update_username` | `keyword` | `page.lastUpdateUser.username` — **NEW field added by this spec** |
| `tag_names` | `keyword` | PageTagRelation |
| `path.raw` | `keyword` (subfield) | page.path |
| `created_at` | `date` | |
| `updated_at` | `date` | |

**Decision (revised)**: A new `last_update_username` keyword field is added to the ES index so `editor:` maps directly to it — symmetric with `author:` → `username`. The prior MongoDB pre-resolution approach (D2 below) is **abandoned**. This requires a **full index rebuild**; there is no MongoDB fallback (see D2-revised).

### Indexing pipeline touch points (for the new field)

The `creator.username` field is the exact precedent to mirror for `last_update_username`:

| Site | File | Change |
|---|---|---|
| Aggregation `$lookup` + `$unwind` + `$project` | `search-delegator/aggregate-to-index.ts` | Add a `lastUpdateUser` lookup mirroring the `creator` lookup (lines 37–50), project `lastUpdateUser.username` (line 136) |
| `AggregatedPage` type | `search-delegator/bulk-write.d.ts` | Add `lastUpdateUser?: { username: string }` (mirror `creator?`) |
| `BulkWriteBody` type | `search-delegator/bulk-write.d.ts` | Add `last_update_username?: string` (mirror `username?`) |
| Doc body builder | `search-delegator/elasticsearch.ts` `prepareBodyForCreate` (~line 485) | Add `last_update_username: page.lastUpdateUser?.username` (mirror `username: page.creator?.username`) |
| ES mappings | `mappings/mappings-es7.ts`, `-es8.ts`, `-es9.ts` | Add `last_update_username: { type: 'keyword' }` (all three files; mirror `username`) |

All three mapping files are structurally identical for these fields (`username` and `tag_names` both `keyword`), so the addition is mechanical across es7/es8/es9.

### Page.lastUpdateUser

```typescript
lastUpdateUser: { type: Schema.Types.ObjectId, ref: 'User' }
```

`ObjectId` (ref User). The indexing `$lookup` resolves it to `lastUpdateUser.username`, which is written to the new `last_update_username` ES field. At query time `editor:` no longer touches MongoDB.

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

### D2 (revised): editor: maps directly to the new indexed `last_update_username` field

**Superseding the original D2** (which resolved `editor:` via MongoDB to page IDs because no `last_update_username` field existed). The requirements boundary now permits an ES schema change, so:

`editor:alice` → `term: { last_update_username: 'alice' }` in `bool.filter`. No MongoDB resolution, no page-ID enumeration, no `EDITOR_PAGE_ID_LIMIT` cap. Identical pattern to `author:` on `username`.

Consequences (accepted by the spec owner):
- **Full index rebuild required**: the field only exists on pages indexed after the mapping change. Until administrators rebuild the index, `editor:` returns no results for un-reindexed pages. Release notes must state this.
- **No MongoDB fallback**: the abandoned resolution path is not retained as a degraded mode.
- **No backfill/migration**: a full rebuild is the only supported path to populate the field.

Rationale: removing the 1000-page cap, the `User.findOne` + `Page.find` round-trips, and the `editorPageIds`/`notEditorPageIds` plumbing makes `editor:` strictly simpler and symmetric with `author:`. The cost is a one-time operational rebuild, which the spec owner has explicitly accepted.

### D3: group: resolved to a group ID, intersected with the user's groups, applied to ES `granted_groups`

`group:dev-team` requires:
1. `UserGroup.findOne({ name: 'dev-team' })` + `ExternalUserGroup.findOne({ name: 'dev-team' })` → resolved groupId(s)
2. **Intersect** the resolved IDs with the requesting user's own groups (`IGrantedGroup[]` already passed into `searchKeyword()`). Only IDs the user belongs to survive.
3. ES `terms: { granted_groups: [validGroupIds] }` clause in `bool.filter`

No member-user resolution: the page documents are already indexed with a `granted_groups` field, so a group ID matches pages directly. There is no `User.find` / `memberUsernames` step.

**Intersection is a hard requirement, not an optimization (Req 3.5, 7.5).** A user who belongs to groups A and B but types `group:A,C` must get results scoped to **A only** — C is silently dropped because the user is not a member. Without the intersect, `group:C` would let a non-member enumerate pages granted to C, widening access. The resolved-then-intersected set can therefore only ever be a subset of the user's existing group access, so the clause can never broaden the permission filter that already lives in the same `bool.filter[]`.

Rationale for including ExternalUserGroup: external groups also appear in `granted_groups` and in the user's `IGrantedGroup[]`, so both must be resolvable by name.

### D4 (revised): ResolvedFilterData carries only group IDs

With `editor:` now ES-direct, the only MongoDB-resolved values are group IDs. `ResolvedFilterData` is therefore `{ groupIds: string[]; notGroupIds: string[] }` — the `editorPageIds` / `notEditorPageIds` fields are removed. It is still added to `SearchableData` and populated by `SearchService` before calling the delegator, because group name → ID resolution + membership intersect (Req 3.5, 7.5) cannot live in the delegator. The resolution method is scoped to groups only (`resolveGroupTerms`).

### D5: Empty/unknown identifiers return empty results naturally

- Unknown `author:` username → ES term matches nothing → empty result (no special handling)
- Unknown `editor:` username → ES `term: { last_update_username }` matches nothing → empty result (no special handling, identical to `author:`)
- Unknown `group:` name → both group lookups return null → `groupIds = []` → `granted_groups` clause skipped → no match
- `group:` name the user is not a member of → resolved ID survives the lookup but is dropped by the intersect → `groupIds = []` → clause skipped → no match (Req 3.5, 7.5)
- Empty operator value (e.g., `author:` with no value) → parser skips token (regex or explicit guard)

### D6: Negation mirrors positive with must_not

`-author:jim` → `must_not: { term: { username: 'jim' } }`. `-editor:alice` and `-group:dev-team` follow same resolution path, clause pushed to `must_not`. Consistent with existing `-prefix:` / `-tag:` behavior.

### D7: AVAILABLE_KEYS and ESTermsKey must include new fields

`elasticsearch.ts` maintains `AVAILABLE_KEYS` array used by `isTermsNormalized()` and `validateTerms()`. All six new `QueryTerms` keys must be added there and to `ESTermsKey` in `interfaces/search.ts`.

---

## Synthesis Outcomes

- **Generalization**: `author:` and `editor:` are now the **same pattern** — an exact `term` match on a keyword field (`username` / `last_update_username`). `group:` is the only operator needing MongoDB resolution (name → ID, intersected with the user's groups) before its `granted_groups` clause. The `bool.filter` push pattern is uniform across all three.
- **Build vs Adopt**: Extension plus **one new indexed ES field** (`last_update_username`) wired through the existing indexing pipeline by mirroring the `creator.username` precedent. No new libraries.
- **Simplification**: Collapsing `editor:` onto `author:`'s pattern removes the entire MongoDB editor-resolution path (the `User.findOne` + `Page.find` round-trips, the 1000-page cap, and the `editorPageIds`/`notEditorPageIds` plumbing). `ResolvedFilterData` shrinks to group IDs only. The cost is the new indexing field (5 mechanical touch points) and a one-time full index rebuild.
- **Trade-off accepted**: A full index rebuild is required before `editor:` returns results for existing pages; no MongoDB fallback is retained. The spec owner accepted this in exchange for the simpler, cap-free query path.
