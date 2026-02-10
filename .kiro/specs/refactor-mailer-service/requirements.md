# Requirements Document

## Project Description (Input)

### Core Objectives

1. **Directory Reorganization**
   - Move `mail.ts` and `mail.spec.ts` into a `mail/` directory
   - Create `mail/index.ts` as a barrel file, exporting only public API

2. **Module Separation by Feature**
   - Split MailService into separate modules: `smtp`, `ses`, `oauth2`
   - Each transmission method should be in its own module for better maintainability

3. **Type Safety Improvements**
   - Replace runtime falsy checks (`!clientId || !clientSecret || !refreshToken || !user`) with TypeScript type guards
   - Use @growi/core's `NonBlankString` type for OAuth2 credentials
   - Install `@types/nodemailer` for proper type definitions
   - Define stricter types than nodemailer provides (e.g., `StrictOAuth2Options`)
   - Prevent empty strings at compile time rather than runtime

### Guiding Principles
- Incremental improvement: perfection is not required in this iteration
- Maintain backward compatibility with existing MailService API
- Follow GROWI's coding standards (immutability, named exports, co-located tests)

## Requirements

### Introduction

This refactoring effort modernizes the MailService implementation to improve code organization, maintainability, and type safety. The refactoring focuses on three key areas: restructuring the file organization to follow GROWI's feature-based architecture, separating transmission methods (SMTP, SES, OAuth2) into distinct modules, and leveraging TypeScript's type system to prevent runtime errors related to empty credentials. The refactoring maintains full backward compatibility with the existing MailService API to ensure zero disruption to dependent code.

---

### Requirement 1: Directory Restructuring

**Objective:** As a developer, I want the mail-related files organized in a dedicated `mail/` directory with a barrel export pattern, so that the codebase follows GROWI's feature-based structure and provides clear module boundaries.

#### Acceptance Criteria

1. The MailService implementation shall be located at `src/server/service/mail/mail.ts`
2. The MailService test file shall be located at `src/server/service/mail/mail.spec.ts`
3. The mail module shall provide a barrel file at `src/server/service/mail/index.ts` that exports the public API (MailService class)
4. When external code imports MailService, it shall import from `~/server/service/mail` without referencing internal module structure
5. The legacy import path `~/server/service/mail` shall continue to work after refactoring (via barrel export)

---

### Requirement 2: Module Separation by Transmission Method

**Objective:** As a developer, I want each email transmission method (SMTP, SES, OAuth2) in separate modules, so that code is easier to maintain, test, and extend independently.

#### Acceptance Criteria

1. The mail module shall provide a separate module for SMTP transport at `src/server/service/mail/smtp.ts`
2. The mail module shall provide a separate module for SES transport at `src/server/service/mail/ses.ts`
3. The mail module shall provide a separate module for OAuth2 transport at `src/server/service/mail/oauth2.ts`
4. When MailService initializes, it shall delegate transport creation to the appropriate module based on `mail:transmissionMethod` config value
5. Each transport module shall export a function with signature `create[Transport]Client(configManager: IConfigManagerForApp): Transporter | null`
6. When a transport module receives incomplete credentials, it shall return `null` and log a warning
7. The mail module structure shall follow GROWI's immutability and named export conventions

---

### Requirement 3: Type-Safe OAuth2 Implementation

**Objective:** As a developer, I want OAuth2 credentials validated at compile time using TypeScript's type system, so that empty string credentials are prevented before runtime and credential-related errors are caught during development.

#### Acceptance Criteria

**Type Infrastructure** (3.1-3.3):
1. The project shall include `@types/nodemailer` as a development dependency for nodemailer type definitions
2. The OAuth2 module shall define a `StrictOAuth2Options` type that requires `NonBlankString` for all credential fields (`user`, `clientId`, `clientSecret`, `refreshToken`)
3. The `StrictOAuth2Options` type shall be compatible with nodemailer's `SMTPTransport.Options` interface

**Runtime Validation** (3.4-3.6):
4. When the OAuth2 module retrieves credentials from config, it shall use `toNonBlankStringOrUndefined()` helper from `@growi/core`
5. If any OAuth2 credential is `undefined` after conversion, the OAuth2 module shall return `null` without creating a transport
6. The OAuth2 module shall use type guards (`credential === undefined`) instead of falsy checks (`!credential`)
7. When all OAuth2 credentials are valid NonBlankStrings, the module shall construct a `StrictOAuth2Options` object

**Compile-Time Safety** (3.7-3.11):
8. When an empty string is assigned to an OAuth2 credential field, TypeScript shall produce a compile-time type error
9. The `StrictOAuth2Options` type shall not accept `string | undefined` for credential fields
10. When `toNonBlankStringOrUndefined()` is used, the return type shall be `NonBlankString | undefined`
11. If TypeScript strict mode is enabled, all transport modules shall compile without type errors
12. The OAuth2 module shall not use `any` type for credentials or transport options

---

### Requirement 4: Backward Compatibility

**Objective:** As a system integrator, I want the refactored MailService to maintain the same public API as the current implementation, so that dependent code continues to work without modification.

#### Acceptance Criteria

1. The MailService class shall maintain its current constructor signature: `constructor(crowi: Crowi)`
2. The MailService shall continue to implement the `S2sMessageHandlable` interface without changes
3. When external code calls `mailService.send(config)`, it shall work identically to the pre-refactoring implementation
4. The MailService shall expose the same public properties: `isMailerSetup`, `mailer`, `mailConfig`
5. When MailService is imported from `~/server/service/mail`, it shall resolve to the refactored implementation seamlessly
6. The refactored implementation shall not change the behavior of retry logic, error handling, or failed email storage

---

### Requirement 5: Co-located Testing

**Objective:** As a developer, I want test files co-located with their source modules, so that tests are easy to find and maintain alongside the code they verify.

#### Acceptance Criteria

1. The main MailService test shall be located at `src/server/service/mail/mail.spec.ts`
2. The SMTP transport module shall have a co-located test at `src/server/service/mail/smtp.spec.ts`
3. The SES transport module shall have a co-located test at `src/server/service/mail/ses.spec.ts`
4. The OAuth2 transport module shall have a co-located test at `src/server/service/mail/oauth2.spec.ts`
5. When tests are executed, all mail-related tests shall be discovered and run by the test runner
6. Each transport module test shall verify `null` return behavior for incomplete credentials
7. The OAuth2 module test shall verify that empty strings are rejected at the type level

---

### Non-Functional Requirements

#### Code Quality

1. All refactored code shall follow GROWI's coding standards defined in `.claude/rules/coding-style.md`
2. All modules shall use named exports (no default exports except for Next.js pages)
3. All functions shall use immutable patterns (no object mutation)
4. All new code shall include TypeScript type annotations for parameters and return values

#### Documentation

1. Each transport module shall include JSDoc comments for exported functions
2. The `StrictOAuth2Options` type shall include inline documentation explaining why it's stricter than nodemailer's default types

#### Testing

1. All transport modules shall maintain or improve current test coverage
2. Tests shall verify both happy path and error scenarios (incomplete credentials, invalid configs)
3. Type guard behavior shall be verified with unit tests


