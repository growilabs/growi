# Implementation Plan

## Phase 1 (MVP) — Implemented

- [x] 1. Phase 1 MVP — Shared types, memo path suggestion, and endpoint registration
- [x] 1.1 Define suggestion types and implement memo path generation
  - Define the suggestion response types used across both phases: suggestion type discriminator, individual suggestion structure with type/path/label/description/grant fields, and the response wrapper
  - Implement memo path generation: when user pages are enabled (default), generate path under the user's home directory with owner-only grant; when user pages are disabled, generate path under an alternative namespace with hardcoded owner-only grant (actual parent grant resolution deferred to Phase 2 task 2)
  - Enforce directory path format with trailing slash for all generated paths
  - Generate fixed descriptive text for memo suggestions
  - Include unit tests covering both user-pages-enabled and user-pages-disabled paths, verifying correct path format, grant value, and description
  - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2_

- [x] 1.2 Register route endpoint with authentication and validation
  - Create the route under a new namespace separate from the page API, following the existing handler factory pattern
  - Apply the standard middleware chain: access token parsing, strict login requirement, AI service gating, request body validation
  - Implement the handler to invoke memo suggestion generation for the authenticated user and return the suggestions array using the standard API response format
  - Return appropriate error responses for authentication failures, validation failures, and AI-disabled states without exposing internal system details
  - Register the new namespace route in the central API router
  - _Requirements: 1.1, 1.4, 8.1, 8.2, 8.3, 9.1, 9.2_

- [x] 1.3 Phase 1 integration verification
  - Verify the complete request-response cycle for the memo suggestion endpoint with valid authentication
  - Verify authentication enforcement: unauthenticated requests receive appropriate error responses
  - Verify input validation: requests with missing or empty body field receive validation errors
  - Verify AI service gating: requests when AI is disabled receive appropriate error responses
  - Verify response structure: correct fields, trailing slash on path, correct grant value
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 8.1, 8.2, 9.1, 9.2_

## Phase 2 — Revised

- [ ] 2. (P) Enhance grant resolver for ancestor path traversal
  - Enhance the existing grant resolution to support paths that may not yet exist in GROWI, as required by the sibling pattern where new directory names are generated
  - When the direct parent page exists, return its grant value as the upper bound for child page permissions
  - When the direct parent page is not found, traverse upward through ancestor paths to find the nearest existing page's grant
  - When no ancestor page is found at any level, return owner-only grant as a safe default
  - Include unit tests for: direct parent found, ancestor found at various depths, no ancestor found (safe default), root-level paths, paths with trailing slashes
  - _Requirements: 7.1, 7.2_

- [ ] 3. (P) Content analysis via GROWI AI (1st AI call)
  - Implement content analysis that delegates to GROWI AI for a single AI call performing both keyword extraction and flow/stock information type classification
  - Extract 1-5 keywords from the content, prioritizing proper nouns and technical terms over generic words
  - Classify the content as either flow information (time-bound: meeting notes, diaries, reports) or stock information (reference: documentation, knowledge base articles)
  - Reference the existing flow/stock classification guidance as a prompt reference, without treating it as the sole classification criterion
  - On analysis failure or inability to produce usable keywords, throw an error so the caller can handle fallback logic
  - Include unit tests for: successful keyword extraction with quality verification, correct flow/stock classification for representative content samples, edge cases (very short content, ambiguous content), and failure propagation
  - _Requirements: 5.1, 5.2, 5.4_

- [ ] 4. (P) Search candidate retrieval with score threshold filtering
  - Implement search candidate retrieval that searches for related pages using extracted keywords via the existing search service
  - Use extracted keywords (not raw content body) for search operations
  - Filter search results using an Elasticsearch score threshold to retain only sufficiently relevant candidates
  - Return an array of candidates with page path, snippet, and score for downstream AI evaluation
  - Return an empty array if no results pass the threshold, allowing the caller to omit search-based suggestions
  - The score threshold value is configurable and will be tuned with real data during implementation
  - Include unit tests for: multi-result retrieval, threshold filtering (candidates above/below/at threshold), empty result handling, and correct candidate structure
  - _Requirements: 3.1, 3.2, 3.5, 5.3_

