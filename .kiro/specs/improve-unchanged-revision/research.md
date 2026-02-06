# Research & Design Decisions

## Summary
- **Feature**: `improve-unchanged-revision`
- **Discovery Scope**: Extension (fixing existing system with 90% complete infrastructure)
- **Key Findings**:
  - Existing data model, business logic, and UI components are complete and functional
  - Core issue is broken data flow: server lacks fallback to fetch previous revision when `revisionId` is not provided
  - Origin-based conflict detection system is correctly designed and should not be changed
  - Server-side fallback approach preserves all existing behaviors while enabling diff detection

## Research Log

### Origin Field Semantics and Conflict Detection

**Context**: Understanding when `revisionId` is required vs. optional to design proper fallback logic without breaking existing conflict detection.

**Sources Consulted**:
- `apps/app/src/server/models/obsolete-page.js` - `isUpdatable()` method (lines 159-182)
- `apps/app/src/client/components/PageEditor/PageEditor.tsx` - revision ID logic (lines 158, 284-310)
- Gap analysis document - comprehensive scenario analysis
- Origin behavior analysis document - detailed flow analysis

**Findings**:
- **Two-stage origin check mechanism**:
  1. Frontend checks `currentPage?.revision?.origin === undefined` to determine if `revisionId` should be sent
  2. Backend checks `(origin === Editor) && (latestRevisionOrigin === Editor || View)` to bypass revision validation
- **Key scenarios**:
  - Latest revision has `origin=editor/view` + Save with `origin=editor` → revisionId NOT sent, conflict check bypassed
  - Latest revision has `origin=undefined` + Save with `origin=editor` → revisionId sent, conflict check enforced
  - API save with `origin=undefined` → revisionId always sent (required), conflict check enforced
- **Critical insight**: Conflict detection (revision check) and diff detection (hasDiffToPrev) serve different purposes but current implementation conflates them

**Implications**:
- Frontend logic is correct for conflict detection and should NOT be changed
- Server must add fallback logic to fetch previous revision from `currentPage.revision` when `revisionId` is not provided
- This approach preserves Yjs collaborative editing semantics while enabling diff detection

### Performance Impact of String Comparison

**Context**: Concern about comparing potentially large revision bodies (tens of thousands of characters) on every save.

**Sources Consulted**:
- JavaScript string comparison performance characteristics
- Existing implementation analysis (comparison already occurs in some cases)
- Performance analysis document

**Findings**:
- **Current state**: String comparison already occurs for API saves and legacy page saves
- **New impact**: Comparison will now occur for all Editor mode saves (most common case)
- **Performance characteristics**:
  - **Changed content (90%+ of cases)**: Early exit optimization, O(1)~O(k), < 1ms
  - **Unchanged content (rare)**: Full comparison, O(n), 1-10ms for tens of thousands of characters
  - **Memory**: Temporary allocation of previousBody (few KB to few MB), released after request
- **Database query**: Single indexed query on `_id` field (primary key), negligible cost

**Implications**:
- Risk is low for typical usage (normal page sizes, moderate concurrency)
- Should add monitoring/logging for comparison time > 10ms
- Size-based optimization (skip comparison for very large pages) can be added later if needed
- Phase 1: Simple implementation with monitoring
- Phase 2: Optimize based on real-world metrics if necessary

### Existing Data Model and Infrastructure

**Context**: Understanding what infrastructure already exists to avoid unnecessary work.

**Sources Consulted**:
- `packages/core/src/interfaces/revision.ts` - IRevision interface
- `apps/app/src/server/models/revision.ts` - Revision schema and prepareRevision method
- `apps/app/src/client/components/PageHistory/Revision.tsx` - UI rendering logic
- `apps/app/src/client/components/PageHistory/PageRevisionTable.tsx` - History display logic

**Findings**:
- **Data model (✅ Complete)**:
  - `hasDiffToPrev?: boolean` field defined in IRevision interface
  - Mongoose schema includes field definition
  - Optional field supports backward compatibility (undefined treated as true)
- **Business logic (⚠️ Partially working)**:
  - `prepareRevision()` method already compares `body !== previousBody`
  - Only sets `hasDiffToPrev` when `pageData.revision != null`
  - Line ending normalization handled automatically by body getter
- **UI components (✅ Complete)**:
  - Simplified format (`renderSimplifiedNodiff()`) and full format (`renderFull()`) both implemented
  - Conditional rendering based on `hasDiffToPrev` value
  - Backward compatibility with undefined values

