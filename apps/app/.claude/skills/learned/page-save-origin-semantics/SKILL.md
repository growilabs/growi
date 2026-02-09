---
name: page-save-origin-semantics
description: Auto-invoked when modifying origin-based conflict detection, revision validation logic, or isUpdatable() method. Explains the two-stage origin check mechanism for conflict detection and its separation from diff detection.
---

# Page Save Origin Semantics

## Problem

When modifying page save logic, it's easy to accidentally break the carefully designed origin-based conflict detection system. The system uses a two-stage check mechanism (frontend + backend) to determine when revision validation should be enforced vs. bypassed for collaborative editing (Yjs).

**Key Insight**: **Conflict detection (revision check)** and **diff detection (hasDiffToPrev)** serve different purposes and require separate logic.

## Solution

Understanding the two-stage origin check mechanism:

### Stage 1: Frontend Determines revisionId Requirement

```typescript
// apps/app/src/client/components/PageEditor/PageEditor.tsx:158
const isRevisionIdRequiredForPageUpdate = currentPage?.revision?.origin === undefined;

// lines 308-310
const revisionId = isRevisionIdRequiredForPageUpdate
  ? currentRevisionId
  : undefined;
```

**Logic**: Check the **latest revision's origin** on the page:
- If `origin === undefined` (legacy/API save) → Send `revisionId`
- If `origin === "editor"` or `"view"` → Do NOT send `revisionId`

### Stage 2: Backend Determines Conflict Check Behavior

```javascript
// apps/app/src/server/models/obsolete-page.js:167-172
const ignoreLatestRevision =
  origin === Origin.Editor &&
  (latestRevisionOrigin === Origin.Editor || latestRevisionOrigin === Origin.View);

if (ignoreLatestRevision) {
  return true;  // Bypass revision check
}

// Otherwise, enforce strict revision matching
if (revision != previousRevision) {
  return false;  // Reject save
}
return true;
```

**Logic**: Check **current request's origin** AND **latest revision's origin**:
- If `origin === "editor"` AND latest is `"editor"` or `"view"` → Bypass revision check
- Otherwise → Enforce strict revision ID matching

## Origin Values

Three types of page update methods (called "origin"):

- **`Origin.Editor = "editor"`** - Save from editor mode (collaborative editing via Yjs)
- **`Origin.View = "view"`** - Save from view mode
  - Examples: HandsontableModal, DrawioModal editing
- **`undefined`** - API-based saves or legacy pages

## Origin Strength (強弱)

**Basic Rule**: Page updates require the previous revision ID in the request. If the latest revision doesn't match, the server rejects the request.

**Exception - Editor origin is stronger than View origin**:
- **UX Goal**: Avoid `Posted param "revisionId" is outdated` errors when multiple members are using the Editor and View changes interrupt them
- **Special Case**: When the latest revision's origin is View, Editor origin requests can update WITHOUT requiring revision ID

### Origin Strength Matrix

|        | Latest Revision: Editor | Latest Revision: View | Latest Revision: API |
| ------ | ----------------------- | --------------------- | -------------------- |
| **Request: Editor** | ⭕️ Bypass revision check | ⭕️ Bypass revision check | ❌ Strict check |
| **Request: View**   | ❌ Strict check | ❌ Strict check | ❌ Strict check |
| **Request: API**    | ❌ Strict check | ❌ Strict check | ❌ Strict check |

**Reading the table**:
- ⭕️ = Revision check bypassed (revisionId not required)
- ❌ = Strict revision check required (revisionId must match)

## Behavior by Scenario

| Latest Revision Origin | Request Origin | revisionId Sent? | Revision Check | Use Case |
|------------------------|----------------|------------------|----------------|----------|
| `editor` or `view` | `editor` | ❌ No | ✅ Bypassed | Normal Editor use (most common) |
| `undefined` | `editor` | ✅ Yes | ✅ Enforced | Legacy page in Editor |
| `undefined` | `undefined` (API) | ✅ Yes (required) | ✅ Enforced | API save |

