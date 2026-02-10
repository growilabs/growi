# Requirements Document

## Introduction

The suggest-path feature provides an AI-powered API endpoint for GROWI that suggests optimal page save locations. When an AI client (e.g., Claude via MCP) sends page content, the endpoint analyzes it and returns directory path suggestions with metadata including descriptions and grant (permission) constraints. This enables users to save content to well-organized locations without manually determining paths.

The feature is delivered incrementally in two phases:

- **Phase 1 (MVP)**: Personal memo path suggestion — establishes the endpoint, authentication, and response structure. Implemented first to provide immediate value.
- **Phase 2 (Full)**: Search-based and category-based path suggestions powered by GROWI AI keyword extraction. Builds on the Phase 1 foundation.

Both phases are covered by this specification. Implementation proceeds Phase 1 first, then Phase 2.

## Out of Scope

The following are explicitly **not** part of this feature:

- **Page creation/saving**: The actual save operation uses the existing `POST /_api/v3/page` endpoint. This feature only suggests *where* to save.
- **Page title determination**: Page naming is handled through dialogue between the AI client (e.g., Claude) and the user. GROWI does not suggest titles.

## Requirements

### Requirement 1: Path Suggestion API Endpoint

**Objective:** As an AI client (e.g., Claude via MCP), I want to request page path suggestions by sending content body, so that users can save content to appropriate locations without manually determining paths.

#### Acceptance Criteria

1. When the client sends a POST request with a `body` field containing page content, the Suggest Path Service shall return a response containing an array of path suggestions.
2. The Suggest Path Service shall include `type`, `path`, `label`, `description`, and `grant` fields in each suggestion.
3. The Suggest Path Service shall return `path` values as directory paths with a trailing slash (`/`).
4. The Suggest Path Service shall expose the endpoint under a namespace separate from `/_api/v3/page/` to support independent access control (e.g., GROWI.cloud paid-plan gating).

### Requirement 2: Memo Path Suggestion (Phase 1 MVP)

**Objective:** As a user, I want my personal memo area suggested as a save destination, so that I always have a guaranteed fallback location for saving content.

#### Acceptance Criteria

1. When the client sends a valid request, the Suggest Path Service shall include a suggestion with type `memo`.
2. The Suggest Path Service shall generate the memo path based on the authenticated user's identity (pattern: `/user/{username}/memo/`).
3. The Suggest Path Service shall set `grant` to `4` (owner only) for memo type suggestions.
4. The Suggest Path Service shall provide a fixed descriptive text in the `description` field for memo type suggestions.

### Requirement 3: Search-Based Path Suggestion (Phase 2)

**Objective:** As a user, I want save locations suggested near related existing pages, so that my content is organized alongside relevant material.

#### Acceptance Criteria

1. When keywords have been extracted from the content, the Suggest Path Service shall search for related existing pages using those keywords.
2. When related pages are found, the Suggest Path Service shall return the parent directory of the most relevant page as a suggestion with type `search`.
3. When related pages are found, the Suggest Path Service shall include related page titles in the `description` field as selection rationale.
4. The Suggest Path Service shall include the parent page's `grant` value for `search` type suggestions.
5. If no related pages are found, the Suggest Path Service shall omit the `search` type suggestion from the response.

### Requirement 4: Category-Based Path Suggestion (Phase 2)

**Objective:** As a user, I want a top-level category directory suggested, so that content can be organized under broad topic areas.

#### Acceptance Criteria

1. When keywords have been extracted from the content, the Suggest Path Service shall search for matching pages scoped to top-level directories.
2. When matching pages are found, the Suggest Path Service shall extract the top-level path segment and return it as a suggestion with type `category`.
3. The Suggest Path Service shall include the parent page's `grant` value for `category` type suggestions.
4. If no matching top-level pages are found, the Suggest Path Service shall omit the `category` type suggestion from the response.

### Requirement 5: Content Keyword Extraction (Phase 2)

**Objective:** As a system operator, I want keyword extraction centralized in GROWI AI, so that suggestion quality is consistent regardless of the calling client's capabilities.

#### Acceptance Criteria

1. When the client sends content body, the Suggest Path Service shall delegate keyword extraction to GROWI AI rather than requiring the client to pre-extract keywords.
2. The Suggest Path Service shall use extracted keywords (not raw content body) for search operations.
3. If keyword extraction fails or produces no usable keywords, the Suggest Path Service shall still return the memo suggestion (Phase 1 fallback).

### Requirement 6: Suggestion Description Generation

**Objective:** As a user, I want each suggestion to include a meaningful description, so that I can make an informed choice about where to save my content.

#### Acceptance Criteria

1. The Suggest Path Service shall include a `description` field in each suggestion that provides rationale for selecting that save location.
2. While in Phase 1, the Suggest Path Service shall use fixed descriptive text for `memo` type suggestions.
3. While in Phase 2, when returning `search` type suggestions, the Suggest Path Service shall generate the `description` by listing titles of related pages found under the suggested directory.
4. While in Phase 2, when returning `category` type suggestions, the Suggest Path Service shall generate the `description` from the top-level path segment name.
5. The Suggest Path Service shall generate Phase 2 descriptions mechanically from search results without using GROWI AI.

### Requirement 7: Grant Constraint Information

**Objective:** As an AI client, I want permission constraints for each suggested path, so that the appropriate grant level can be set when saving the page.

#### Acceptance Criteria

1. The Suggest Path Service shall include a `grant` field in each suggestion representing the parent page's grant value.
2. The `grant` field shall represent the upper bound of settable permissions for child pages created under the suggested path (not a recommendation, but a constraint).

### Requirement 8: Authentication and Authorization

**Objective:** As a system operator, I want the endpoint protected by authentication, so that only authorized users can request path suggestions.

#### Acceptance Criteria

1. The Suggest Path Service shall require a valid API token or active login session for all requests.
2. If the request lacks valid authentication, the Suggest Path Service shall return an authentication error.
3. The Suggest Path Service shall use the authenticated user's identity to generate user-specific suggestions.

### Requirement 9: Input Validation and Error Handling

**Objective:** As a system, I want invalid requests rejected with clear feedback, so that clients can correct their requests.

#### Acceptance Criteria

1. If the `body` field is missing or empty in the request, the Suggest Path Service shall return a validation error.
2. If an internal error occurs during path suggestion generation, the Suggest Path Service shall return an appropriate error response without exposing internal system details.