**Implications**:
- Infrastructure is 90% complete, only need to fix data flow
- No UI changes required
- No schema changes required
- No database migration needed

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Selected |
|--------|-------------|-----------|---------------------|----------|
| Server-side Fallback | Add fallback logic in update-page API to fetch `currentPage.revision` when `revisionId` is undefined | - No frontend changes<br>- Preserves conflict detection logic<br>- Works across all clients<br>- Minimal code changes (2-3 files) | - Additional DB query when revisionId not provided<br>- Performance impact on Editor mode saves | ✅ Yes |
| Frontend Always Send | Modify frontend to always send `revisionId` regardless of origin | - No server-side fallback needed<br>- Explicit revision tracking | - Requires frontend changes<br>- May conflict with origin semantics<br>- Breaks carefully designed conflict detection | ❌ No |
| Client-side Comparison | Let client compare and send `hasDiffToPrev` value | - Server load reduced<br>- Client has both old and new content | - Security risk (client can be tampered)<br>- Doesn't work for API saves<br>- Inconsistency with server normalization | ❌ No |
| Hash-based Comparison | Store body hash in revision, compare hashes instead of bodies | - O(1) comparison<br>- Reduces memory (don't need previousBody) | - Schema change required<br>- Migration needed<br>- Hash calculation cost same as comparison<br>- Added complexity | ❌ Not yet (consider if performance issues arise) |

## Design Decisions

### Decision: Server-side Fallback for Previous Revision Retrieval

**Context**: The Page Update API needs access to `previousBody` for diff detection, but `revisionId` is not always sent due to origin-based conflict detection logic.

**Alternatives Considered**:
1. **Server-side fallback** — Fetch `currentPage.revision` when `revisionId` is undefined
2. **Frontend always send** — Modify frontend to always include `revisionId`
3. **Client-side comparison** — Let frontend calculate `hasDiffToPrev` and send it
4. **Hash-based comparison** — Store and compare body hashes instead of full content

**Selected Approach**: Server-side fallback (Option 1)

**Rationale**:
- **Preserves conflict detection semantics**: No changes to carefully designed origin-based logic
- **Minimal changes**: Only 2-3 files need modification
- **Universal compatibility**: Works for all clients (web, mobile, API) without frontend updates
- **Backward compatible**: Existing API behavior unchanged when `revisionId` is provided
- **Future-proof**: Doesn't preclude performance optimizations later

**Trade-offs**:
- **Benefit**: Simple, maintainable, preserves existing behaviors
- **Cost**: Additional database query (single indexed lookup) when `revisionId` is not provided
- **Risk**: Performance impact on high-concurrency Editor mode saves (mitigated by monitoring)

**Follow-up**:
- Add monitoring for query performance
- Add logging for comparison time > 10ms
- Consider hash-based optimization if real-world metrics show performance issues

### Decision: Default Error Handling Strategy

**Context**: Need to define behavior when previous revision cannot be retrieved or comparison fails.

**Alternatives Considered**:
1. **Default to true** — Assume changes exist, set `hasDiffToPrev: true`
2. **Leave undefined** — Keep field undefined for backward compatibility
3. **Fail save operation** — Reject the save if diff detection fails

**Selected Approach**: Default to true with logging (Option 1)

**Rationale**:
- **Graceful degradation**: Save operation should not fail due to metadata calculation errors
- **Conservative assumption**: Assuming changes exist is safer than assuming no changes
- **User experience**: Users can still save their work even if diff detection fails
- **Observability**: Error logging enables detection and investigation of issues

**Trade-offs**:
- **Benefit**: Robust, user-friendly behavior
- **Cost**: May show some revisions in full format unnecessarily if errors occur
- **Risk**: Errors might go unnoticed without proper monitoring

**Follow-up**:
- Implement comprehensive error logging
- Set up monitoring/alerting for diff detection failures
- Document error scenarios in operational runbook

### Decision: No Frontend Changes Required

**Context**: Initial requirement suggested frontend should send `revisionId` for diff detection, but origin analysis revealed this would conflict with conflict detection logic.

**Alternatives Considered**:
1. **Keep frontend unchanged** — Server handles missing `revisionId` via fallback
2. **Always send revisionId** — Frontend modified to include `revisionId` regardless of origin

**Selected Approach**: Keep frontend unchanged (Option 1)

**Rationale**:
- **Conflict detection correctness**: Current frontend logic correctly implements origin-based conflict prevention
- **Separation of concerns**: Conflict detection (frontend concern) vs. diff detection (server concern)
- **Simplicity**: No frontend changes reduces implementation scope and risk
- **Yjs compatibility**: Preserves collaborative editing semantics

**Trade-offs**:
- **Benefit**: No risk of breaking conflict detection, simpler implementation
- **Cost**: Server must implement fallback logic
- **Risk**: None identified

**Follow-up**:
- Verify Yjs collaborative editing still works correctly
- Test all origin scenarios (editor, view, undefined)

## Risks & Mitigations

**Performance Risk**: String comparison of large revision bodies may impact response times
- **Mitigation**: Add performance monitoring, implement size-based optimization if needed
- **Severity**: Low (existing implementation already does comparison in some cases)
- **Detection**: Log comparison time > 10ms, monitor P95/P99 latencies

**Memory Risk**: Loading previousBody increases memory footprint during high-concurrency saves
- **Mitigation**: Memory released after request, consider caching if profiling shows issues
- **Severity**: Low (temporary allocation, typical pages are small)
- **Detection**: Monitor heap usage and GC frequency

**Edge Case Risk**: First revision (no previous revision) or corrupted data
- **Mitigation**: Defensive checks for null values, default to true on errors
- **Severity**: Low (handled by existing logic and error handling)
- **Detection**: Error logging and monitoring

**Regression Risk**: Changes to update-page API might break existing save operations
- **Mitigation**: Comprehensive testing across all origin scenarios, gradual rollout
- **Severity**: Medium (critical save path)
- **Detection**: Integration tests, smoke tests, staged deployment

## References

- [Gap Analysis](.kiro/specs/improve-unchanged-revision/gap-analysis.md) — Comprehensive analysis of existing implementation and gaps
- [Origin Behavior Analysis](.kiro/specs/improve-unchanged-revision/origin-behavior-analysis.md) — Detailed analysis of origin field semantics and two-stage check mechanism
- [GROWI Dev Page on Origin](https://dev.growi.org/651a6f4a008fee2f99187431#origin-%E3%81%AE%E5%BC%B7%E5%BC%B1) — Official documentation on origin field semantics
- [IRevision Interface](packages/core/src/interfaces/revision.ts) — TypeScript interface definition
- [Revision Model](apps/app/src/server/models/revision.ts) — Mongoose schema and prepareRevision method
- [Page Update API](apps/app/src/server/routes/apiv3/page/update-page.ts) — API handler for page updates
