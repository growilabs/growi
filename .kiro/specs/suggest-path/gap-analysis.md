# Gap Analysis: suggest-path Feature

## 1. Analysis Summary

- **Scope**: The suggest-path feature's Phase 1 (memo) and Phase 2 (AI-powered search-based suggestions) are **both fully implemented** in terms of business logic. All 13 requirements have corresponding code.
- **Key Gap**: The implementation resides in `server/routes/apiv3/ai-tools/` (a legacy flat route layout), **not** in the `features/` directory pattern that is the project standard for new features. The user explicitly requests migration to the features directory pattern.
- **Architecture Pattern Mismatch**: Current code is organized as flat files in a route directory, mixing service logic, AI calls, search integration, type definitions, and tests in one folder (~15 files). The `features/` pattern separates these into `server/services/`, `server/routes/`, `interfaces/`, and co-located tests.
- **No Functional Gaps**: All requirements (R1–R13) have working implementations with comprehensive test coverage (8 unit test files + 1 integration test). The AI pipeline (analyze → search → evaluate → suggest) is complete and includes graceful degradation.
- **Recommendation**: The primary work is a **structural refactoring** — reorganize existing code into `features/suggest-path/` with proper separation of concerns, without changing business logic. This provides a clean foundation if further iteration on the feature is needed.

---

## 2. Requirement-to-Asset Map

| Req | Description | Status | Existing Assets | Gap |
|-----|-------------|--------|-----------------|-----|
| R1 | Path Suggestion API Endpoint | Implemented | `suggest-path.ts`, `ai-tools/index.ts` | Structure only: route lives in `routes/apiv3/ai-tools/` not `features/` |
| R2 | Memo Path Suggestion (Phase 1) | Implemented | `generate-memo-suggestion.ts` | None |
| R3 | Search-Based Path Suggestion | Implemented | `retrieve-search-candidates.ts`, `generate-suggestions.ts` | None |
| R4 | Category-Based Path Suggestion (Under Review) | Implemented | `generate-category-suggestion.ts` | Retained as-is per requirements |
| R5 | Content Analysis via GROWI AI | Implemented | `analyze-content.ts` | None |
| R6 | Suggestion Description Generation | Implemented | AI-generated in `evaluate-candidates.ts`, fixed in `generate-memo-suggestion.ts` | None |
| R7 | Grant Constraint Information | Implemented | `resolve-parent-grant.ts` | None |
| R8 | Authentication and Authorization | Implemented | Middleware chain in `suggest-path.ts` | None |
| R9 | Input Validation and Error Handling | Implemented | express-validator in `suggest-path.ts` | None |
| R10 | Flow/Stock Information Type Awareness | Implemented | `analyze-content.ts` + `evaluate-candidates.ts` SYSTEM_PROMPT | None |
| R11 | AI-Based Candidate Evaluation | Implemented | `evaluate-candidates.ts` with 3-pattern proposal | None |
| R12 | Path Proposal Patterns | Implemented | Parent/subdirectory/sibling in SYSTEM_PROMPT | None |
| R13 | Client LLM Independence | Implemented | `informationType` field in `PathSuggestion` type | None |

**Legend**: All requirements are functionally complete. The only gap is structural — code organization does not follow the `features/` directory pattern.

---

## 3. Current Code Structure (As-Is)

