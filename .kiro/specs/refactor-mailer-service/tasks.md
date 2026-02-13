# Implementation Tasks

## Overview

This refactoring follows a three-phase approach: establishing type safety foundations, extracting transport modules, and integrating them into the refactored MailService. The tasks ensure type-safe implementations from the beginning while maintaining backward compatibility throughout.

---

## Phase 1: Type Safety Foundation

- [x] 1. Establish type infrastructure for mail module
- [x] 1.1 Install nodemailer type definitions
  - Add @types/nodemailer@6.4.22 as devDependency in package.json
  - Run `pnpm install` to install the package
  - Verify package appears in devDependencies
  - _Requirements: 3.1_

- [x] 1.2 Create shared type definitions module
  - Create src/server/service/mail/ directory
  - Define StrictOAuth2Options type with NonBlankString credential fields (user, clientId, clientSecret, refreshToken)
  - Define MailConfig, EmailConfig, SendResult types
  - Add JSDoc comments explaining why StrictOAuth2Options is stricter than nodemailer defaults
  - Include type assertion verifying StrictOAuth2Options compatibility with SMTPTransport.Options
  - _Requirements: 3.2, 3.3, 3.9_

- [x] 1.3 Verify type safety infrastructure
  - Run `pnpm run lint:typecheck` to verify type compilation
  - Confirm no new type errors introduced
  - Run `pnpm run test` to verify existing tests still pass
  - Verify existing mail.ts file remains unchanged and functional
  - _Requirements: 3.11_

---

## Phase 2: Module Extraction

- [x] 2. Extract transport modules with type-safe implementations
- [x] 2.1 (P) Extract SMTP transport module
  - Create smtp.ts with createSMTPClient factory function
  - Accept configManager parameter and optional SMTPTransport.Options
  - Read mail:smtpHost, mail:smtpPort, mail:smtpUser, mail:smtpPassword from config
  - Return null if host or port missing, log warning for incomplete credentials
  - Configure TLS settings (rejectUnauthorized: false for self-signed certificates)
  - Create smtp.spec.ts with tests verifying null return for missing host/port and successful transport creation
  - Use named exports following GROWI conventions
  - _Requirements: 2.1, 2.5, 2.6, 2.7, 5.2, 5.6_

- [x] 2.2 (P) Extract SES transport module
  - Create ses.ts with createSESClient factory function
  - Accept configManager parameter and optional SES configuration object
  - Read mail:sesAccessKeyId, mail:sesSecretAccessKey from config
  - Return null if access key or secret key missing, log warning for incomplete credentials
  - Use nodemailer-ses-transport adapter for AWS SES integration
  - Create ses.spec.ts with tests verifying null return for missing AWS credentials and successful transport creation
  - Use named exports following GROWI conventions
  - _Requirements: 2.2, 2.5, 2.6, 2.7, 5.3, 5.6_

- [x] 2.3 (P) Extract OAuth2 transport module with type-safe credentials
  - Create oauth2.ts with createOAuth2Client factory function
  - Accept configManager parameter and optional SMTPTransport.Options
  - Read mail:oauth2User, mail:oauth2ClientId, mail:oauth2ClientSecret, mail:oauth2RefreshToken from config
  - Use toNonBlankStringOrUndefined() helper from @growi/core to convert config values
  - Implement type guards checking credential === undefined (not falsy checks)
  - Return null if any credential is undefined after conversion, log warning for incomplete credentials
  - Construct StrictOAuth2Options object when all credentials are valid NonBlankStrings
  - Configure service as 'gmail' with OAuth2 auth type
  - Create oauth2.spec.ts with tests verifying:
    - Null return for incomplete/blank credentials
    - Successful transport creation with NonBlankString credentials
    - Type guard behavior (=== undefined)
    - Empty strings rejected at type level (type-level test)
  - Use named exports, no any types for credentials or transport options
  - _Requirements: 2.3, 2.5, 2.6, 2.7, 3.4, 3.5, 3.6, 3.7, 3.8, 3.10, 3.12, 5.4, 5.6, 5.7_

---

## Phase 3: Integration & Barrel Export

- [x] 3. Integrate transport modules and establish barrel export
- [x] 3.1 Refactor MailService to delegate transport creation
  - Import createSMTPClient, createSESClient, createOAuth2Client from respective modules
  - Update initialize() method to delegate transport creation based on mail:transmissionMethod config
  - Remove inline createSMTPClient(), createSESClient(), createOAuth2Client() method implementations
  - Preserve all existing public methods: send(), initialize(), publishUpdatedMessage()
  - Maintain S2sMessageHandlable interface implementation unchanged
  - Preserve retry logic, error handling (sendWithRetry, storeFailedEmail), and credential masking (maskCredential)
  - Keep existing public properties: isMailerSetup, mailer, mailConfig, lastLoadedAt
  - Verify MailService behavior identical to pre-refactoring implementation
  - _Requirements: 2.4, 4.1, 4.2, 4.3, 4.4, 4.6_

