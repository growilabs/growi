# Post-Implementation Gap Analysis: suggest-path Services

## Summary

Code review of `src/features/ai-tools/suggest-path/server/services/` identified three improvement areas in the implemented Phase 2 code:

- **Over-abstraction**: `GenerateSuggestionsDeps` DI pattern and `RetrieveSearchCandidatesOptions` add unnecessary indirection for a feature-specific service layer
- **Missing code comments**: `callLlmForJson` is a justified shared utility, but lacks documentation explaining why the abstraction exists
- **Weak typing**: `userGroups: unknown` propagated through multiple layers can be narrowed to `ObjectIdLike[]`

## Detailed Analysis

### Gap 1: `GenerateSuggestionsDeps` Dependency Injection (Over-Abstraction)

**Current state**: `generateSuggestions()` accepts a `deps` parameter containing 5 callback functions (`analyzeContent`, `retrieveSearchCandidates`, `evaluateCandidates`, `generateCategorySuggestion`, `resolveParentGrant`). The route handler wires these dependencies manually (10 lines of boilerplate).

**Problem**: This is a testability-motivated DI pattern, but Vitest's `vi.mock()` achieves the same goal. Other modules in the same directory (e.g., `generate-memo-suggestion`) already use `vi.mock()` for testing. The `deps` pattern is inconsistent with the rest of the codebase and adds maintenance overhead.

**Impact**: Route handler verbosity, extra type definition (`GenerateSuggestionsDeps`), and forces `retrieveSearchCandidates` to use a lambda wrapper for partial application of `searchService`.

**Recommendation**: Remove `deps` parameter. Import service functions directly. Pass `searchService` as a direct argument (the only true external dependency). Test with `vi.mock()`.

### Gap 2: `RetrieveSearchCandidatesOptions` (Over-Abstraction)

**Current state**: `retrieveSearchCandidates()` takes an `options` object containing `searchService` (required) and `scoreThreshold` (optional, never overridden).

**Problem**: `searchService` is effectively a required dependency, not an optional configuration. Wrapping it in an options object obscures this. `scoreThreshold` has a sensible default and no caller overrides it.

**Impact**: The options pattern exists primarily to support the lambda wrapper in the route handler (which itself exists only because of `GenerateSuggestionsDeps`). Removing Gap 1 simplifies this naturally.

**Recommendation**: Make `searchService` a direct positional argument. Keep `scoreThreshold` as a module-level constant (no options object needed unless a caller actually needs to override it).

### Gap 3: `callLlmForJson` Missing Documentation

**Current state**: `callLlmForJson` is a shared utility used by both `analyzeContent` and `evaluateCandidates`. This is a justified abstraction — it eliminates duplication of LLM client initialization, JSON parsing, and validation logic.

**Problem**: No code comment explains why this utility exists or what it encapsulates. A future reader might question whether it's another instance of over-abstraction.

**Recommendation**: Add a brief JSDoc comment explaining its purpose and the two consumers.

### Gap 4: `userGroups: unknown` Type Weakness

**Current state**: `userGroups` is typed as `unknown` in `SearchService` interface, `retrieveSearchCandidates`, `generateSuggestions`, and `GenerateSuggestionsDeps`.

**Root cause**: The upstream `searchKeyword` method in `src/server/service/search.ts` has untyped parameters (legacy JS-to-TS migration). The suggest-path code used `unknown` as a safe catch-all.

**Actual type**: `findAllUserGroupIdsRelatedToUser()` returns `ObjectIdLike[]` (from `@growi/core`). This type can be used in the `SearchService` interface and propagated through the suggest-path service layer.

**Recommendation**: Update `SearchService.searchKeyword` parameter type from `unknown` to `ObjectIdLike[]`, and propagate through `retrieveSearchCandidates` and `generateSuggestions`.

## Effort & Risk

| Gap | Effort | Risk | Notes |
|-----|--------|------|-------|
| Gap 1 (remove deps DI) | S | Low | Straightforward refactor, tests need rewrite to use `vi.mock()` |
| Gap 2 (remove options) | S | Low | Naturally follows from Gap 1 |
| Gap 3 (add JSDoc) | S | Low | Comment-only change |
| Gap 4 (type narrowing) | S | Low | Type change only, no runtime impact |

**Overall**: S effort (1-2 days), Low risk. All changes are internal refactoring with no API surface or behavioral changes.