## Example: Server-Side Logic Respecting Origin Semantics

When adding server-side functionality that needs previous revision data:

```typescript
// ✅ CORRECT: Separate concerns - conflict detection vs. diff detection
let previousRevision: IRevisionHasId | null = null;

// Priority 1: Use provided revisionId (for conflict detection)
if (sanitizeRevisionId != null) {
  previousRevision = await Revision.findById(sanitizeRevisionId);
}

// Priority 2: Fallback to currentPage.revision (for other purposes like diff detection)
if (previousRevision == null && currentPage.revision != null) {
  previousRevision = await Revision.findById(currentPage.revision);
}

const previousBody = previousRevision?.body ?? null;

// Continue with existing conflict detection logic (unchanged)
if (currentPage != null && !(await currentPage.isUpdatable(sanitizeRevisionId, origin))) {
  // ... return conflict error
}

// Use previousBody for diff detection or other purposes
updatedPage = await crowi.pageService.updatePage(
  currentPage,
  body,
  previousBody,  // ← Available regardless of conflict detection logic
  req.user,
  options,
);
```

```typescript
// ❌ WRONG: Forcing frontend to always send revisionId
const revisionId = currentRevisionId;  // Always send, regardless of origin
// This breaks Yjs collaborative editing semantics!
```

```typescript
// ❌ WRONG: Changing backend conflict detection logic
// Don't modify isUpdatable() unless you fully understand the implications
// for collaborative editing
```

## When to Apply

**Always consider this pattern when**:
- Modifying page save/update API handlers
- Adding functionality that needs previous revision data
- Working on conflict detection or revision validation logic
- Implementing features that interact with page history
- Debugging save operation issues

**Key Principles**:
1. **Do NOT modify frontend revisionId logic** unless explicitly required for conflict detection
2. **Do NOT modify isUpdatable() logic** unless fixing conflict detection bugs
3. **Separate concerns**: Conflict detection ≠ Other revision-based features (diff detection, history, etc.)
4. **Server-side fallback**: If you need previous revision data when revisionId is not provided, fetch from `currentPage.revision`

## Detailed Scenario Analysis

### Scenario A: Normal Editor Mode (Most Common Case)

**Latest revision has `origin=editor`**:

1. **Frontend Logic**:
   - `isRevisionIdRequiredForPageUpdate = false` (latest revision origin is not undefined)
   - Does NOT send `revisionId` in request
   - Sends `origin: Origin.Editor`

2. **API Layer**:
   ```typescript
   previousRevision = await Revision.findById(undefined);  // → null
   ```
   Result: No previousRevision fetched via revisionId

3. **Backend Conflict Check** (`isUpdatable`):
   ```javascript
   ignoreLatestRevision =
     (Origin.Editor === Origin.Editor) &&
     (latestRevisionOrigin === Origin.Editor || latestRevisionOrigin === Origin.View)
   // → true (latest revision is editor)
   return true;  // Bypass revision check
   ```
   Result: ✅ Save succeeds without revision validation

4. **Impact on Other Features**:
   - If you need previousRevision data (e.g., for diff detection), it won't be available unless you implement server-side fallback
   - This is where `currentPage.revision` fallback becomes necessary

### Scenario B: Legacy Page in Editor Mode

**Latest revision has `origin=undefined`**:

1. **Frontend Logic**:
   - `isRevisionIdRequiredForPageUpdate = true` (latest revision origin is undefined)
   - Sends `revisionId` in request
   - Sends `origin: Origin.Editor`

2. **API Layer**:
   ```typescript
   previousRevision = await Revision.findById(sanitizeRevisionId);  // → revision object
   ```
   Result: previousRevision fetched successfully

