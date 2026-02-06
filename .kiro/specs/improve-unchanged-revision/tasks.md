# Implementation Plan

## Task Overview

This implementation restores accurate diff detection for page revisions by adding fallback logic to the Page Update API. The change is minimal (1-2 files modified) because the business logic, data model, and UI components are already complete and functional.

**Implementation Scope:**
- Modify API layer to retrieve previous revision when not provided in request
- Add error handling to ensure save operations never fail due to retrieval issues
- Comprehensive testing to validate existing components work correctly with populated metadata

**No Changes Required:**
- Revision Model (prepareRevision logic already correct)
- UI Components (simplified/full display formats already implemented)
- Database Schema (hasDiffToPrev field already defined)
- Frontend (revision ID handling already correct)

---

## Implementation Tasks

### Major Task 1: Implement Server-Side Diff Detection

- [x] 1.1 Add fallback retrieval of previous revision content for comparison
  - Implement priority-based retrieval logic in the Page Update API handler
  - Priority 1: Use provided `revisionId` from request (for conflict detection)
  - Priority 2: Fallback to `currentPage.revision` when `revisionId` is undefined (for diff detection)
  - Priority 3: Set `previousBody = null` when both retrieval attempts fail or for first revision
  - Pass `previousBody` to Page Service to enable accurate diff detection
  - Maintain backward compatibility with existing API clients
  - Preserve origin-based conflict detection semantics (do not modify revision validation logic)
  - _Requirements: 1.1_

- [x] 1.2 Add error handling to ensure save operations never fail due to retrieval errors
  - Wrap revision retrieval attempts in try-catch blocks for both priority 1 and priority 2
  - Log errors with full context (revision IDs, page ID, error message, stack trace) at ERROR level
  - Default to `previousBody = null` when retrieval fails (prepareRevision will set `hasDiffToPrev: true`)
  - Ensure save operation continues successfully even when retrieval fails
  - Add structured logging to track fallback activation and error frequency
  - _Requirements: 1.5, 6.2_

### Major Task 2: Test Revision Retrieval Logic

- [ ] 2.1 (P) Test revision retrieval with provided revision ID and fallback scenarios
  - Test priority 1 retrieval: When `revisionId` is provided, fetch by `revisionId` and return revision body
  - Test priority 2 retrieval: When `revisionId` is undefined and `currentPage.revision` exists, fetch by `currentPage.revision`
  - Test priority 3 default: When both retrieval attempts fail or page has no previous revision, return `null`
  - Test fallback activation: Verify priority 2 activates only when priority 1 returns null
  - Verify `previousBody` is passed correctly to Page Service in all scenarios
  - _Requirements: 1.1_

- [ ] 2.2 (P) Test error handling when revision retrieval fails or returns unexpected data
  - Test database fetch failure in priority 1: Error logged, fallback to priority 2 activates
  - Test database fetch failure in priority 2: Error logged, `previousBody` becomes null
  - Test both fetch attempts fail: Two errors logged, save operation succeeds with `hasDiffToPrev: true`
  - Test corrupted revision ID: Invalid ObjectId handled gracefully, appropriate error logged
  - Test network timeout during fetch: Timeout error logged, save continues
  - Verify error logging includes all required context fields (revision IDs, page ID, error details)
  - _Requirements: 1.5, 6.2_

### Major Task 3: Test Complete Page Update Flow

- [ ] 3.1 (P) Test page updates from different editing contexts preserve diff metadata
  - Test Editor mode save (origin=editor, latest revision origin=editor): Fallback activates, `hasDiffToPrev` set correctly for identical and different content
  - Test Editor mode save (origin=editor, latest revision origin=undefined): Revision ID provided, no fallback, `hasDiffToPrev` set correctly
  - Test View mode save (origin=view): Revision ID handling depends on latest origin, `hasDiffToPrev` set correctly
  - Test API-based save (origin=undefined): Revision ID provided, no fallback, `hasDiffToPrev` set correctly
  - Verify `hasDiffToPrev: false` when body is identical to previous body (unchanged save)
  - Verify `hasDiffToPrev: true` when body differs from previous body (changed save)
  - Verify `hasDiffToPrev` is persisted to database with correct value
  - Verify Page Revisions API includes `hasDiffToPrev` field in response
  - Verify field type is boolean when set, undefined when not set (backward compatibility)
  - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3_

