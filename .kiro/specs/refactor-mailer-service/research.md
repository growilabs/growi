# Research & Design Decisions

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale for MailService refactoring.
---

## Summary
- **Feature**: `refactor-mailer-service`
- **Discovery Scope**: Extension (Brownfield Refactoring)
- **Key Findings**:
  - Existing MailService is monolithic with ~408 lines containing all transport logic
  - Current implementation uses runtime falsy checks for OAuth2 credentials
  - @types/nodemailer@6.4.22 provides type definitions but allows `string | undefined` (too permissive)
  - GROWI already has NonBlankString type infrastructure in @growi/core
  - Existing test file (mail.spec.ts) uses Vitest with comprehensive mocking

## Research Log

### Current MailService Architecture

- **Context**: Understanding existing implementation before refactoring
- **Current Structure**:
  - Single file: `src/server/service/mail.ts` (~408 lines)
  - Three transport creation methods inline: `createSMTPClient()`, `createSESClient()`, `createOAuth2Client()`
  - Public API: constructor, `send()`, `initialize()`, S2sMessageHandlable interface implementation
  - Dependencies: nodemailer, ejs (templating), FailedEmail model
- **Findings**:
  - Transport creation logic is tightly coupled to MailService class
  - No clear separation of concerns between transmission methods
  - OAuth2 implementation uses falsy checks: `if (!clientId || !clientSecret || !refreshToken || !user)`
- **Implications**: Refactoring to separate modules will improve testability and maintainability without breaking external contracts

### Import Usage Analysis

- **Context**: Identifying all code that depends on MailService
- **Sources Consulted**: Codebase grep for import patterns
- **Findings**:
  - Direct imports found in:
    - `src/server/routes/apiv3/app-settings/index.ts` (config API)
    - `src/server/service/global-notification/index.ts` (notification system)
  - Import pattern: `import MailService from '~/server/service/mail'` (default export)
  - Test file: `src/server/service/mail.spec.ts` (Vitest-based, mocks FailedEmail)
- **Implications**: Barrel export at `mail/index.ts` must maintain default export compatibility

### TypeScript Type Safety for OAuth2

- **Context**: Investigating how to prevent empty string credentials at compile time
- **Sources Consulted**:
  - @types/nodemailer repository: https://github.com/DefinitelyTyped/DefinitelyTyped
  - XOAuth2.Options interface definition
  - @growi/core NonBlankString implementation
- **Findings**:
  - `@types/nodemailer` v6.4.22 exists (compatible with nodemailer v6.9.15)
  - XOAuth2.Options interface defines: `user?`, `clientId?`, `clientSecret?`, `refreshToken?` (all optional, type: `string | undefined`)
  - nodemailer runtime implementation uses falsy checks: `!this.options.refreshToken`
  - GROWI's `NonBlankString` is a branded type: `string & { readonly __brand: unique symbol }`
  - Helper functions available: `toNonBlankStringOrUndefined()`, `isNonBlankString()`
- **Implications**:
  - Install @types/nodemailer for basic type safety
  - Define `StrictOAuth2Options` with NonBlankString fields (stricter than library types)
  - Use type guards (`=== undefined`) instead of falsy checks for clarity

### Testing Infrastructure

- **Context**: Understanding current test setup for migration planning
- **Sources Consulted**: mail.spec.ts, Vitest documentation
- **Findings**:
  - Test framework: Vitest
  - Mocking approach: vi.mock() for FailedEmail model
  - Test structure: describe/it blocks with beforeEach setup
  - Mock pattern: Full Crowi object with configManager, s2sMessagingService, appService
  - Existing tests cover: exponentialBackoff, sendWithRetry, storeFailedEmail
- **Implications**: Each new transport module should follow same testing pattern with co-located spec files

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Factory Functions | Create transport factory functions in separate modules | Simple, functional, easy to test in isolation | MailService still coordinates initialization | Aligns with GROWI's functional programming style |
| Strategy Pattern | Transport classes implementing common interface | OOP-style extensibility | Heavier abstraction for simple use case | Overengineering for current needs |
| Inline Refactor | Extract methods to separate files, keep MailService structure | Minimal disruption | Less clear module boundaries | Doesn't fully address separation concerns |

**Selected**: Factory Functions - clearest separation of concerns without over-abstraction.

## Design Decisions

### Decision: Module Structure and Barrel Export Pattern

- **Context**: Need to reorganize files while maintaining backward compatibility
- **Alternatives Considered**:
  1. Named exports only - breaks existing imports
  2. Default export + named exports - provides gradual migration path
  3. Separate index.ts per module - over-complicated for single-class exports
- **Selected Approach**: Single `mail/index.ts` barrel file with default export
- **Rationale**: Maintains existing import pattern (`import MailService from '~/server/service/mail'`) while organizing internal structure
- **Trade-offs**: Internal modules use named exports (best practice), barrel file provides default export (compatibility)
- **Follow-up**: Verify all existing imports resolve correctly after refactoring

### Decision: Transport Factory Function Signature

- **Context**: Need consistent interface for all transport creation modules
- **Alternatives Considered**:
  1. `createClient(config: Config)` - requires Config type definition
  2. `create[Transport]Client(configManager: IConfigManagerForApp)` - passes full configManager
  3. Class-based transporters - OOP approach
- **Selected Approach**: `create[Transport]Client(configManager: IConfigManagerForApp): Transporter | null`
- **Rationale**:
  - ConfigManager already available in MailService context
  - Null return clearly signals initialization failure
  - Function naming follows GROWI conventions
- **Trade-offs**: Each module reads config keys directly (coupling to config structure)
- **Follow-up**: Document config key dependencies in each module's JSDoc

### Decision: StrictOAuth2Options Type Definition

- **Context**: Prevent empty string credentials at compile time
- **Alternatives Considered**:
  1. Use @types/nodemailer types as-is - too permissive (allows empty strings)
  2. Fork XOAuth2.Options with stricter types - maintenance burden
  3. Define custom type with NonBlankString - leverages existing GROWI infrastructure
- **Selected Approach**: Define `StrictOAuth2Options` extending nodemailer's structure with NonBlankString fields
- **Rationale**:
  - NonBlankString infrastructure already exists in @growi/core
  - Compile-time validation prevents runtime errors
  - Type is compatible with nodemailer's SMTPTransport.Options (structural typing)
- **Trade-offs**: Additional type definition maintenance, but minimal overhead
- **Follow-up**: Add inline documentation explaining why stricter than library default

## Risks & Mitigations

- **Risk**: Existing imports break after directory restructuring
  - **Mitigation**: Barrel export maintains `~/server/service/mail` import path; verify with integration tests
- **Risk**: Transport modules tightly coupled to ConfigManager structure
  - **Mitigation**: Document config key dependencies in JSDoc; consider config abstraction in future iteration
- **Risk**: StrictOAuth2Options type diverges from nodemailer updates
  - **Mitigation**: Pin @types/nodemailer version; test with nodemailer updates before upgrading
- **Risk**: Test suite execution time increases with more test files
  - **Mitigation**: Co-located tests allow focused execution; Vitest runs in parallel by default

## References

- [@types/nodemailer on npm](https://www.npmjs.com/package/@types/nodemailer) - TypeScript definitions for nodemailer
- [XOAuth2 Interface Definition](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/nodemailer/lib/xoauth2/index.d.ts) - OAuth2 credential types
- [GROWI NonBlankString Implementation](../../packages/core/src/interfaces/primitive/string.ts) - Branded type pattern
- [Nodemailer OAuth2 Documentation](https://nodemailer.com/smtp/oauth2) - Gmail API integration guide
