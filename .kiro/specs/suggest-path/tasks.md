# Implementation Plan

## Phase 1 (MVP)

- [ ] 1. Phase 1 MVP — Shared types and memo path suggestion
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

- [ ] 1.3 Phase 1 integration verification
  - Verify the complete request-response cycle for the memo suggestion endpoint with valid authentication
  - Verify authentication enforcement: unauthenticated requests receive appropriate error responses
  - Verify input validation: requests with missing or empty body field receive validation errors
  - Verify AI service gating: requests when AI is disabled receive appropriate error responses
  - Verify response structure: correct fields, trailing slash on path, correct grant value
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 8.1, 8.2, 9.1, 9.2_

## Phase 2

- [ ] 2. (P) Implement parent page grant resolution
  - Implement a function that accepts a directory path and returns the corresponding page's grant value as the upper bound for child page permissions
  - When the parent page exists, return its grant value; when not found, return owner-only grant as a safe default
  - Update memo suggestion generation for the user-pages-disabled case to use actual parent grant resolution instead of the Phase 1 hardcoded value
  - Include unit tests for grant lookup with existing page, missing page, and various grant values
  - _Requirements: 7.1, 7.2, 2.4_

- [ ] 3. (P) Implement content keyword extraction via GROWI AI
  - Implement a function that accepts content body and delegates keyword extraction to the existing AI feature module
  - Return 3-5 keywords prioritizing proper nouns and technical terms, avoiding generic words
  - On extraction failure, throw an error so the caller can handle fallback logic
  - Include unit tests for successful extraction, empty results, and failure scenarios
  - _Requirements: 5.1, 5.2_

- [ ] 4. Search and category suggestion generators
- [ ] 4.1 (P) Implement search-based path suggestion
  - Implement a function that accepts extracted keywords and searches for related existing pages using the search service
  - Select the most relevant result and extract its parent directory as the suggested save location
  - Generate a description by listing titles of up to 3 top-scoring related pages found under the suggested directory — purely mechanical, no AI
  - Resolve the parent page's grant value using the grant resolver
  - Return null when no search results are found, so this suggestion type is omitted from the response
  - Include unit tests for result selection, parent directory extraction, description generation, grant resolution, and empty-result handling
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.2, 6.3, 6.5_

- [ ] 4.2 (P) Implement category-based path suggestion
  - Implement a function that accepts extracted keywords and searches for matching pages scoped to top-level directories
  - Extract the top-level path segment from the most relevant result as the suggested category directory
  - Generate a description from the top-level segment name — purely mechanical, no AI
  - Resolve the parent page's grant value using the grant resolver
  - Return null when no matching top-level pages are found, so this suggestion type is omitted from the response
  - Include unit tests for top-level segment extraction, description generation, grant resolution, and empty-result handling
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.2, 6.4, 6.5_

- [ ] 5. Phase 2 orchestration and integration
- [ ] 5.1 Wire suggestion generators into unified orchestration with graceful degradation
  - Implement the orchestration function that invokes all suggestion generators: memo (always), then keyword extraction followed by search and category generators in parallel
  - On keyword extraction or search service failure, fall back to memo-only response while logging the error
  - Collect non-null suggestions into the response array, ensuring memo is always present
  - Update the route handler to use the orchestration function with injected dependencies
  - Include unit tests for successful multi-suggestion response, partial failures with graceful degradation, and complete Phase 2 failure falling back to memo only
  - _Requirements: 5.3, 6.1, 9.2_

- [ ] 5.2 Phase 2 integration verification
  - Verify the complete flow: content body to keyword extraction to parallel search and category suggestions to unified response with all suggestion types
  - Verify graceful degradation: when search returns no results, those suggestion types are omitted; when keyword extraction fails, memo-only response is returned
  - Verify response structure across all suggestion types: correct fields, descriptions, grant values, and trailing slashes
  - _Requirements: 3.1, 3.5, 4.4, 5.3, 6.3, 6.4_

## Requirements Coverage

| Requirement | Task(s) |
|-------------|---------|
| 1.1 | 1.2, 1.3 |
| 1.2 | 1.1 |
| 1.3 | 1.1, 1.3 |
| 1.4 | 1.2, 1.3 |
| 2.1 | 1.1, 1.3 |
| 2.2 | 1.1 |
| 2.3 | 1.1 |
| 2.4 | 1.1 |
| 2.5 | 1.1 |
| 3.1 | 4.1, 5.2 |
| 3.2 | 4.1 |
| 3.3 | 4.1 |
| 3.4 | 4.1 |
| 3.5 | 4.1, 5.2 |
| 4.1 | 4.2 |
| 4.2 | 4.2 |
| 4.3 | 4.2 |
| 4.4 | 4.2, 5.2 |
| 5.1 | 3 |
| 5.2 | 3, 4.1, 4.2 |
| 5.3 | 5.1, 5.2 |
| 6.1 | 1.1, 5.1 |
| 6.2 | 1.1 |
| 6.3 | 4.1, 5.2 |
| 6.4 | 4.2, 5.2 |
| 6.5 | 4.1, 4.2 |
| 7.1 | 2 |
| 7.2 | 2 |
| 8.1 | 1.2, 1.3 |
| 8.2 | 1.2, 1.3 |
| 8.3 | 1.2 |
| 9.1 | 1.2, 1.3 |
| 9.2 | 1.2, 5.1 |
