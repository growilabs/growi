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
- Only the user's **own** groups are fetched, scoped by id: `UserGroup.find({ _id: { $in: userGroups } })` + `ExternalUserGroup.find({ _id: { $in: userGroups } })` (selecting `_id name`). A `name → [groupId]` map built from that set lets a typed `group:` name resolve straight to the user's group ID(s), used directly against the ES `granted_groups` field. There is **no** member-user resolution (`UserGroupRelation` / `ExternalUserGroupRelation` are not queried) and **no** global `findOne({ name })` lookup.
- Because the lookup is scoped by `_id ∈ userGroups`, **membership is enforced implicitly**: a typed group the user does not belong to is simply absent from the map and resolves to nothing — no separate intersect pass. The `userGroups` argument (an `ObjectIdLike[]`, `null` for guests) is passed straight into the `$in`; no `IGrantedGroup`/`_id` element-shape handling is required, and group IDs are read off the fetched docs via `group.id`.

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

### D3: group: resolved against the user's own groups, applied to ES `granted_groups`

`group:dev-team` is resolved by looking up **only the requesting user's own groups** and matching the typed name against them:
1. `UserGroup.find({ _id: { $in: userGroups } })` + `ExternalUserGroup.find({ _id: { $in: userGroups } })` (select `_id name`) → the user's groups (internal + external)
2. Build a `name → [groupId]` map from that set (read `group.id`), then resolve each typed name: `names.flatMap(name => map.get(name) ?? [])`
3. ES `terms: { granted_groups: [groupIds] }` clause in `bool.filter`

No member-user resolution: the page documents are already indexed with a `granted_groups` field, so a group ID matches pages directly. There is no `User.find` / `memberUsernames` step.

**Membership enforcement is implicit and is a hard requirement (Req 3.5, 7.5).** Because the lookup is scoped by `_id ∈ userGroups`, a typed group the user does not belong to is never in the map and resolves to nothing — there is no separate "intersect" step that could be omitted, and no way for a non-member to enumerate pages granted to a group they are not in. A user who belongs to A and B but types `group:A group:C` gets results scoped to **A only**; C resolves to `[]`. The resolved set is by construction a subset of the user's own group access, so the clause can never broaden the permission filter that already lives in the same `bool.filter[]`.

**Why this supersedes the earlier "global `findOne({ name })` then intersect" design:** one id-scoped query (not two lookups per name), it reads `group.id` off fetched documents (sidestepping the `userGroups` element-type / `_id` pitfalls entirely), and it makes the membership guarantee structural rather than a step that can be forgotten. It also dissolves the ExternalUserGroup `{name, provider}` name-uniqueness approximation: only the user's own groups are ever considered, and if the user belongs to two groups sharing a name the map holds both IDs (more complete than a first-match `findOne`).

Rationale for including ExternalUserGroup: external groups also appear in `granted_groups` and in the user's `userGroups` ID list (the route concatenates internal + external group IDs), so both must be in the map.

### D4 (revised): ResolvedFilterData carries only group IDs

With `editor:` now ES-direct, the only MongoDB-resolved values are group IDs. `ResolvedFilterData` is therefore `{ groupIds: string[]; notGroupIds: string[] }` — the `editorPageIds` / `notEditorPageIds` fields are removed. It is still added to `SearchableData` and populated by `SearchService` before calling the delegator, because resolving group names against the user's own groups (Req 3.5, 7.5) needs MongoDB and cannot live in the delegator. The resolution method is `resolveFilterData`.

### D5: Empty/unknown identifiers return empty results

- Unknown `author:` username → ES term matches nothing → empty result (no special handling)
- Unknown `editor:` username → ES `term: { last_update_username }` matches nothing → empty result (no special handling, identical to `author:`)
- Unknown `group:` name → name absent from the user's-own-groups map → `groupIds = []` → **still push** `terms: { granted_groups: [] }` (an empty ES `terms` array matches nothing) → no match. The positive clause must be pushed, **not skipped**: skipping a positive filter removes it and returns every remaining match instead of none. (This is the same correct behavior the pre-`granted_groups` design had with `ids: { values: [] }`; it was lost in a rewrite and is restored here.)
- `group:` name the user is not a member of → name absent from the user's-own-groups map (the lookup is scoped to `_id ∈ userGroups`) → `groupIds = []` → same match-nothing `terms: { granted_groups: [] }` clause → no match (Req 3.5, 7.5)
- Asymmetry: negation (`-group:`) does the opposite — an unknown/non-member negated group should exclude nobody, so its `must_not` clause is **skipped** when `notGroupIds` is empty (Req 4.3). Positive operators push match-nothing on empty resolution; negative operators skip.
- Empty operator value (e.g., `author:` with no value) → parser skips token (regex or explicit guard)

### D6: Negation mirrors positive with must_not

`-author:jim` → `must_not: { term: { username: 'jim' } }`. `-editor:alice` and `-group:dev-team` use the same field/resolution as their positive forms (editor direct, group via the user's-own-groups map), with the clause pushed to `must_not` instead of `must`. Consistent with existing `-prefix:` / `-tag:` behavior. (Empty-resolution behavior still differs by polarity — see D5.)

### D7: AVAILABLE_KEYS and ESTermsKey must include new fields

`elasticsearch.ts` maintains `AVAILABLE_KEYS` array used by `isTermsNormalized()` and `validateTerms()`. All six new `QueryTerms` keys must be added there and to `ESTermsKey` in `interfaces/search.ts`.

---

## Synthesis Outcomes

- **Generalization**: `author:` and `editor:` are now the **same pattern** — an exact `term` match on a keyword field (`username` / `last_update_username`). `group:` is the only operator needing MongoDB resolution (typed names matched against the user's own groups) before its `granted_groups` clause. The `bool.filter` push pattern is uniform across all three.
- **Build vs Adopt**: Extension plus **one new indexed ES field** (`last_update_username`) wired through the existing indexing pipeline by mirroring the `creator.username` precedent. No new libraries.
- **Simplification**: Collapsing `editor:` onto `author:`'s pattern removes the entire MongoDB editor-resolution path (the `User.findOne` + `Page.find` round-trips, the 1000-page cap, and the `editorPageIds`/`notEditorPageIds` plumbing). `ResolvedFilterData` shrinks to group IDs only. The cost is the new indexing field (5 mechanical touch points) and a one-time full index rebuild.
- **Trade-off accepted**: A full index rebuild is required before `editor:` returns results for existing pages; no MongoDB fallback is retained. The spec owner accepted this in exchange for the simpler, cap-free query path.