- [ ] 3.2 (P) Test page updates handle edge cases and data anomalies gracefully
  - Test first revision creation (no previous revision): `hasDiffToPrev` left undefined, save succeeds
  - Test `previousBody` is null during comparison: `hasDiffToPrev` set to `true` (Model layer default behavior)
  - Test database error during previous revision fetch: Error logged, save succeeds with `hasDiffToPrev: true`
  - Test line ending normalization: CRLF and LF line endings compared correctly (Model layer behavior)
  - Test corrupted `currentPage.revision` reference: Error handled, save succeeds with `hasDiffToPrev: undefined`
  - Test very large page bodies (> 100KB): Comparison completes successfully, consider performance monitoring
  - _Requirements: 1.5, 6.1, 6.2, 6.3, 6.4_

- [ ] 3.3 (P) Test page updates maintain backward compatibility with legacy revisions
  - Test page with existing revisions lacking `hasDiffToPrev` field: New revisions correctly populate field, old revisions remain unchanged
  - Test mixed revision history (some with field, some without): All revisions retrieved correctly, undefined treated as `true` by UI
  - Test API clients that do not send `revisionId`: Fallback logic activates, `hasDiffToPrev` populated correctly
  - Test page history display with legacy pages: No errors, graceful handling of undefined values
  - Verify no database migration is required for existing revisions
  - _Requirements: 5.1, 5.2, 5.3_

### Major Task 4: Test Page History Display

- [ ] 4.1 (P) Test page history displays unchanged revisions in simplified format
  - Test revision with `hasDiffToPrev: false` renders in simplified format (user picture, timestamp, "No diff" label only)
  - Test revision with `hasDiffToPrev: true` renders in full format (user picture, username, timestamp, "Go to this version" link, diff controls)
  - Test revision with `hasDiffToPrev: undefined` (legacy revision) renders in full format
  - Test simplified format uses smaller visual space compared to full format
  - Test multiple consecutive unchanged revisions display correctly in simplified format
  - Test mixed history (changed and unchanged revisions) displays with correct formats
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 4.2 (P) Test collaborative editing sessions correctly detect and display unchanged saves
  - Test real-time collaborative editing session with Yjs: Multiple users editing simultaneously, saves succeed without conflicts
  - Test unchanged save during collaborative editing: Fallback activates (revisionId not sent), `hasDiffToPrev: false` set correctly, simplified display in history
  - Test changed save during collaborative editing: `hasDiffToPrev: true` set correctly, full display in history
  - Test rapid successive saves (changed and unchanged): All revisions created with correct metadata, history displays correctly
  - Test page history after collaborative session: Mix of changed and unchanged revisions display in appropriate formats
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 3.3, 3.4_

---

## Requirements Coverage Summary

**All 6 requirements (24 acceptance criteria) covered:**

| Requirement | Acceptance Criteria | Covered By Tasks |
|-------------|---------------------|------------------|
| 1. Unchanged Revision Detection | 1.1, 1.2, 1.3, 1.4, 1.5 | 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.2 |
| 2. Revision Metadata Persistence | 2.1, 2.2, 2.3 | 3.1 |
| 3. Page History Display Enhancement | 3.1, 3.2, 3.3, 3.4 | 4.1, 4.2 |
| 4. Previous Revision Reference | 4.1, 4.2, 4.3 | (Already implemented, validated by 3.1) |
| 5. Backward Compatibility | 5.1, 5.2, 5.3 | 3.3 |
| 6. API Consistency & Error Handling | 6.1, 6.2, 6.3, 6.4 | 1.2, 2.2, 3.2 |

**Implementation Summary:**
- **2 implementation sub-tasks** (1.1, 1.2): Modify API layer with fallback logic and error handling
- **2 unit test sub-tasks** (2.1, 2.2): Verify retrieval and error handling logic
- **3 integration test sub-tasks** (3.1, 3.2, 3.3): Validate complete flow, edge cases, backward compatibility
- **2 E2E test sub-tasks** (4.1, 4.2): Verify UI display and collaborative editing

**Parallel Execution:**
- Tasks 1.1 and 1.2 are sequential (1.2 depends on 1.1)
- Tasks 2.1 and 2.2 can run in parallel (independent test scopes)
- Tasks 3.1, 3.2, and 3.3 can run in parallel (independent test scenarios)
- Tasks 4.1 and 4.2 can run in parallel (independent UI scenarios)

---

## Next Steps

1. **Review this task plan** and confirm it aligns with requirements and design
2. **Approve tasks** to proceed with implementation
3. **Execute tasks** using `/kiro:spec-impl improve-unchanged-revision` or specific tasks like `/kiro:spec-impl improve-unchanged-revision 1.1`
4. **Note**: Clear conversation context between task executions to maintain optimal performance
