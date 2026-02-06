# Implementation Gap Analysis

## Executive Summary

**Scope**: Fix unchanged revision detection by ensuring the server can accurately compare new revision content with previous revision content to set `hasDiffToPrev` field correctly.

**Key Findings**:
- Infrastructure is **90% complete** - data model, business logic, and UI components already exist
- Core issue: **Broken data flow** - frontend conditionally skips sending `revisionId`, causing server to receive null `previousBody`
- **Minimal changes required** - fix parameter passing in 2-3 files rather than building new features

**Challenges**:
- Determining when `revisionId` should be required vs. optional (tied to `origin` field semantics)
- Handling edge cases where previous revision cannot be retrieved
- Backward compatibility with existing revisions without `hasDiffToPrev`

**Recommended Approach**: **Option A - Extend Existing Components** (see Implementation Approach Options below)

**Updated After Origin Semantics Deep Dive**: See [origin-behavior-analysis.md](./origin-behavior-analysis.md) for detailed analysis confirming:
- ✅ Current origin-based conflict detection is correctly designed and should NOT be changed
- ✅ Server-side fallback is the correct solution (preserves conflict detection while enabling diff detection)
- ✅ No frontend changes needed

---

## 1. Current State Investigation

### 1.1 Existing Assets

#### Data Model Layer
**Status**: ✅ Complete

- **File**: `packages/core/src/interfaces/revision.ts`
  - `IRevision` interface includes `hasDiffToPrev?: boolean` (line 20)
  - Optional boolean field, properly typed for backward compatibility

- **File**: `apps/app/src/server/models/revision.ts`
  - Schema defines `hasDiffToPrev: { type: Boolean }` (line 62)
  - `prepareRevision()` method sets `hasDiffToPrev = body !== previousBody` when `pageData.revision != null` (lines 106-108)
  - Body getter normalizes line endings (CR/CRLF to LF) automatically (lines 54-58)

**Finding**: Data model is complete and ready. No changes needed.

#### Business Logic Layer
**Status**: ⚠️ Partially working

- **File**: `apps/app/src/server/service/page/index.ts`
  - `updatePage()` method signature accepts `previousBody: string | null` (line 5236)
  - Passes `previousBody` to `Revision.prepareRevision()` (line 5385)
  - Logic exists but is **broken due to missing previousBody input**

- **File**: `apps/app/src/server/models/revision.ts`
  - `prepareRevision()` correctly compares `body !== previousBody` (line 107)
  - Only sets `hasDiffToPrev` when `pageData.revision != null` (line 106)
  - **Gap**: Does not handle case where `previousBody` is null but previous revision exists

**Finding**: Business logic exists but needs fix to handle null previousBody.

#### API Layer
**Status**: ❌ Broken

- **File**: `apps/app/src/server/routes/apiv3/page/update-page.ts`
  - Fetches `previousRevision` by `revisionId` from request body (line 301):
    ```typescript
    previousRevision = await Revision.findById(sanitizeRevisionId);
    ```
  - Passes `previousRevision?.body ?? null` as `previousBody` (line 308)
  - **Problem**: When `revisionId` is not in request, `previousRevision` is null
  - **Missing logic**: Should fetch previous revision from `currentPage.revision` when `revisionId` is undefined

**Finding**: API has the infrastructure but lacks fallback logic to retrieve previous revision from current page.

#### Frontend Layer
**Status**: ⚠️ Needs adjustment

- **File**: `apps/app/src/client/components/PageEditor/PageEditor.tsx`
  - `isRevisionIdRequiredForPageUpdate = currentPage?.revision?.origin === undefined` (line 158)
  - `saveWithShortcut()` conditionally includes `revisionId` (lines 308-310):
    ```typescript
    const revisionId = isRevisionIdRequiredForPageUpdate ? currentRevisionId : undefined;
    ```
  - **Issue**: When origin is set (view/editor), revision ID is NOT sent, breaking diff detection
  - **Reference**: See https://dev.growi.org/651a6f4a008fee2f99187431#origin-%E3%81%AE%E5%BC%B7%E5%BC%B1

**Finding**: Frontend logic prioritizes origin-based conflict detection over diff detection. Need to ensure revision ID is always available for server-side diff comparison.

#### UI Display Layer
**Status**: ✅ Complete

- **File**: `apps/app/src/client/components/PageHistory/Revision.tsx`
  - `renderSimplifiedNodiff()` renders compact format (lines 35-58)
  - `renderFull()` renders full format (lines 60-102)
  - Properly checks `hasDiff` prop and renders accordingly (line 105)