- [x] 3.2 Reorganize files into mail/ directory structure
  - Move src/server/service/mail.ts to src/server/service/mail/mail.ts
  - Move src/server/service/mail.spec.ts to src/server/service/mail/mail.spec.ts
  - Update import paths in mail.spec.ts to reference local modules (./mail, ./smtp, ./ses, ./oauth2, ./types)
  - Update import paths in mail.ts to reference transport modules
  - Verify all imports resolve correctly after file moves
  - _Requirements: 1.1, 1.2, 5.1_

- [x] 3.3 Create barrel export for backward compatibility
  - Create src/server/service/mail/index.ts
  - Export MailService as default export (maintains existing import pattern)
  - Export MailConfig, EmailConfig, SendResult, StrictOAuth2Options as named exports
  - Add JSDoc comment explaining barrel export maintains backward compatibility
  - Verify import path ~/server/service/mail resolves to barrel export
  - _Requirements: 1.3, 1.4, 1.5_

- [x] 3.4 Verify backward compatibility and test coverage
  - Run full test suite with `pnpm run test`
  - Verify all existing MailService tests pass without modification
  - Confirm Config API (src/server/routes/apiv3/app-settings/index.ts) imports MailService successfully
  - Confirm Global Notification Service (src/server/service/global-notification/index.ts) imports MailService successfully
  - Run `pnpm run lint:typecheck` to verify no type errors
  - Run `pnpm run lint:biome` to verify code style compliance
  - Test email sending in development environment (SMTP, SES, OAuth2 if credentials available)
  - Verify isMailerSetup, mailer, mailConfig properties accessible from external code
  - _Requirements: 4.4, 4.5, 5.5_

---

## Requirements Coverage

| Requirement | Tasks |
|-------------|-------|
| 1.1 | 3.2 |
| 1.2 | 3.2 |
| 1.3 | 3.3 |
| 1.4 | 3.3 |
| 1.5 | 3.3 |
| 2.1 | 2.1 |
| 2.2 | 2.2 |
| 2.3 | 2.3 |
| 2.4 | 3.1 |
| 2.5 | 2.1, 2.2, 2.3 |
| 2.6 | 2.1, 2.2, 2.3 |
| 2.7 | 2.1, 2.2, 2.3 |
| 3.1 | 1.1 |
| 3.2 | 1.2 |
| 3.3 | 1.2 |
| 3.4 | 2.3 |
| 3.5 | 2.3 |
| 3.6 | 2.3 |
| 3.7 | 2.3 |
| 3.8 | 2.3 |
| 3.9 | 1.2 |
| 3.10 | 2.3 |
| 3.11 | 1.3 |
| 3.12 | 2.3 |
| 4.1 | 3.1 |
| 4.2 | 3.1 |
| 4.3 | 3.1 |
| 4.4 | 3.1, 3.4 |
| 4.5 | 3.4 |
| 4.6 | 3.1 |
| 5.1 | 3.2 |
| 5.2 | 2.1 |
| 5.3 | 2.2 |
| 5.4 | 2.3 |
| 5.5 | 3.4 |
| 5.6 | 2.1, 2.2, 2.3 |
| 5.7 | 2.3 |

---

## Execution Notes

### Parallel Execution
Tasks marked with **(P)** can be executed in parallel:
- **Phase 2 (2.1, 2.2, 2.3)**: All three transport module extractions operate on separate files with no shared dependencies

### Checkpoints
After each phase, verify:
- **Phase 1**: Type definitions compile, existing tests pass, no behavior changes
- **Phase 2**: All transport modules have passing tests, can be imported independently
- **Phase 3**: Full integration tests pass, backward compatibility confirmed

### Testing Strategy
- **Phase 1**: Run existing test suite (no new tests needed)
- **Phase 2**: Create co-located tests for each transport module (smtp.spec.ts, ses.spec.ts, oauth2.spec.ts)
- **Phase 3**: Verify existing MailService tests pass, test external integration points

### Rollback Plan
If issues arise:
1. **After Phase 1**: Remove types.ts and @types/nodemailer dependency
2. **After Phase 2**: Delete transport modules and their tests
3. **After Phase 3**: Revert file moves using git, restore original mail.ts structure
