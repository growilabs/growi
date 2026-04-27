# Implementation Plan

## Phase 1 (MVP) — Implemented

- [x] 1. Phase 1 MVP — Shared types, memo path suggestion, and endpoint registration
- [x] 1.1 Define suggestion types and implement memo path generation
- [x] 1.2 Register route endpoint with authentication and validation
- [x] 1.3 Phase 1 integration verification

## Phase 2 — Revised

- [x] 2. (P) Enhance grant resolver for ancestor path traversal
- [x] 3. (P) Content analysis via GROWI AI (1st AI call)
- [x] 4. (P) Search candidate retrieval with score threshold filtering
- [x] 5. (P) AI-based candidate evaluation and path proposal (2nd AI call)
- [x] 6. (P) Category-based path suggestion (under review — prior implementation retained)
- [x] 7. Phase 2 revised orchestration and integration
- [x] 7.1 Rewrite orchestration for revised Phase 2 pipeline
- [x] 7.2 Phase 2 integration verification

## Post-Implementation Refactoring (from code review)

- [x] 8. Simplify service layer abstractions
- [x] 8.1 Remove `GenerateSuggestionsDeps` DI pattern from `generate-suggestions.ts`
- [x] 8.2 Remove `RetrieveSearchCandidatesOptions` from `retrieve-search-candidates.ts`
- [x] 8.3 Add JSDoc to `call-llm-for-json.ts`
- [x] 8.4 Narrow `userGroups: unknown` to `ObjectIdLike[]`

## Requirements Coverage

| Requirement | Task(s) |
|-------------|---------|
| 1.1 | 1.2, 1.3, 7.1 |
| 1.2 | 1.1, 1.3, 7.1 |
| 1.3 | 1.1, 1.3, 7.1 |
| 1.4 | 1.2, 1.3 |
| 2.1 | 1.1, 1.3 |
| 2.2 | 1.1 |
| 2.3 | 1.1 |
| 2.4 | 1.1 |
| 2.5 | 1.1 |
| 3.1 | 4, 7.2 |
| 3.2 | 4, 7.2 |
| 3.3 | 5, 7.1, 7.2 |
| 3.4 | 7.1, 7.2 |
| 3.5 | 4, 7.2 |
| 4.1 | 6 |
| 4.2 | 6 |
| 4.3 | 6 |
| 4.4 | 6 |
| 5.1 | 3, 7.2 |
| 5.2 | 3 |
| 5.3 | 4, 7.1 |
| 5.4 | 3, 7.2 |
| 5.5 | 7.1, 7.2 |
| 6.1 | 1.1, 7.2 |
| 6.2 | 1.1 |
| 6.3 | 5, 7.2 |
| 7.1 | 2 |
| 7.2 | 2 |
| 8.1 | 1.2, 1.3 |
| 8.2 | 1.2, 1.3 |
| 8.3 | 1.2, 7.1 |
| 9.1 | 1.2, 1.3 |
| 9.2 | 1.2, 7.1 |
| 10.1 | 5, 7.2 |
| 10.2 | 5 |
| 10.3 | 5 |
| 10.4 | 5 |
| 11.1 | 5, 7.2 |
| 11.2 | 5 |
| 11.3 | 5 |
| 11.4 | 7.1, 7.2 |
| 12.1 | 5, 7.2 |
| 12.2 | 5 |
| 12.3 | 5 |
| 12.4 | 5 |
| 13.1 | 7.1, 7.2 |
| 13.2 | 7.1, 7.2 |
| 13.3 | 7.1 |