```
server/routes/apiv3/ai-tools/          # Legacy flat route directory
├── index.ts                            # Router factory (7 lines)
├── suggest-path.ts                     # Handler + middleware chain
├── suggest-path-types.ts               # All type definitions
├── generate-suggestions.ts             # Orchestrator (pipeline coordinator)
├── generate-memo-suggestion.ts         # Phase 1: memo suggestion
├── analyze-content.ts                  # AI call #1: keyword + flow/stock
├── retrieve-search-candidates.ts       # ES search with score filtering
├── evaluate-candidates.ts              # AI call #2: candidate evaluation
├── generate-category-suggestion.ts     # Category suggestion (under review)
├── generate-search-suggestion.ts       # Legacy/utility search helper
├── resolve-parent-grant.ts             # Grant resolution by ancestor lookup
├── suggest-path.spec.ts                # Handler unit tests
├── suggest-path-integration.spec.ts    # Full integration tests
├── generate-suggestions.spec.ts        # Orchestrator tests
├── analyze-content.spec.ts             # AI analysis tests
├── evaluate-candidates.spec.ts         # AI evaluation tests
├── retrieve-search-candidates.spec.ts  # Search retrieval tests
├── generate-memo-suggestion.spec.ts    # Memo tests
├── generate-category-suggestion.spec.ts # Category tests
└── resolve-parent-grant.spec.ts        # Grant resolution tests
```

**Observations**:
- 20+ files in a single flat directory
- Service logic (AI calls, search, grant resolution) mixed with route handler code
- Type definitions are local to the route directory
- No `server/` vs `interfaces/` separation
- Tests are co-located (good), but the directory is bloated

---

## 4. Target Code Structure (To-Be: Features Pattern)

Based on the `features/openai/` reference pattern and user preference:

```
features/suggest-path/
├── interfaces/                         # Shared types (server + client reusable)
│   └── suggest-path-types.ts           # PathSuggestion, ContentAnalysis, etc.
├── server/
│   ├── routes/
│   │   └── apiv3/
│   │       └── index.ts                # Router factory, handler + middleware
│   ├── services/
│   │   ├── generate-suggestions.ts     # Orchestrator
│   │   ├── generate-suggestions.spec.ts
│   │   ├── generate-memo-suggestion.ts
│   │   ├── generate-memo-suggestion.spec.ts
│   │   ├── analyze-content.ts          # AI call #1
│   │   ├── analyze-content.spec.ts
│   │   ├── evaluate-candidates.ts      # AI call #2
│   │   ├── evaluate-candidates.spec.ts
│   │   ├── retrieve-search-candidates.ts
│   │   ├── retrieve-search-candidates.spec.ts
│   │   ├── generate-category-suggestion.ts
│   │   ├── generate-category-suggestion.spec.ts
│   │   ├── resolve-parent-grant.ts
│   │   └── resolve-parent-grant.spec.ts
│   └── integration-tests/
│       └── suggest-path-integration.spec.ts
└── index.ts                            # Feature barrel export (optional)
```

---

## 5. Implementation Approach Options

### Option A: Refactor to Features Directory (Recommended)

**What**: Move all suggest-path code from `server/routes/apiv3/ai-tools/` to `features/suggest-path/` with proper separation.

**Steps**:
1. Create `features/suggest-path/` directory structure
2. Move types to `interfaces/`
3. Move service modules (AI calls, search, grant, orchestrator) to `server/services/`
4. Move/rewrite route handler to `server/routes/apiv3/`
5. Update `server/routes/apiv3/index.js` mount point from `./ai-tools` to `~/features/suggest-path/server/routes/apiv3`
6. Update all internal import paths
7. Run tests, lint, typecheck to verify

**Trade-offs**:
- ✅ Aligns with project architecture standard (`features/openai/` pattern)
- ✅ Clear separation: services vs. routes vs. interfaces
- ✅ Easier to extend with client-side components later
- ✅ Consistent with team convention
- ❌ Significant import path changes across ~20 files
- ❌ Risk of regressions in test setup (mock paths change)
- ❌ Git history split on file moves

### Option B: Keep Current Location, Reorganize Internally

**What**: Keep code in `server/routes/apiv3/ai-tools/` but create subdirectories for services/types.

**Trade-offs**:
- ✅ Minimal import changes
- ✅ Lower regression risk
- ❌ Does **not** align with project architecture standard
- ❌ Continues the pattern of mixing service logic in route directories

### Option C: Hybrid — Feature Directory for New Code, Legacy for Existing

**What**: Create `features/suggest-path/` for new additions, keep existing working code in place.