3. **Backend Conflict Check** (`isUpdatable`):
   ```javascript
   ignoreLatestRevision =
     (Origin.Editor === Origin.Editor) &&
     (latestRevisionOrigin === undefined)
   // → false (latest revision is undefined, not editor/view)

   // Strict revision check
   if (revision != sanitizeRevisionId) {
     return false;  // Reject if mismatch
   }
   return true;
   ```
   Result: ✅ Save succeeds only if revisionId matches

4. **Impact on Other Features**:
   - previousRevision data is available
   - All revision-based features work correctly

### Scenario C: API-Based Save

**Request has `origin=undefined` or omitted**:

1. **Frontend**: Not applicable (API client)

2. **API Layer**:
   - API client MUST send `revisionId` in request
   - `previousRevision = await Revision.findById(sanitizeRevisionId)`

3. **Backend Conflict Check** (`isUpdatable`):
   ```javascript
   ignoreLatestRevision =
     (undefined === Origin.Editor) && ...
   // → false

   // Strict revision check
   if (revision != sanitizeRevisionId) {
     return false;
   }
   return true;
   ```
   Result: Strict validation enforced

## Root Cause: Why This Separation Matters

**Historical Context**: At some point, the frontend stopped sending `previousRevision` (revisionId) for certain scenarios to support Yjs collaborative editing. This broke features that relied on previousRevision data being available.

**The Core Issue**:
- **Conflict detection** needs to know "Is this save conflicting with another user's changes?" (Answered by revision check)
- **Diff detection** needs to know "Did the content actually change?" (Answered by comparing body)
- **Current implementation conflates these**: When conflict detection is bypassed, previousRevision is not fetched, breaking diff detection

**The Solution Pattern**:
```typescript
// Separate the two concerns:

// 1. Fetch previousRevision for data purposes (diff detection, history, etc.)
let previousRevision: IRevisionHasId | null = null;
if (sanitizeRevisionId != null) {
  previousRevision = await Revision.findById(sanitizeRevisionId);
} else if (currentPage.revision != null) {
  previousRevision = await Revision.findById(currentPage.revision);  // Fallback
}

// 2. Use previousRevision data for your feature
const previousBody = previousRevision?.body ?? null;

// 3. Conflict detection happens independently via isUpdatable()
if (currentPage != null && !(await currentPage.isUpdatable(sanitizeRevisionId, origin))) {
  // Return conflict error
}
```

## Reference

**Official Documentation**:
- https://dev.growi.org/651a6f4a008fee2f99187431#origin-%E3%81%AE%E5%BC%B7%E5%BC%B1

**Related Files**:
- Frontend: `apps/app/src/client/components/PageEditor/PageEditor.tsx` (lines 158, 240, 308-310)
- Backend: `apps/app/src/server/models/obsolete-page.js` (lines 159-182, isUpdatable method)
- API: `apps/app/src/server/routes/apiv3/page/update-page.ts` (lines 260-282, conflict check)
- Interface: `packages/core/src/interfaces/revision.ts` (lines 6-11, Origin definition)

## Common Pitfalls

1. **Assuming revisionId is always available**: It's not! Editor mode with recent editor/view saves omits it by design.
2. **Conflating conflict detection with other features**: They serve different purposes and need separate logic.
3. **Breaking Yjs collaborative editing**: Forcing revisionId to always be sent breaks the bypass mechanism.
4. **Ignoring origin values**: The system behavior changes significantly based on origin combinations.

## Lessons Learned

This pattern was identified during the "improve-unchanged-revision" feature implementation, where the initial assumption was that frontend should always send `revisionId` for diff detection. Deep analysis revealed:

- The frontend logic is correct for conflict detection and should NOT be changed
- Server-side fallback is the correct approach to get previous revision data
- Two-stage checking is intentional and critical for Yjs collaborative editing
- Conflict detection and diff detection must be separated

**Key Takeaway**: Always understand the existing architectural patterns before proposing changes. What appears to be a "fix" might actually break carefully designed functionality.
