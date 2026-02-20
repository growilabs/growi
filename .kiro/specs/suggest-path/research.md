# Research & Design Decisions

## Summary

- **Feature**: `suggest-path`
- **Discovery Scope**: Extension (new endpoint added to existing API infrastructure)
- **Key Findings**:
  - GROWI uses a handler factory pattern (`(crowi: Crowi) => RequestHandler[]`) for API routes
  - The `ai-tools` namespace does not exist yet; closest is `/openai` under `features/openai/`
  - Grant parent-child constraints are enforced by `page-grant.ts` — GRANT_OWNER children must share the same owner
  - `searchService.searchKeyword()` accepts keyword string and returns scored results with page metadata
  - User home path utilities exist in `@growi/core` (`userHomepagePath`, `isUsersHomepage`)

## Research Log

### GROWI API Route Patterns

- **Context**: Need to understand how to add a new route namespace
- **Sources Consulted**: `apps/app/src/server/routes/apiv3/index.js`, `page/create-page.ts`, `features/openai/server/routes/index.ts`
- **Findings**:
  - Three router types: standard, admin, auth. New endpoints go on standard router
  - Route registration: `router.use('/namespace', require('./namespace')(crowi))` or factory import
  - Handler factory pattern: exports `(crowi: Crowi) => RequestHandler[]` returning middleware chain
  - Middleware ordering: `accessTokenParser` → `loginRequiredStrictly` → validators → `apiV3FormValidator` → handler
  - Response helpers: `res.apiv3(data)` for success, `res.apiv3Err(error, status)` for errors
  - Feature-based routes use dynamic import pattern (see openai routes)
- **Implications**: suggest-path follows the handler factory pattern. New `ai-tools` directory under `routes/apiv3/`

### OpenAI Feature Structure

- **Context**: Understanding existing AI feature patterns for alignment
- **Sources Consulted**: `features/openai/server/routes/index.ts`, `middlewares/certify-ai-service.ts`
- **Findings**:
  - AI routes gate on `aiEnabled` config via `certifyAiService` middleware
  - Dynamic imports used for route handlers
  - Dedicated middleware directory for AI-specific checks
  - Routes organized under `features/openai/` not `routes/apiv3/`
- **Implications**: suggest-path should gate on AI-enabled config. However, since `ai-tools` is a separate namespace from `openai`, it lives under `routes/apiv3/ai-tools/` rather than `features/openai/`. The AI gating middleware can be reused or replicated.

### Grant System Constraints

- **Context**: Need to return accurate grant constraints for suggested paths
- **Sources Consulted**: `@growi/core` PageGrant enum, `apps/app/src/server/service/page-grant.ts`
- **Findings**:
  - PageGrant values: PUBLIC(1), RESTRICTED(2), SPECIFIED(3-deprecated), OWNER(4), USER_GROUP(5)
  - Parent constrains child: OWNER parent → child must be OWNER by same user; USER_GROUP parent → child cannot be PUBLIC
  - `calcApplicableGrantData(page, user)` returns allowed grant types for a page
  - For memo path (`/user/{username}/memo/`), the user homepage `/user/{username}` is GRANT_OWNER(4) by default → memo path grant is fixed at 4
- **Implications**: Phase 1 memo grant is trivially 4. Phase 2 needs to look up actual parent page grant via Page model

### Search Service Integration

- **Context**: Phase 2 requires keyword-based search for related pages
- **Sources Consulted**: `apps/app/src/server/service/search.ts`
- **Findings**:
  - `searchKeyword(keyword, nqName, user, userGroups, searchOpts)` → `[ISearchResult, delegatorName]`
  - Results include `_id`, `_score`, `_source`, `_highlight`
  - Supports `prefix:` queries for path-scoped search
  - User groups needed for permission-scoped search results
- **Implications**: Phase 2 uses `searchKeyword` with extracted keywords. Category search uses `prefix:/` to scope to top-level. Need `getUserRelatedGroups()` for permission-correct results.

### User Home Path Utilities

- **Context**: Memo path generation needs user home path
- **Sources Consulted**: `@growi/core` `page-path-utils/index.ts`
- **Findings**:
  - `userHomepagePath(user)` → `/user/{username}`
  - `isUsersHomepage(path)` → boolean check
  - `getUsernameByPath(path)` → extract username from path