**Trade-offs**:
- ✅ Non-breaking for existing code
- ❌ Split feature across two locations — confusing for developers
- ❌ Deferred tech debt

---

## 6. Detailed Gap Analysis: Features Pattern Migration

### 6.1 Route Registration

**Current** (`server/routes/apiv3/index.js`):
```javascript
import { factory as aiToolsRouteFactory } from './ai-tools';
router.use('/ai-tools', aiToolsRouteFactory(crowi));
```

**Target**:
```javascript
import { factory as suggestPathRouteFactory } from '~/features/suggest-path/server/routes/apiv3';
router.use('/ai-tools', suggestPathRouteFactory(crowi));
```

**Gap**: The `ai-tools/index.ts` currently only mounts `suggest-path`. If `ai-tools` is solely for suggest-path, the entire namespace can be owned by the feature. If other ai-tools routes are planned, an aggregation router may be needed.

### 6.2 Cross-Feature Dependencies

The suggest-path code depends on:
- **`features/openai/`**: `certifyAiService` middleware, `getClient` / `isStreamResponse`, `instructionsForInformationTypes`
- **`features/external-user-group/`**: `ExternalUserGroupRelation` model
- **`server/service/search.ts`**: `searchService.searchKeyword()`
- **`server/models/`**: `Page` model (grant resolution), `UserGroupRelation`
- **`@growi/core`**: `PageGrant`, `userHomepagePath`, `SCOPE`, `IUserHasId`

These dependencies are already cross-feature imports and will work the same from `features/suggest-path/`. No dependency issues.

### 6.3 Test Migration

All 9 test files use:
- `vi.mock()` with module path strings — **all mock paths must be updated**
- `vi.hoisted()` for mock setup
- Integration test uses `supertest` — mount path and factory import will change

**Risk**: Medium — mock path updates are mechanical but error-prone. Must verify all tests pass after migration.

### 6.4 Import Path Updates

Approximately **50+ import statements** across production and test files will need path updates:
- `./suggest-path-types` → `~/features/suggest-path/interfaces/suggest-path-types`
- `./analyze-content` → `../services/analyze-content` (from route handler)
- `~/features/openai/...` → remains the same (already feature-relative)

---

## 7. Implementation Complexity & Risk

| Aspect | Assessment |
|--------|------------|
| **Effort** | **S (1–3 days)** — Pure structural refactoring with no business logic changes. All code already written and tested. |
| **Risk** | **Low** — Familiar tech (file moves + import rewrites), no architectural shifts, comprehensive existing test suite acts as safety net. |

**Justification**:
- No new functionality to implement (all R1–R13 done)
- The refactoring is mechanical: create directories, move files, update imports
- Existing test suite (unit + integration) provides confidence
- Pattern is well-established in codebase (`features/openai/` as reference)

---

## 8. Recommendations for Design Phase

### Preferred Approach

**Option A: Full migration to `features/suggest-path/`** is recommended because:
1. It fulfills the user's explicit request for features directory pattern
2. It aligns with the established project convention
3. The effort is low (S) with low risk due to comprehensive test coverage
4. It creates a clean foundation for any future suggest-path enhancements

### Key Decisions for Design

1. **API Path Preservation**: Keep `POST /_api/v3/ai-tools/suggest-path` unchanged — only internal file organization changes, not the public API.
2. **`ai-tools` Router Ownership**: Determine if `features/suggest-path/` owns the `/ai-tools` route namespace, or if an aggregation router should remain in `routes/apiv3/`.
3. **Barrel Exports**: Decide whether `features/suggest-path/index.ts` exports types/services for potential reuse by other features.
4. **`generate-search-suggestion.ts`**: This file appears to be a legacy/alternate helper. Determine if it should be migrated or removed.

### Research Items

- **R4 (Category-Based Suggestion)**: Marked "under review" in requirements. Design phase should confirm whether to retain, merge, or remove the category type during migration.
- **`ai-tools` Namespace**: Verify no other features plan to use `/_api/v3/ai-tools/` before assigning it to the suggest-path feature module.
