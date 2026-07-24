# Gap Analysis: group-selection-ui (Feature 1: Group Member Visibility)

Target requirements: [requirements.md](./requirements.md)
Scope: Display the members (name, username) of each group shown as options in the GrantSelector (group selection UI for page visibility set to "group-limited").

## 1. Current State Analysis

This feature is positioned as an **extension of an existing, established data flow**. The group selection UI and its data supply already exist, and a TODO for member display is already embedded in the code.

### Existing Data Flow (GrantSelector)

```
GrantSelector.tsx (modal)
  └─ useSWRxCurrentGrantData(pageId)        stores/page.tsx:298-313
       └─ GET /api/v3/page/grant-data       routes/apiv3/page/index.ts:532-620
            ├─ auth: accessTokenParser([SCOPE.READ.FEATURES.PAGE]) + loginRequiredStrictly
            └─ pageGrantService.getPageGroupGrantData(page, user)   service/page-grant.ts:951-1051
                 └─ getUserRelatedGroups(user)   page-grant.ts:1056-1067
                      ├─ UserGroupRelation.findAllGroupsForUser(user)
                      └─ ExternalUserGroupRelation.findAllGroupsForUser(user)
```

- **Type**: `GroupGrantData = { userRelatedGroups: UserRelatedGroupsData[]; nonUserRelatedGrantedGroups: {...}[] }` ([interfaces/page.ts:45-60](../../../apps/app/src/interfaces/page.ts))
  - `UserRelatedGroupsData = { id, name, type, provider?, status }` ← currently has no member information
- **UI**: The modal renders `userRelatedGroups` (groups the user belongs to = selectable) and `nonUserRelatedGrantedGroups` (already granted but not belonging = disabled) separately. **The member list TODO is at [GrantSelector.tsx:338,357](../../../apps/app/src/client/components/PageEditor/EditorNavbarBottom/GrantSelector.tsx)** (on the `userRelatedGroups` side).

### Existing Member Fetch Building Blocks

| Use | Method | Location |
|---|---|---|
| UserGroup members (populated) | `UserGroupRelation.findAllRelationForUserGroup(group)` → `relatedUser` populate | models/user-group-relation.ts:106-110 |
| User IDs for multiple groups (deduplicated) | `UserGroupRelation.findAllUserIdsForUserGroups(ids)` | models/user-group-relation.ts:112-121 |
| External groups | `ExternalUserGroupRelation` (delegates same-name statics) | features/external-user-group/server/models/external-user-group-relation.ts:77-78 |
| Sensitive field removal | `serializeUserSecurely(user)` → removes `password/apiToken/email` (email restored conditionally when `isEmailPublished`) | packages/core/src/models/serializers/user-serializer.ts:28-42 |

- `name`/`username` on `IUser` are at [packages/core/src/interfaces/user.ts:7-8](../../../packages/core/src/interfaces/user.ts).

### Existing Admin Member List
`GET /api/v3/user-groups/:id/users` requires **adminRequired + SCOPE.*.ADMIN.USER_GROUP_MANAGEMENT** and cannot be used for this feature (general users). The authorization model differs so it cannot be reused, though its serialize/active-filtering implementation pattern is a useful reference.

## 2. Requirement-to-Asset Map

