# Requirements Document

## Introduction

The suggest-path feature provides an AI-powered API endpoint for GROWI that suggests optimal page save locations. When an AI client (e.g., Claude via MCP) sends page content, the endpoint analyzes it and returns directory path suggestions with metadata including descriptions and grant (permission) constraints.

The feature was delivered in two phases:

- **Phase 1 (MVP)**: Personal memo path suggestion — endpoint, authentication, and response structure.
- **Phase 2 (Full)**: AI-powered search-based path suggestions with flow/stock information classification, multi-candidate evaluation, and intelligent path proposal (including new paths).

### Phase 2 Revision History

Phase 2 was revised based on reviewer feedback: (1) flow/stock information classification, (2) multi-candidate AI evaluation instead of top-1 selection, (3) three-pattern path proposals (parent/subdirectory/sibling), (4) AI-generated descriptions.

## Out of Scope

- **Page creation/saving**: Uses existing `POST /_api/v3/page`. This feature only suggests *where* to save.
- **Page title determination**: Handled via AI client-user dialogue.

## Requirements

### Requirement 1: Path Suggestion API Endpoint

**Summary**: POST endpoint at `/_api/v3/ai-tools/suggest-path` accepts a `body` field and returns an array of path suggestions. Each suggestion includes `type`, `path` (directory with trailing `/`), `label`, `description`, and `grant`. Endpoint is under a separate namespace from `/_api/v3/page/` for independent access control.

### Requirement 2: Memo Path Suggestion (Phase 1)

**Summary**: Always includes a `memo` type suggestion as guaranteed fallback. Path is `/user/{username}/memo/` when user pages are enabled, or `/memo/{username}/` when disabled. Grant is `4` (owner only). Description is fixed text.

### Requirement 3: Search-Based Path Suggestion (Phase 2)

**Summary**: Searches for related pages using extracted keywords, filters by Elasticsearch score threshold, then passes all passing candidates to AI-based evaluation (Req 11). Includes parent page's grant. Omitted if no candidates pass the threshold.

### Requirement 4: Category-Based Path Suggestion (Phase 2) — Under Review

**Summary**: Extracts top-level path segment from keyword-matched pages as a `category` type suggestion. Includes parent grant. Omitted if no match found.

> **Note**: After reviewer discussion, the prior implementation was retained as-is. Potential overlap with the AI-based evaluation approach (Reqs 11, 12) was acknowledged; merging or removal deferred to a future iteration.

### Requirement 5: Content Analysis via GROWI AI (Phase 2)

**Summary**: Single AI call performs keyword extraction (1-5 keywords, proper nouns prioritized) and flow/stock information type classification. Keywords (not raw content) are used for search. On failure, falls back to memo-only response.

### Requirement 6: Suggestion Description Generation

**Summary**: Each suggestion includes a `description` field. Memo uses fixed text. Search-based suggestions use AI-generated descriptions from candidate evaluation (Req 11).

### Requirement 7: Grant Constraint Information

**Summary**: Each suggestion includes a `grant` field representing the parent page's grant value — the upper bound of settable permissions for child pages (a constraint, not a recommendation).

### Requirement 8: Authentication and Authorization

**Summary**: Requires valid API token or login session. Returns authentication error if missing. Uses authenticated user's identity for user-specific suggestions.

### Requirement 9: Input Validation and Error Handling

**Summary**: Returns validation error for missing/empty `body`. Internal errors return appropriate responses without exposing system details.

### Requirement 10: Flow/Stock Information Type Awareness (Phase 2)

**Summary**: Candidate evaluation considers flow/stock alignment between content and candidate locations. Flow = time-bound (date-based paths, meeting terms). Stock = reference (topic-based paths). Used as a ranking factor, not a hard filter.

### Requirement 11: AI-Based Candidate Evaluation and Ranking (Phase 2)

**Summary**: GROWI AI evaluates each candidate's suitability using content body, candidate path, and snippet. Ranks by content-destination fit considering relevance and flow/stock alignment. Generates description per suggestion. Falls back to memo-only on failure.

### Requirement 12: Path Proposal Patterns (Phase 2)

**Summary**: Three structural patterns relative to each matching page: (a) parent directory, (b) subdirectory, (c) sibling directory. Sibling pattern generates new directory names at the same hierarchy level as the candidate. AI determines the most appropriate pattern.

### Requirement 13: Client LLM Independence (Phase 2)

**Summary**: Response includes both structured metadata (`informationType`, `type`, `grant`) and natural language (`description`) so any LLM client can use it regardless of reasoning capability. All reasoning-intensive operations are server-side.

**Design Rationale**: MCP clients are powered by varying LLM models. Heavy reasoning is centralized in GROWI AI to prevent quality degradation with less capable clients.