- **File**: `apps/app/src/client/components/PageHistory/PageRevisionTable.tsx`
  - Derives `hasDiff = revision.hasDiffToPrev !== false` (line 227)
  - Handles backward compatibility (undefined treated as true)

**Finding**: UI components are complete and working correctly. No changes needed.

### 1.2 Architecture Patterns and Conventions

#### Layering
- **API Layer** (`src/server/routes/apiv3/`) → **Service Layer** (`src/server/service/`) → **Model Layer** (`src/server/models/`)
- Clear separation: API handles request/response, Service contains business logic, Model handles data access

#### Error Handling Convention
- Services throw errors, APIs catch and return proper HTTP status codes
- Logging via `loggerFactory('growi:...')`

#### Testing Placement
- Test files co-located with source: `*.spec.ts` next to `*.ts`
- Integration tests: `*.integ.ts`

#### Origin Field Semantics (DETAILED ANALYSIS)

**See**: [origin-behavior-analysis.md](./origin-behavior-analysis.md) for complete analysis

**Origin Values**:
- `Origin.View`: Save from view mode
- `Origin.Editor`: Save from editor mode (collaborative editing via Yjs)
- `undefined`: API-based saves or legacy pages

**Two-Stage Origin Check Mechanism**:

1. **Frontend Check** (`PageEditor.tsx:158`):
   ```typescript
   const isRevisionIdRequiredForPageUpdate = currentPage?.revision?.origin === undefined;
   ```
   - Checks the **latest revision's origin** on the page
   - If `undefined`, sends `revisionId` in the request
   - Otherwise, omits `revisionId` (conflict check not needed)

2. **Backend Check** (`obsolete-page.js:167-172`):
   ```javascript
   const ignoreLatestRevision =
     origin === Origin.Editor &&
     (latestRevisionOrigin === Origin.Editor || latestRevisionOrigin === Origin.View);
   ```
   - If true: Bypasses revision check (allows save without version validation)
   - If false: Requires `previousRevision` to match current page's revision

**Key Scenarios**:

| Latest Revision Origin | Request Origin | revisionId Sent? | Revision Check | previousBody Available? | hasDiffToPrev Works? |
|------------------------|----------------|------------------|----------------|------------------------|----------------------|
| `editor` or `view` | `editor` | ❌ No (undefined) | ✅ Bypassed | ❌ No (null) | ❌ **BROKEN** |
| `undefined` | `editor` | ✅ Yes | ✅ Enforced | ✅ Yes | ✅ Works |
| `undefined` | `undefined` (API) | ✅ Yes (required) | ✅ Enforced | ✅ Yes | ✅ Works |

**Root Cause Identified**:
- **Conflict detection (revision check)** and **diff detection (hasDiffToPrev)** serve different purposes
- Current implementation conflates them: when revision check is bypassed, `previousRevision` is not fetched
- **However**: Diff detection needs `previousBody` **regardless** of whether revision check is needed
- **Result**: In the most common scenario (editor mode with recent editor/view saves), `hasDiffToPrev` cannot be set correctly

---

## 2. Requirements Feasibility Analysis

### 2.1 Technical Needs by Requirement

#### Requirement 1: Unchanged Revision Detection
**Technical Needs**:
- Retrieve previous revision content when `revisionId` is not provided in request
- Compare new content with previous content
- Set `hasDiffToPrev` field based on comparison result

**Gap Analysis**:
- ✅ Comparison logic exists in `prepareRevision()`
- ❌ **Missing**: API fallback to fetch previous revision from `currentPage.revision`
- ❌ **Missing**: Handle edge case where `currentPage.revision` is null (first revision)