- **Implications**: Use `userHomepagePath(req.user)` + `/memo/` for memo suggestion path

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Route under `routes/apiv3/ai-tools/` | New namespace in standard routes | Clean separation, follows `ai-tools` naming decision from review | New directory, needs registration in index.js | Aligns with independent access control needs |
| Route under `features/openai/` | Extend existing AI feature module | Reuses AI infrastructure, minimal setup | Provider-specific name, harder to separate for independent access control | Rejected in review — namespace should be provider-agnostic |
| Route under `routes/apiv3/page/` | Add to existing page routes | Close to page creation | Cannot gate independently for access control | Rejected in review — yuki requested separation |

## Design Decisions

### Decision: Route Namespace Placement

- **Context**: Endpoint needs independent access control
- **Alternatives Considered**:
  1. `/openai/suggest-path` — groups with AI features but provider-specific
  2. `/page/suggest-path` — close to page creation but cannot gate independently
  3. `/ai-tools/suggest-path` — new provider-agnostic namespace
- **Selected Approach**: `/_api/v3/ai-tools/suggest-path` under `routes/apiv3/ai-tools/`
- **Rationale**: Matches existing unmerged PR naming, provider-agnostic, enables independent access control
- **Trade-offs**: Requires new directory and route registration. Namespace is tentative (pending yuki confirmation)
- **Follow-up**: Confirm `ai-tools` namespace with yuki

### Decision: Phase 1 Handler Simplicity

- **Context**: Phase 1 (MVP) only returns memo path — very simple logic
- **Alternatives Considered**:
  1. Full service layer from the start (SuggestionService class)
  2. Inline logic in handler, extract to service when Phase 2 arrives
- **Selected Approach**: Inline logic in handler for Phase 1, extract to service for Phase 2
- **Rationale**: Avoid over-engineering. Phase 1 is ~10 lines of logic. Service abstraction added when needed
- **Trade-offs**: Phase 2 will require refactoring handler → service extraction
- **Follow-up**: Define service interface in design for Phase 2 readiness

### Decision: GROWI AI Keyword Extraction Approach

- **Context**: Phase 2 needs keyword extraction from content body
- **Alternatives Considered**:
  1. New dedicated keyword extraction service
  2. Extend existing OpenAI feature module
  3. Client-side keyword extraction (fallback option)
- **Selected Approach**: Leverage existing `features/openai/` infrastructure for keyword extraction
- **Rationale**: GROWI already has OpenAI integration. Keyword extraction is a new capability within the existing AI feature
- **Trade-offs**: Couples suggest-path to OpenAI feature availability. Mitigated by fallback to memo-only response
- **Follow-up**: Detailed keyword extraction implementation is out of scope for this spec (separate design)

## Risks & Mitigations

- **Namespace not finalized**: `ai-tools` is tentative. Mitigation: design for easy namespace change (single line in route registration)
- **Large content body performance**: Sending full content for AI keyword extraction may be slow. Mitigation: Phase 1 does not require AI; Phase 2 has fallback to memo-only if extraction fails
- **Search service dependency**: Phase 2 depends on Elasticsearch being available. Mitigation: graceful degradation — return memo suggestion if search fails
- **GROWI AI implementation details unknown**: Keyword extraction specifics are out of scope. Mitigation: define clean interface boundary; implementation details handled separately

## References

- [GROWI Search Internals](https://dev.growi.org/69842ea0cb3a20a69b0a1985) — Search feature internal architecture
- `apps/app/src/server/routes/apiv3/index.js` — Route registration entry point
- `apps/app/src/server/routes/apiv3/page/create-page.ts` — Reference handler pattern
- `apps/app/src/features/openai/server/routes/index.ts` — AI feature route pattern
- `packages/core/src/interfaces/page.ts` — PageGrant enum definition
- `apps/app/src/server/service/page-grant.ts` — Grant validation logic
- `apps/app/src/server/service/search.ts` — Search service interface
- `packages/core/src/utils/page-path-utils/index.ts` — User path utilities