- [ ] 5. (P) AI-based candidate evaluation and path proposal (2nd AI call)
  - Implement candidate evaluation that delegates to GROWI AI for a single AI call evaluating search candidates for content-destination fit
  - Evaluate each candidate's suitability by passing the content body, the content analysis results (keywords and informationType from the 1st AI call), and each candidate's path and search snippet
  - For each suitable candidate, propose a save location using one of three structural patterns relative to the matching page: (a) parent directory, (b) subdirectory under the matching page, (c) sibling directory alongside the matching page
  - When the sibling pattern is selected, generate an appropriate new directory name based on the content being saved; the generated path must be at the same hierarchy level as the matching search candidate page
  - Generate a description for each suggestion explaining why the location is suitable, considering content relevance and flow/stock alignment
  - Rank suggestions by content-destination fit, using flow/stock information type alignment as a ranking factor rather than a hard filter
  - Pass candidate paths and ES snippets to the AI context, not full page bodies, to manage AI context budget
  - On evaluation failure, throw an error so the caller can handle fallback logic
  - Include unit tests for: path pattern selection across all three patterns, sibling path generation at correct hierarchy level, AI-generated description quality, ranking order, flow/stock alignment consideration, and failure propagation
  - _Requirements: 3.3, 6.3, 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 12.4_

- [x] 6. (P) Category-based path suggestion (under review — prior implementation retained)
  - This component has an existing implementation from the prior Phase 2 design; it is retained as-is pending reviewer discussion on whether to keep, merge, or remove
  - Search for matching pages scoped to top-level directories using extracted keywords
  - Extract the top-level path segment from the most relevant result as the suggested category directory
  - Generate a description from the top-level segment name using mechanical text, not AI
  - Resolve the parent page's grant value via grant resolution
  - Return null when no matching top-level pages are found, so this suggestion type is omitted from the response
  - Include unit tests for: top-level segment extraction, description generation, grant resolution, and empty result handling
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 7. Phase 2 revised orchestration and integration
- [ ] 7.1 Rewrite orchestration for revised Phase 2 pipeline
  - Rewrite the orchestration function to implement the revised Phase 2 pipeline: always generate memo suggestion first as guaranteed fallback, then invoke content analysis (1st AI call), pass keywords to search candidate retrieval, pass candidates to candidate evaluation (2nd AI call), and run category generation in parallel with the search-evaluate pipeline
  - After candidate evaluation returns, resolve grant for each proposed path via grant resolver
  - Map the informationType from content analysis onto each search-type suggestion in the final response, and add informationType as an optional field on the suggestion type
  - Ensure the response includes both structured metadata (informationType, type, grant) and natural language context (description) for client LLM independence
  - Ensure all reasoning-intensive operations (keyword extraction, flow/stock classification, candidate evaluation, path proposal, description generation) are performed server-side
  - Handle graceful degradation at each failure point: content analysis failure skips the entire search pipeline (memo-only), candidate evaluation failure falls back to memo + category (if available), category failure is independent and does not affect the search pipeline
  - Ensure the response always contains at least one suggestion (memo type)
  - Update the route handler to use the revised orchestration function with injected dependencies
  - Include unit tests for: full pipeline success with all suggestion types, partial failures at each stage with correct degradation, informationType mapping to PathSuggestion, dependency injection, and parallel execution of category vs search-evaluate pipeline
  - _Requirements: 1.1, 1.2, 1.3, 3.3, 3.4, 5.3, 5.5, 8.3, 9.2, 11.4, 13.1, 13.2, 13.3_

- [ ] 7.2 Phase 2 integration verification
  - Verify the complete revised flow end-to-end: content body → content analysis (keywords + informationType) → search candidate retrieval (with score threshold) → candidate evaluation (path proposals + descriptions) → grant resolution → unified response with all suggestion types
  - Verify informationType field is present in search-based suggestions and absent in memo and category suggestions
  - Verify path proposal patterns work correctly: parent directory, subdirectory, and sibling with generated new paths at the correct hierarchy level
  - Verify graceful degradation at each failure point: content analysis failure → memo-only, search returns empty → search suggestions omitted, candidate evaluation failure → memo + category, category failure → memo + search, all Phase 2 failures → memo-only
  - Verify response structure across all suggestion types: correct fields, AI-generated descriptions for search type, fixed description for memo, mechanical description for category, valid grant values, and trailing slashes on all paths
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.4, 5.5, 6.1, 6.3, 10.1, 11.1, 11.4, 12.1, 13.1, 13.2_

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