**Constraints**:
- Must respect existing origin-based conflict detection (don't break Yjs workflow)
- Must handle both scenarios: revisionId provided vs. not provided

#### Requirement 2: Revision Metadata Persistence
**Technical Needs**:
- Store `hasDiffToPrev` in database
- Retrieve field in page history API

**Gap Analysis**:
- ✅ Database schema supports field
- ✅ Persistence logic exists in model
- ✅ Page revisions API includes field in response

**No gaps - fully implemented.**

#### Requirement 3: Page History Display Enhancement
**Technical Needs**:
- Conditional rendering based on `hasDiffToPrev` value
- Simplified format for unchanged revisions
- Full format for changed revisions

**Gap Analysis**:
- ✅ Both render formats exist
- ✅ Conditional logic implemented
- ✅ Backward compatibility handled

**No gaps - fully implemented.**

#### Requirement 4: Previous Revision Reference in Update Requests
**Technical Needs**:
- Ensure `previousBody` is available for diff detection
- Support both conflict detection (revision check) and diff detection use cases

**Gap Analysis**:
- ✅ **Frontend logic is correct for conflict detection**: Sends `revisionId` only when latest revision has `origin === undefined`
- ❌ **Missing**: Server-side fallback to fetch previous revision for diff detection when `revisionId` is not provided
- **Key insight**: Conflict detection and diff detection are **separate concerns** that require **separate logic**

**Revised Understanding**:
- **Frontend should NOT change** - the current logic correctly implements conflict detection semantics
- **Server should add fallback** - fetch `currentPage.revision` when `revisionId` is not provided, specifically for diff detection purposes

**Constraints**:
- ✅ Must not break Yjs collaborative editing (origin=editor) - server fallback preserves existing behavior
- ✅ Must not break view mode saves (origin=view) - no frontend changes needed
- ✅ Must not break API saves (origin=undefined) - fallback only activates when revisionId is missing

#### Requirement 5: Backward Compatibility
**Technical Needs**:
- Handle revisions without `hasDiffToPrev` field
- No database migration required

**Gap Analysis**:
- ✅ UI treats undefined as true (shows full format)
- ✅ Optional field type supports undefined

**No gaps - already handled.**

#### Requirement 6: API Consistency and Error Handling
**Technical Needs**:
- Handle null/undefined previous body
- Log errors when fetching previous revision fails
- Handle first revision case (no previous revision exists)
- Normalize line endings before comparison

**Gap Analysis**:
- ✅ Line ending normalization exists in model (body getter)
- ❌ **Missing**: Error handling in API when Revision.findById fails
- ❌ **Missing**: Explicit handling of first revision case
- ⚠️ **Existing issue**: Current logic sets `hasDiffToPrev` only when `pageData.revision != null`, which incorrectly skips first revisions

**Constraints**:
- Must fail gracefully (default to `hasDiffToPrev: true` on error)
- Must not block page saves due to revision comparison errors

### 2.2 Complexity Signals

- **Simple logic**: String comparison (`body !== previousBody`)
- **No external integrations**: All operations within GROWI codebase
- **Moderate conditional logic**: Need to handle origin values, revision ID presence, error cases
- **Low algorithmic complexity**: No complex data structures or algorithms

**Overall**: Low to medium complexity, primarily conditional logic and parameter passing.

---

## 3. Implementation Approach Options

### Option A: Extend Existing Components (RECOMMENDED)

**Rationale**: The infrastructure exists; only 2-3 files need modification to fix the data flow.

#### Which files to extend:

1. **`apps/app/src/server/routes/apiv3/page/update-page.ts`** (lines 198-326)
   - **Change**: Modify previous revision retrieval logic (around line 301)
   - **Before**:
     ```typescript
     previousRevision = await Revision.findById(sanitizeRevisionId);
     ```
   - **After**: Add fallback to fetch from currentPage.revision when revisionId is undefined
     ```typescript
     if (sanitizeRevisionId != null) {
       previousRevision = await Revision.findById(sanitizeRevisionId);
     } else if (currentPage.revision != null) {
       previousRevision = await Revision.findById(currentPage.revision);
     }
     ```
   - **Impact**: Minimal - adds 4 lines, no breaking changes
   - **Backward compatibility**: ✅ Maintains existing behavior when revisionId is provided

2. **`apps/app/src/server/models/revision.ts`** (lines 84-112)
   - **Change**: Improve `prepareRevision()` logic to handle null previousBody
   - **Current issue**: Only sets `hasDiffToPrev` when `pageData.revision != null` (line 106)
   - **Fix**: Always compare when previousBody is provided (even if it's explicitly null), handle null as "no previous"
   - **Impact**: 5-10 lines, improves robustness
   - **Risk**: Low - existing tests should catch regressions

3. **Optional - `apps/app/src/client/components/PageEditor/PageEditor.tsx`** (lines 306-326)
   - **Option 3a**: Always send `revisionId` regardless of origin
     - Simplest change, ensures server always has revision ID
     - May conflict with Yjs workflow (needs investigation)
   - **Option 3b**: No frontend change
     - Let server handle missing revisionId via fallback (Option A approach)
     - Keeps frontend logic unchanged

**Compatibility Assessment**:
- ✅ No interface changes - `updatePage()` signature unchanged
- ✅ No breaking changes to consumers
- ✅ Existing tests should pass (may need to add new test cases)
- ✅ API contract unchanged

**Complexity and Maintainability**:
- ✅ Low cognitive load - straightforward conditional logic
- ✅ Single responsibility maintained (revision comparison stays in prepareRevision)
- ✅ File size remains manageable (<6000 lines for page service)

**Trade-offs**:
- ✅ Minimal new files (none)
- ✅ Leverages existing patterns
- ✅ Fast implementation (1-2 days)
- ✅ Low risk of regression
- ⚠️ Adds conditional logic to API handler (minor complexity increase)

---

### Option B: Create New Components

**Not recommended for this feature.**

**Rationale**: Creating new components for parameter passing logic would be over-engineering. The issue is a simple missing fallback in existing code, not a missing feature requiring new abstractions.

**When this would make sense**:
- If we were building a comprehensive revision comparison service
- If multiple APIs needed the same previous revision retrieval logic
- If the business logic was complex enough to warrant a separate module

**Why not now**:
- ❌ Overkill for a 5-10 line fix
- ❌ Adds unnecessary files and indirection
- ❌ Harder to review and maintain

---

### Option C: Hybrid Approach

**Not applicable** - the feature is small enough that Option A covers all needs.

---

## 4. Implementation Complexity & Risk Assessment

### Effort Estimate: **S (Small - 1-3 days)**

**Justification**:
- Existing patterns to follow (revision retrieval, error handling)
- Minimal dependencies (only Mongoose/Revision model)
- Straightforward integration (add fallback logic in API)
- Most code already exists and works

**Breakdown**:
- Day 1: Implement API fallback logic + improve prepareRevision (4-6 hours)
- Day 1-2: Write unit tests for new logic paths (2-3 hours)
- Day 2: Manual testing across scenarios (view/editor/undefined origin) (2-3 hours)
- Day 3: Code review, documentation, edge case fixes (2-4 hours)

### Risk Level: **Low**

**Justification**:
- Familiar tech stack (TypeScript, Mongoose, Express)
- Established patterns for revision handling
- Clear scope with minimal architectural changes
- Low integration complexity (changes isolated to 2-3 files)
- Strong existing test coverage in codebase

**Risk Mitigation**:
- Existing unit tests should catch regressions
- Manual testing needed for origin-based scenarios (view/editor/undefined)
- Rollback strategy: Revert commits, no database migration required

### Confidence Level: **High**

**Rationale**:
- Infrastructure is proven and working (UI already renders correctly when `hasDiffToPrev` is set)
- Root cause is clearly identified (missing previousBody due to undefined revisionId)
- Fix is straightforward (add fallback retrieval logic)
- Backward compatibility is naturally supported (optional field, UI handles undefined)

---

## 5. Recommendations for Design Phase

### Preferred Approach
**Option A: Extend Existing Components** - minimal surgical changes to fix data flow.

### Key Design Decisions Required

1. **Decision: Separation of Concerns - Conflict Detection vs. Diff Detection**
   - **Status**: ✅ **RESOLVED** - Analysis confirms these are separate concerns
   - **Decision**: Implement server-side fallback to fetch previous revision for diff detection
   - **Rationale**:
     - Conflict detection (revision check) is correctly handled by current origin-based logic
     - Diff detection requires `previousBody` regardless of whether conflict check is needed
     - Changing frontend would break carefully designed conflict detection semantics
     - Server-side fallback preserves all existing behavior while enabling diff detection

2. **Decision: Fallback fetch strategy**
   - **Recommended**: Fetch from `currentPage.revision` when `revisionId` is not provided
   - **Logic**:
     ```typescript
     // Priority 1: Use provided revisionId (for conflict detection)
     if (sanitizeRevisionId != null) {
       previousRevision = await Revision.findById(sanitizeRevisionId);
     }
     // Priority 2: Fallback to current page's latest revision (for diff detection)
     else if (currentPage.revision != null) {
       previousRevision = await Revision.findById(currentPage.revision);
     }
     ```
   - **Impact**: Single additional query only when `revisionId` is not provided (most common case in editor mode)

3. **Decision: Error handling strategy**
   - When previous revision fetch fails:
     - **Option A** (Recommended): Set `hasDiffToPrev: true` and log warning (assume changes exist)
     - **Option B**: Leave `hasDiffToPrev: undefined` (backward compatible, but less informative)
     - **Option C**: Fail the save operation (❌ too strict, breaks user experience)
   - **Rationale**: Save operations should not fail due to metadata calculation errors

4. **Decision: First revision handling**
   - When saving the first revision (no previous revision exists):
     - **Option A** (Recommended): Leave `hasDiffToPrev: undefined` (matches current behavior)
     - **Option B**: Set `hasDiffToPrev: true` (consistent with "assume changes")
   - **Current behavior**: `prepareRevision` only sets field when `pageData.revision != null` (line 106)
   - **Recommendation**: Keep current behavior for backward compatibility

### Research Items

1. **Origin semantics deep dive** ✅ **COMPLETED**
   - **Status**: Analyzed in detail - see [origin-behavior-analysis.md](./origin-behavior-analysis.md)
   - **Findings**:
     - Two-stage origin check mechanism (frontend + backend)
     - Conflict detection correctly bypassed when `origin=editor` and latest is `editor/view`
     - Frontend should NOT send `revisionId` in these cases (by design for conflict detection)
     - Server-side fallback is the correct approach (preserves conflict detection semantics)
   - **Decision**: No frontend changes needed; implement server-side fallback

2. **Performance impact** (Research Needed - Low Priority)
   - Measure cost of additional `Revision.findById()` call when revisionId is missing
   - Scenarios affected: Editor mode with latest revision having `origin=editor/view` (most common)
   - Expected impact: Negligible (single indexed query on `_id` field)
   - **Note**: Query only runs when `revisionId` is not provided (already optimized for API case)
   - **Mitigation**: Consider caching if profiling shows impact

3. **Edge cases** (Investigation Needed - High Priority)
   - Test behavior when `currentPage.revision` is null (new pages - should not happen after first save)
   - Test behavior when `Revision.findById(currentPage.revision)` fails (corrupted data, race condition)
   - Test backward compatibility with existing revisions without `hasDiffToPrev` (should work via UI's `!== false` check)
   - Test all origin combinations:
     - Latest `editor` → Save with `editor` (no revisionId sent)
     - Latest `view` → Save with `editor` (no revisionId sent)
     - Latest `undefined` → Save with `editor` (revisionId sent)
     - API save with `origin=undefined` (revisionId always sent)

### Testing Strategy

- **Unit Tests**:
  - `prepareRevision()` with various previousBody values (null, empty string, content)
  - API fallback logic (revisionId provided vs. not provided)
  - Error handling paths

- **Integration Tests**:
  - Full save flow: editor → API → service → model → database
  - Verify `hasDiffToPrev` is set correctly in all scenarios
  - Test across origin values (view, editor, undefined)

- **Manual Testing**:
  - Save page with changes → verify full revision display
  - Save page without changes → verify simplified revision display
  - Test collaborative editing (origin=editor) still works
  - Test view mode saves (origin=view) still works

---

## 6. Requirement-to-Asset Mapping

| Requirement | Existing Assets | Gap Status | Action Needed |
|-------------|----------------|------------|---------------|
| **Req 1: Unchanged Revision Detection** | `Revision.prepareRevision()`, comparison logic exists | ⚠️ **Broken** - missing previousBody input | Fix API to fetch previous revision from currentPage.revision |
| **Req 2: Revision Metadata Persistence** | `IRevision.hasDiffToPrev`, database schema, model | ✅ **Complete** | None - already working |
| **Req 3: Page History Display Enhancement** | `Revision.tsx` (both render formats), `PageRevisionTable.tsx` | ✅ **Complete** | None - already working |
| **Req 4: Previous Revision Reference** | Frontend sends revisionId conditionally | ⚠️ **Inconsistent** | Design decision: server fallback vs. always send |
| **Req 5: Backward Compatibility** | UI handles undefined, optional field type | ✅ **Complete** | None - already supported |
| **Req 6: API Consistency and Error Handling** | Line ending normalization exists | ❌ **Missing** | Add error handling for revision fetch, handle first revision |

---

## 7. Summary

**Implementation Strategy**: Extend existing components with minimal surgical changes.

**Critical Path**:
1. Fix API previous revision retrieval (add fallback logic)
2. Improve prepareRevision error handling (handle null previousBody)
3. Test across origin scenarios (view/editor/undefined)

**Next Steps**:
1. Review and approve this gap analysis
2. Make design decisions (server fallback vs. frontend changes)
3. Proceed to `/kiro:spec-design improve-unchanged-revision` to create technical design document

**Confidence**: High - clear path forward with low risk and minimal changes required.