| Requirement | Available existing assets | Gap type |
|---|---|---|
| R1.1 Present members per group in GrantSelector | Full grant-data flow / TODO location confirmed | **Missing**: `UserRelatedGroupsData` has no member array / UI not implemented |
| R1.2 / R3.4 Display name and username only | `serializeUserSecurely` | **Constraint**: serializer returns fields beyond name/username (image, introduction, etc.). **A separate projection to name+username only is needed** |
| R1.3 Both UserGroup and ExternalUserGroup | `findAllRelationForUserGroup` (internal) / external via ID-based delegation | **Unknown**: whether ExternalUserGroup has a symmetric method returning populated members — if not, unify via ID → User fetch |
| R1.4 Present "only yourself" group | — | **Missing**: UI for empty (self-only) representation |
| R2.1 Direct membership groups only | `getUserRelatedGroups` (= direct membership) | ✅ Fits |
| R2.2 Do not include parent/child group members | Fetch relations per group directly (no recursion) | ✅ Fits (not implementing recursive expansion satisfies the requirement) |
| R2.3 Active users only | Active filtering pattern from admin API | **Missing**: relation populate has no status condition. A `status: STATUS_ACTIVE` filter is needed |
| R3.1 Login required | grant-data uses `loginRequiredStrictly` | ✅ Fits |
| R3.2 Hide members for non-belonging groups | `nonUserRelatedGrantedGroups` is a separate array | ✅ Fits (just don't attach members to that section) |
| R3.3 No admin privileges required | grant-data uses non-admin scope | ✅ Fits |
| R3.5 Always enabled (no settings) | — | ✅ Fits (don't create extra settings) |

## 3. Implementation Approach Options

### Option A: Extend grant-data (eager)
Add `members: { name, username }[]` to `UserRelatedGroupsData` and fetch/project members for each `userRelatedGroups` entry inside `getPageGroupGrantData`. UI renders `members` at the existing TODO location.
- ✅ Completes in one round trip; no new endpoint needed; implement directly at the TODO location
- ✅ Minimal type/hook changes (reuse existing `useSWRxCurrentGrantData`)
- ❌ Fetches all group members on every grant-data call even when the modal is never opened — increases overhead
- ❌ Mixes member display concerns into grant-data's responsibility (grant determination)

### Option B: Add a dedicated endpoint (lazy)
Add `GET /api/v3/user-groups/:id/members` (non-admin, login required, **verifying that the calling user is a direct member of the group**) and fetch only when the modal is opened or a group is expanded.
- ✅ Separation of concerns; does not pollute grant-data; lazy fetch minimizes cost
- ✅ Easier to unit test (clear authorization boundary)
- ❌ Adds implementation for a new route + SWR hook + authorization check
- ❌ Requires a design decision on how to handle both UserGroup and ExternalUserGroup ID schemes in one endpoint

### Option C: Hybrid (extend types, fetch lazily)
Optionally add `members?` to `UserRelatedGroupsData` but perform actual fetching via a dedicated endpoint from Option B on modal expansion.
- ✅ Good balance of UX, performance, and separation
- ❌ Requires the most design coordination (deciding where to draw the eager/lazy boundary)

## 4. Complexity & Risk

- **Effort**: **S–M** (1–5 days). Data building blocks are in place; the main work is "type extension + member fetch/projection + UI rendering". Options B/C add a bit more for the new route.
- **Risk**: **Low–Medium**.
  - Medium factors: (1) projecting only name+username after serialization, (2) ExternalUserGroup member fetch symmetry, (3) performance for eager fetch (Option A), (4) risk of missing the active user filter.
  - Low factors: authorization naturally fits existing non-admin scope / direct membership only means no recursion needed.

## 5. Handoff Notes for Design Phase

**Recommendation**: Focus on **Option B or C** for performance and separation of concerns (avoid bloating grant-data's responsibility and unnecessary eager fetching). Option A is viable for a quick, minimal first version.

**Research Needed (to be resolved in design)**:
1. Whether `ExternalUserGroupRelation` has a symmetric method returning populated members → if not, unify via "fetch IDs → bulk fetch User → project" for both UserGroup/External.
2. Where to place the "name/username only" projection guarantee (dedicated serializer / DTO projection). Note that `serializeUserSecurely` alone leaves excess fields.
3. Where to apply active user filtering (`status === STATUS_ACTIVE`).
4. Eager (Option A) vs lazy (B/C): for the decision, consider the typical number of groups and members per group.
5. Display policy when a group has many members (count cap / "and N more", etc.). Requirements have no upper limit; confirm the UX in design.

---

## Design Synthesis Conclusions (kiro-spec-design)

Confirmed facts from the codebase:
- `findAllUserIdsForUserGroups` is shared between UserGroupRelation / ExternalUserGroupRelation (external delegates). However, it does not filter by active status.
- ExternalUserGroup has no `findAllRelationForUserGroup` (populated version), so both types are unified via **fetch relations → filter User with `status: UserStatus.STATUS_ACTIVE` + `.select('name username')`**.
- `UserStatus.STATUS_ACTIVE` (=2) is in `apps/app/src/server/models/user/conts.ts`. The existing `findUserByNotRelatedGroup` ([user-group-relation.ts:233-240](../../../apps/app/src/server/models/user-group-relation.ts)) uses the same pattern.
- The sibling endpoint `GET /user/related-groups` ([get-related-groups.ts](../../../apps/app/src/server/routes/apiv3/user/get-related-groups.ts)) uses the factory pattern with `accessTokenParser([SCOPE.READ.USER_SETTINGS.INFO], { acceptLegacy: true })` + `loginRequiredStrictly` + `pageGrantService.getUserRelatedGroups(req.user)`. The new API follows this same pattern.
- The new hook is added next to the existing `useSWRxUserRelatedGroups` ([stores/user.tsx:77](../../../apps/app/src/stores/user.tsx)).

### 1. Generalization
The 3 requirements consolidate to: "project active members of the current user's directly-belonging groups (both types) to name/username and render in GrantSelector". The internal/external difference is absorbed by per-type relation queries, unified at the User fetch stage.

### 2. Build vs Adopt
- Adopted: `getUserRelatedGroups` (direct membership, both types, no recursion), relations query, User active projection pattern, SWR pattern from `useSWRxUserRelatedGroups`.
- Not adopted: admin API `/user-groups/:id/users` (adminRequired + full serialize — mismatches requirements). `serializeUserSecurely` (may conditionally include email; adopt stricter `.select('name username')` instead).

### 3. Simplification
- Group set derived server-side from the session (no client-supplied IDs accepted) → simplifies authorization check, eliminates IDOR (structurally satisfies 3.2/3.3).
- Member information uses a separate contract from grant-data with lazy fetching, avoiding bloating grant determination responsibilities and eager fetch cost (Option B from research, strengthened by session-derived group set).
- name/username projection applied at the DB query level → privacy (1.2/3.4) structurally guaranteed.

### Open Questions
- Display cap / "and N more" for groups with many members (no upper limit in requirements; initial version shows all).
- Whether to include/exclude/highlight the current user in the list (design returns all members; UI detects `username` match to satisfy 1.4).
