# Technical Design: MailService Refactoring

## Overview

This refactoring modernizes the MailService implementation to improve code organization, maintainability, and type safety through modular architecture and compile-time validation.

**Purpose**: This feature delivers improved code maintainability and compile-time type safety to developers working with email functionality. The refactoring separates transmission methods (SMTP, SES, OAuth2) into independent modules and leverages TypeScript's type system to prevent credential-related runtime errors.

**Users**: Developers maintaining or extending GROWI's email functionality will utilize this for easier testing, debugging, and feature additions.

**Impact**: Changes the current monolithic MailService implementation (~408 lines) by restructuring into a modular architecture with separate transport modules, while maintaining full backward compatibility with existing code.

### Goals

- Organize mail-related files into feature-based directory structure (`mail/`)
- Separate email transmission methods (SMTP, SES, OAuth2) into independent, testable modules
- Replace runtime falsy checks with TypeScript type guards for OAuth2 credentials
- Maintain 100% backward compatibility with existing MailService public API
- Improve type safety using @growi/core's NonBlankString branded types

### Non-Goals

- Changing MailService public API or behavior (beyond internal organization)
- Adding new transmission methods or email features
- Modifying retry logic, error handling, or failed email storage mechanisms
- Migrating away from nodemailer library
- Implementing OAuth2 token refresh logic improvements (deferred to future iteration)

## Architecture

### Existing Architecture Analysis

**Current Implementation**:
- Single file: `src/server/service/mail.ts` (~408 lines)
- MailService class with three inline transport creation methods:
  - `createSMTPClient()` - SMTP transport with username/password auth
  - `createSESClient()` - AWS SES transport with IAM credentials
  - `createOAuth2Client()` - Gmail OAuth2 transport with refresh tokens
- Implements `S2sMessageHandlable` interface for cross-service configuration synchronization
- Uses runtime falsy checks for credential validation: `!clientId || !clientSecret || !refreshToken || !user`
- Single test file: `src/server/service/mail.spec.ts`

**Current Constraints**:
- Must maintain `S2sMessageHandlable` interface implementation
- Must preserve `constructor(crowi: Crowi)` signature
- Must continue to work with existing config keys (`mail:transmissionMethod`, `mail:oauth2ClientId`, etc.)
- Import path `~/server/service/mail` must remain valid

**Integration Points**:
- Config API (`src/server/routes/apiv3/app-settings/index.ts`) - reads/updates mail settings
- Global Notification Service (`src/server/service/global-notification/index.ts`) - sends notification emails
- Crowi initialization - instantiates MailService during server startup

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph "External Dependencies"
        Config[ConfigManager]
        NM[nodemailer]
        Core[@growi/core]
    end

    subgraph "mail/ Module"
        MS[MailService]
        SMTP[smtp.ts]
        SES[ses.ts]
        OAuth2[oauth2.ts]
        Types[types.ts]
        Index[index.ts]
    end

    subgraph "Consumers"
        API[Config API]
        Notif[Global Notification]
    end

    Config --> MS
    MS --> SMTP
    MS --> SES
    MS --> OAuth2
    SMTP --> NM
    SES --> NM
    OAuth2 --> NM
    OAuth2 --> Core
    Index --> MS
    API --> Index
    Notif --> Index
```

**Architecture Integration**:
- **Selected pattern**: Factory Functions - each transport module exports a pure function that creates transport instances
- **Domain boundaries**:
  - `MailService` - Orchestration layer, S2S messaging, initialization coordination
  - `smtp.ts`, `ses.ts`, `oauth2.ts` - Transport-specific credential handling and client creation
  - `types.ts` - Shared type definitions (MailConfig, EmailConfig, SendResult, StrictOAuth2Options)
- **Existing patterns preserved**:
  - Service-based architecture (MailService as singleton in Crowi context)
  - ConfigManager-based configuration retrieval
  - S2sMessageHandlable interface for distributed systems
  - Named exports (except barrel file default export for compatibility)
- **New components rationale**:
  - Transport modules: Single responsibility, independently testable, clear failure modes
  - Barrel export: Maintains backward compatibility while enabling internal modularity
- **Steering compliance**:
  - Feature-based directory structure (GROWI monorepo standard)
  - Immutability (no object mutation in transport creation)
  - Co-located tests (each module has adjacent .spec.ts file)

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Backend / Services | Node.js 18+ | Runtime environment | No change from existing |
| Type System | TypeScript 5.x | Compile-time validation | Leverage branded types (NonBlankString) |
| Email Library | nodemailer 6.9.15 | SMTP/OAuth2 transport | Existing dependency, no upgrade |
| Type Definitions | @types/nodemailer@6.4.22 | nodemailer TypeScript types | **New dependency** - provides base types for extension |
| Core Types | @growi/core (NonBlankString) | Branded type validation | Existing infrastructure, used for strict credential types |
| Testing | Vitest | Unit testing framework | No change from existing test infrastructure |

**Rationale**: @types/nodemailer provides foundational type safety for nodemailer API, while StrictOAuth2Options extends these with NonBlankString for compile-time empty string prevention (see research.md for type compatibility analysis).

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | MailService at mail/mail.ts | MailService | - | - |
| 1.2 | Test file at mail/mail.spec.ts | MailService | - | - |
| 1.3 | Barrel file at mail/index.ts | index.ts | Exports MailService | - |
| 1.4 | Import from ~/server/service/mail | index.ts | Default export | - |
| 1.5 | Legacy import path works | index.ts | Alias resolution | - |
| 2.1 | SMTP module at mail/smtp.ts | SmtpTransport | createSMTPClient() | - |
| 2.2 | SES module at mail/ses.ts | SesTransport | createSESClient() | - |
| 2.3 | OAuth2 module at mail/oauth2.ts | OAuth2Transport | createOAuth2Client() | - |
| 2.4 | Delegate transport creation | MailService.initialize() | Transport factories | Initialization |
| 2.5 | Transport function signature | All transport modules | create[Transport]Client | - |
| 2.6 | Return null for incomplete credentials | All transport modules | - | Error path |
| 2.7 | Follow immutability conventions | All modules | - | - |
| 3.1-3.3 | Type infrastructure (@types/nodemailer, StrictOAuth2Options) | types.ts, package.json | Type definitions | - |
| 3.4-3.7 | Runtime validation (toNonBlankStringOrUndefined, type guards) | oauth2.ts | - | Credential validation |
| 3.8-3.12 | Compile-time safety (type errors, no any, strict mode) | StrictOAuth2Options, oauth2.ts | Type constraints | Build-time checks |
| 4.1-4.6 | Backward compatibility | MailService | All existing methods/properties | All existing flows |
| 5.1-5.7 | Co-located testing | All spec files | Test interfaces | Test execution |

## Implementation Order

The refactoring follows a three-phase approach that ensures type safety from the beginning and maintains a working codebase at each step:

### Phase 1: Type Safety Foundation
**Requirements**: 3.1-3.3, 3.8-3.12

**Actions**:
1. Install `@types/nodemailer@6.4.22` as devDependency
2. Create `src/server/service/mail/types.ts` with:
   - `StrictOAuth2Options` type definition (with NonBlankString)
   - Shared types: `MailConfig`, `EmailConfig`, `SendResult`
3. Verify type compilation with `pnpm run lint:typecheck`
4. Verify existing tests still pass with `pnpm run test`

**Checkpoint**: ✅ Type definitions exist, existing code unchanged and functional

### Phase 2: Module Extraction
**Requirements**: 2.1-2.7, 3.4-3.7

**Actions**:
1. Extract SMTP logic to `smtp.ts` + create `smtp.spec.ts`
2. Extract SES logic to `ses.ts` + create `ses.spec.ts`
3. Extract OAuth2 logic to `oauth2.ts` (using NonBlankString) + create `oauth2.spec.ts`
4. Each module implements `create[Transport]Client(configManager): Transporter | null`
5. Tests verify null return for incomplete credentials

**Checkpoint**: ✅ Transport modules exist with type-safe implementations, tested in isolation

### Phase 3: Integration & Barrel Export
**Requirements**: 1.1-1.5, 2.4, 4.1-4.6, 5.1-5.7

**Actions**:
1. Move `mail.ts` to `mail/mail.ts`
2. Update MailService to import and delegate to transport modules
3. Remove inline `createSMTPClient()`, `createSESClient()`, `createOAuth2Client()` methods
4. Move `mail.spec.ts` to `mail/mail.spec.ts` and update imports
5. Create `mail/index.ts` barrel export (default export for backward compatibility)
6. Run full test suite to verify backward compatibility

**Checkpoint**: ✅ Refactoring complete, all tests pass, backward compatibility verified

**Rationale**: This order ensures:
- Type definitions are available before writing any transport code
- Each transport module is type-safe from the moment it's created
- No "add types later" technical debt
- Continuous verification at each checkpoint

## Components and Interfaces

### Summary Table

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies (P0/P1) | Contracts |
|-----------|--------------|--------|--------------|--------------------------|-----------|
| MailService | Service | Email orchestration and S2S coordination | 1.1-1.5, 2.4, 4.1-4.6 | ConfigManager (P0), Transport modules (P0) | Service, State |
| SmtpTransport | Transport | SMTP client creation with auth | 2.1, 2.5-2.7 | nodemailer (P0), ConfigManager (P0) | Service |
| SesTransport | Transport | AWS SES client creation | 2.2, 2.5-2.7 | nodemailer (P0), ConfigManager (P0) | Service |
| OAuth2Transport | Transport | OAuth2 client with type-safe credentials | 2.3, 2.5-2.7, 3.1-3.12 | nodemailer (P0), @growi/core (P0), ConfigManager (P0) | Service |
| types.ts | Types | Shared type definitions | 3.1-3.3 | @growi/core (P0), @types/nodemailer (P1) | Type definitions |
| index.ts | Barrel | Public API export | 1.3-1.5 | MailService (P0) | Export contract |

### Service Layer

#### MailService

| Field | Detail |
|-------|--------|
| Intent | Orchestrate email sending, coordinate transport initialization, handle S2S configuration updates |
| Requirements | 1.1-1.5, 2.4, 4.1-4.6 |

**Responsibilities & Constraints**
- Orchestrate transport selection based on `mail:transmissionMethod` config value
- Maintain existing public API: `send()`, `initialize()`, `publishUpdatedMessage()`
- Implement `S2sMessageHandlable` interface for distributed configuration synchronization
- Delegate transport creation to specialized modules
- Preserve retry logic, error handling, and failed email storage behavior

**Dependencies**
- Inbound: Config API, Global Notification Service — email sending requests (P0)
- Outbound: SmtpTransport, SesTransport, OAuth2Transport — transport creation (P0)
- Outbound: ConfigManager — configuration retrieval (P0)
- External: nodemailer — email transmission (P0)

**Contracts**: Service [x] / State [x]

##### Service Interface

```typescript
class MailService implements S2sMessageHandlable {
  // Public properties (existing)
  isMailerSetup: boolean;
  mailer: any;  // nodemailer.Transporter
  mailConfig: MailConfig;

  // Constructor (existing signature)
  constructor(crowi: Crowi);

  // Public methods (existing)
  initialize(): void;
  send(config: EmailConfig): Promise<SendResult>;
  publishUpdatedMessage(): Promise<void>;

  // S2sMessageHandlable interface (existing)
  shouldHandleS2sMessage(s2sMessage: S2sMessage): boolean;
  handleS2sMessage(s2sMessage: S2sMessage): Promise<void>;

  // Existing helper methods (unchanged)
  sendWithRetry(config: EmailConfig, maxRetries?: number): Promise<SendResult>;
  storeFailedEmail(config: EmailConfig, error: Error & { code?: string }): Promise<void>;
  maskCredential(credential: string): string;
  exponentialBackoff(attempt: number): Promise<void>;
}
```

**Preconditions**:
- Crowi instance must be initialized with ConfigManager, appService, s2sMessagingService
- Config must include `mail:from` and valid `mail:transmissionMethod`

**Postconditions**:
- `isMailerSetup` reflects successful transport initialization
- `mailer` contains nodemailer transport instance or null

**Invariants**:
- If `isMailerSetup === true`, then `mailer !== null`
- `send()` method preserves existing behavior (retry logic, error handling, failed email storage)

##### State Management

**State model**:
- `isMailerSetup: boolean` - Flag indicating successful transport initialization
- `mailer: any` - Nodemailer transport instance (SMTP/SES/OAuth2)
- `mailConfig: MailConfig` - Current mail configuration (from, subject)
- `lastLoadedAt: Date` - Timestamp of last configuration load (for S2S sync)

**Persistence & consistency**:
- No direct persistence (reads from ConfigManager)
- S2S messaging ensures configuration consistency across distributed instances

**Concurrency strategy**:
- `initialize()` called synchronously during construction and S2S message handling
- No locking required (single-threaded Node.js event loop)

**Implementation Notes**
- **Integration**: Delegates transport creation to `createSMTPClient()`, `createSESClient()`, `createOAuth2Client()` factory functions
- **Validation**: Transport modules handle credential validation; MailService handles null return (transport creation failure)
- **Risks**: Existing consumers must not be affected by internal restructuring; integration tests verify import paths and method signatures

### Transport Layer

#### SmtpTransport

| Field | Detail |
|-------|--------|
| Intent | Create nodemailer SMTP transport with username/password authentication |
| Requirements | 2.1, 2.5-2.7 |

**Responsibilities & Constraints**
- Read SMTP configuration from ConfigManager (`mail:smtpHost`, `mail:smtpPort`, `mail:smtpUser`, `mail:smtpPassword`)
- Return `null` if required credentials are missing
- Configure TLS settings (`rejectUnauthorized: false` for self-signed certificates)

**Dependencies**
- Inbound: MailService.initialize() — transport creation request (P0)
- Outbound: ConfigManager — config retrieval (P0)
- External: nodemailer — transport instance creation (P0)

**Contracts**: Service [x]

##### Service Interface

```typescript
/**
 * Creates an SMTP transport client for email sending.
 *
 * @param configManager - Configuration manager instance
 * @param option - Optional SMTP configuration (for testing)
 * @returns nodemailer Transporter instance, or null if credentials incomplete
 *
 * @remarks
 * Config keys required: mail:smtpHost, mail:smtpPort
 * Config keys optional: mail:smtpUser, mail:smtpPassword (auth)
 */
export function createSMTPClient(
  configManager: IConfigManagerForApp,
  option?: SMTPTransport.Options
): Transporter | null;
```

**Preconditions**:
- ConfigManager contains `mail:smtpHost` and `mail:smtpPort`

**Postconditions**:
- Returns nodemailer SMTP transport instance with configured auth (if credentials present)
- Returns `null` if host or port missing

**Implementation Notes**
- **Integration**: Called by MailService.initialize() when `mail:transmissionMethod === 'smtp'`
- **Validation**: Checks `host == null || port == null` for null return
- **Risks**: TLS configuration (`rejectUnauthorized: false`) may pose security risk in production

#### SesTransport

| Field | Detail |
|-------|--------|
| Intent | Create nodemailer SES transport with AWS IAM credentials |
| Requirements | 2.2, 2.5-2.7 |

**Responsibilities & Constraints**
- Read SES configuration from ConfigManager (`mail:sesAccessKeyId`, `mail:sesSecretAccessKey`)
- Return `null` if required credentials are missing
- Use nodemailer-ses-transport adapter

**Dependencies**
- Inbound: MailService.initialize() — transport creation request (P0)
- Outbound: ConfigManager — config retrieval (P0)
- External: nodemailer, nodemailer-ses-transport — transport instance creation (P0)

**Contracts**: Service [x]

##### Service Interface

```typescript
/**
 * Creates an AWS SES transport client for email sending.
 *
 * @param configManager - Configuration manager instance
 * @param option - Optional SES configuration (for testing)
 * @returns nodemailer Transporter instance, or null if credentials incomplete
 *
 * @remarks
 * Config keys required: mail:sesAccessKeyId, mail:sesSecretAccessKey
 */
export function createSESClient(
  configManager: IConfigManagerForApp,
  option?: { accessKeyId: string; secretAccessKey: string }
): Transporter | null;
```

**Preconditions**:
- ConfigManager contains `mail:sesAccessKeyId` and `mail:sesSecretAccessKey`

**Postconditions**:
- Returns nodemailer SES transport instance with AWS credentials
- Returns `null` if access key or secret key missing

**Implementation Notes**
- **Integration**: Called by MailService.initialize() when `mail:transmissionMethod === 'ses'`
- **Validation**: Checks `accessKeyId == null || secretAccessKey == null` for null return
- **Risks**: Requires nodemailer-ses-transport dependency (existing)

#### OAuth2Transport

| Field | Detail |
|-------|--------|
| Intent | Create nodemailer OAuth2 transport with type-safe, non-blank credentials |
| Requirements | 2.3, 2.5-2.7, 3.1-3.12 |

**Responsibilities & Constraints**
- Read OAuth2 configuration from ConfigManager (`mail:oauth2User`, `mail:oauth2ClientId`, `mail:oauth2ClientSecret`, `mail:oauth2RefreshToken`)
- Convert config values to `NonBlankString` using `toNonBlankStringOrUndefined()`
- Return `null` if any credential is `undefined` after conversion
- Construct `StrictOAuth2Options` with type-safe credentials
- Log warning for incomplete credentials

**Dependencies**
- Inbound: MailService.initialize() — transport creation request (P0)
- Outbound: ConfigManager — config retrieval (P0)
- Outbound: @growi/core — NonBlankString helpers (P0)
- External: nodemailer — transport instance creation (P0)

**Contracts**: Service [x]

##### Service Interface

```typescript
/**
 * Creates a Gmail OAuth2 transport client with type-safe credentials.
 *
 * @param configManager - Configuration manager instance
 * @param option - Optional OAuth2 configuration (for testing)
 * @returns nodemailer Transporter instance, or null if credentials incomplete
 *
 * @remarks
 * Config keys required: mail:oauth2User, mail:oauth2ClientId,
 *                       mail:oauth2ClientSecret, mail:oauth2RefreshToken
 *
 * All credentials must be non-blank strings (length > 0 after trim).
 * Uses NonBlankString branded type to prevent empty string credentials at compile time.
 *
 * @example
 * ```typescript
 * const transport = createOAuth2Client(configManager);
 * if (transport === null) {
 *   logger.warn('OAuth2 credentials incomplete');
 * }
 * ```
 */
export function createOAuth2Client(
  configManager: IConfigManagerForApp,
  option?: SMTPTransport.Options
): Transporter | null;
```

**Preconditions**:
- ConfigManager contains all four OAuth2 credential keys
- Credentials are non-blank strings (validated at compile time via NonBlankString type)

**Postconditions**:
- Returns nodemailer OAuth2 transport instance with Gmail service configuration
- Returns `null` if any credential is blank or missing
- Logs warning when returning null

**Invariants**:
- If function returns non-null transport, all credentials are NonBlankString (guaranteed by type system)

**Implementation Notes**
- **Integration**: Called by MailService.initialize() when `mail:transmissionMethod === 'oauth2'`
- **Validation**: Uses `toNonBlankStringOrUndefined()` for conversion, then type guards (`=== undefined`) for null check
- **Risks**: Type safety depends on correct usage of NonBlankString helpers; runtime validation removed in favor of type guards

### Type Layer

#### types.ts

| Field | Detail |
|-------|--------|
| Intent | Provide shared type definitions for mail module |
| Requirements | 3.1-3.3 |

**Responsibilities & Constraints**
- Define `StrictOAuth2Options` type with NonBlankString credential fields
- Export shared types: MailConfig, EmailConfig, SendResult
- Maintain compatibility with nodemailer's SMTPTransport.Options

**Dependencies**
- Outbound: @growi/core — NonBlankString type (P0)
- External: @types/nodemailer — SMTPTransport types (P1)

**Contracts**: Type definitions

##### Type Definitions

```typescript
import type { NonBlankString } from '@growi/core/dist/interfaces';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

/**
 * Type-safe OAuth2 configuration with non-blank string validation.
 *
 * This type is stricter than nodemailer's default XOAuth2.Options, which allows
 * empty strings. By using NonBlankString, we prevent empty credentials at compile time,
 * matching nodemailer's runtime falsy checks (`!this.options.refreshToken`).
 *
 * @see https://github.com/nodemailer/nodemailer/blob/master/lib/xoauth2/index.js
 */
export type StrictOAuth2Options = {
  service: 'gmail';
  auth: {
    type: 'OAuth2';
    user: NonBlankString;
    clientId: NonBlankString;
    clientSecret: NonBlankString;
    refreshToken: NonBlankString;
  };
};

export type MailConfig = {
  to?: string;
  from?: string;
  text?: string;
  subject?: string;
};

export type EmailConfig = {
  to: string;
  from?: string;
  subject?: string;
  text?: string;
  template?: string;
  vars?: Record<string, unknown>;
};

export type SendResult = {
  messageId: string;
  response: string;
  envelope: {
    from: string;
    to: string[];
  };
};

// Type assertion: StrictOAuth2Options is compatible with SMTPTransport.Options
// This ensures our strict type can be passed to nodemailer.createTransport()
declare const _typeCheck: SMTPTransport.Options extends StrictOAuth2Options ? never : 'Type mismatch';
```

**Implementation Notes**
- **Integration**: Imported by oauth2.ts and mail.ts for type-safe credential handling
- **Validation**: Type compatibility verified via `declare const _typeCheck` assertion
- **Risks**: Future nodemailer type changes may require updates to StrictOAuth2Options

### Export Layer

#### index.ts

| Field | Detail |
|-------|--------|
| Intent | Provide backward-compatible barrel export for MailService |
| Requirements | 1.3-1.5 |

**Responsibilities & Constraints**
- Export MailService as default export (backward compatibility)
- Export types as named exports (future extensibility)

**Contracts**: Export contract

```typescript
/**
 * Mail service barrel export.
 *
 * Maintains backward compatibility with existing import pattern:
 * `import MailService from '~/server/service/mail'`
 */
export { default } from './mail';
export type { MailConfig, EmailConfig, SendResult, StrictOAuth2Options } from './types';
```

## Error Handling

### Error Strategy

The refactored MailService maintains existing error handling behavior:
- Transport creation failures return `null` (logged as warnings)
- Email send failures trigger retry logic with exponential backoff
- Final failures stored in FailedEmail collection for manual review

### Error Categories and Responses

**Transport Initialization Errors** (Credentials):
- Incomplete credentials → Return `null`, log warning, set `isMailerSetup = false`
- Type guard validation: `credential === undefined` (OAuth2 module)
- Null check validation: `host == null` (SMTP/SES modules)

**Email Send Errors** (Runtime):
- OAuth2 token refresh failure (invalid_grant) → Retry with backoff, store failed email after max retries
- SMTP/SES connection errors → Retry with backoff
- Validation errors (missing recipient) → Immediate failure (no retry)

**Type Errors** (Compile-time):
- Empty string assigned to OAuth2 credential → TypeScript compile error
- Invalid type passed to transport factory → TypeScript compile error

### Monitoring

No changes to existing monitoring approach:
- Structured logging with tags: `oauth2_email_success`, `oauth2_token_refresh_failure`, `gmail_api_error`
- Failed emails stored in MongoDB (FailedEmail collection)
- S2S messaging for configuration change propagation

## Testing Strategy

### Unit Tests: Transport Modules

1. **SMTP Transport**: Verify null return for missing host/port, successful transport creation with valid credentials
2. **SES Transport**: Verify null return for missing AWS credentials, successful transport creation with access key/secret
3. **OAuth2 Transport**: Verify null return for incomplete/blank credentials, successful transport creation with NonBlankString credentials, type guard behavior (`=== undefined`)
4. **Types Module**: Verify StrictOAuth2Options compatibility with SMTPTransport.Options (type-level test)

### Integration Tests: MailService

1. **Initialization Flow**: Verify MailService delegates to correct transport module based on `mail:transmissionMethod` config
2. **S2S Messaging**: Verify configuration updates propagate via S2sMessageHandlable interface
3. **Backward Compatibility**: Verify existing import paths resolve correctly (`~/server/service/mail`)
4. **Error Handling**: Verify `send()` method preserves retry logic, exponential backoff, and failed email storage
5. **Public API**: Verify all existing methods/properties remain accessible and functional

### E2E Tests (Minimal)

1. **Email Sending**: Verify end-to-end email send with OAuth2 transport (using test credentials)
2. **Config API Integration**: Verify mail settings can be updated via API and MailService re-initializes

### Type Safety Tests

1. **Compile-time Validation**: Verify empty string assignment to OAuth2 credential produces TypeScript error
2. **Type Guard Behavior**: Verify `toNonBlankStringOrUndefined()` return type correctly narrows to `NonBlankString | undefined`
3. **Compatibility**: Verify StrictOAuth2Options can be passed to `nodemailer.createTransport()` without type errors

### Test Coverage Targets

- **Transport modules**: 100% (simple factory functions, easy to test in isolation)
- **MailService**: Maintain existing coverage (~80%+)
- **Types**: Type-level tests only (no runtime testing needed)

## Security Considerations

### Credential Handling

**Existing security measures maintained**:
- Credentials retrieved from ConfigManager (never hardcoded)
- `maskCredential()` helper for logging (shows only last 4 characters)
- Failed email storage excludes sensitive credential details

**Improvements**:
- Type-safe credential validation prevents accidental empty string credentials
- Compile-time checks reduce risk of runtime credential errors

### TLS/SSL Configuration

**Existing behavior maintained**:
- SMTP transport uses `rejectUnauthorized: false` for self-signed certificates
- OAuth2 transport uses Gmail's secure API endpoints
- SES transport uses AWS SDK defaults (TLS enabled)

**Recommendation**: Document requirement for valid TLS certificates in production (out of scope for this refactoring)

## Migration Strategy

### Phase 1: Preparation

1. Install `@types/nodemailer@6.4.22` as devDependency
2. Create `src/server/service/mail/` directory
3. Verify all existing tests pass before refactoring

### Phase 2: Module Extraction

1. Create `types.ts` with shared type definitions (StrictOAuth2Options, MailConfig, EmailConfig, SendResult)
2. Extract SMTP logic to `smtp.ts` with `createSMTPClient()` function
3. Extract SES logic to `ses.ts` with `createSESClient()` function
4. Extract OAuth2 logic to `oauth2.ts` with `createOAuth2Client()` function (using NonBlankString)
5. Create co-located test files for each transport module

### Phase 3: MailService Refactoring

1. Move `src/server/service/mail.ts` to `src/server/service/mail/mail.ts`
2. Update MailService to import and delegate to transport modules
3. Remove inline `createSMTPClient()`, `createSESClient()`, `createOAuth2Client()` methods
4. Move `src/server/service/mail.spec.ts` to `src/server/service/mail/mail.spec.ts`
5. Update test file imports

### Phase 4: Barrel Export

1. Create `src/server/service/mail/index.ts` with default export
2. Verify all existing imports resolve correctly (no changes needed in consuming code)
3. Run full test suite to verify backward compatibility

### Phase 5: Validation

1. Run type checker (`pnpm run lint:typecheck`)
2. Run linter (`pnpm run lint:biome`)
3. Run full test suite (`pnpm run test`)
4. Run integration tests with real SMTP/OAuth2 credentials
5. Verify email sending works in development environment

### Rollback Plan

If issues arise after deployment:
1. Revert commit to restore single-file MailService implementation
2. Remove `@types/nodemailer` dependency if causing conflicts
3. No database migrations or data changes required (pure code refactoring)

## Supporting References

### Package Dependencies

```json
{
  "dependencies": {
    "nodemailer": "6.9.15",
    "nodemailer-ses-transport": "^1.5.1",
    "ejs": "^3.1.9",
    "@growi/core": "workspace:*"
  },
  "devDependencies": {
    "@types/nodemailer": "6.4.22"  // NEW
  }
}
```

### Directory Structure (After Refactoring)

```
src/server/service/mail/
├── index.ts              # Barrel export (default: MailService)
├── mail.ts               # MailService class (orchestration)
├── mail.spec.ts          # MailService tests
├── smtp.ts               # SMTP transport factory
├── smtp.spec.ts          # SMTP transport tests
├── ses.ts                # SES transport factory
├── ses.spec.ts           # SES transport tests
├── oauth2.ts             # OAuth2 transport factory (with NonBlankString)
├── oauth2.spec.ts        # OAuth2 transport tests
└── types.ts              # Shared type definitions (StrictOAuth2Options, etc.)
```

### Config Key Dependencies

**SMTP** (`smtp.ts`):
- `mail:smtpHost` (required)
- `mail:smtpPort` (required)
- `mail:smtpUser` (optional, for auth)
- `mail:smtpPassword` (optional, for auth)

**SES** (`ses.ts`):
- `mail:sesAccessKeyId` (required)
- `mail:sesSecretAccessKey` (required)

**OAuth2** (`oauth2.ts`):
- `mail:oauth2User` (required, NonBlankString)
- `mail:oauth2ClientId` (required, NonBlankString)
- `mail:oauth2ClientSecret` (required, NonBlankString)
- `mail:oauth2RefreshToken` (required, NonBlankString)

**Common** (all transports):
- `mail:from` (required, sender address)
- `mail:transmissionMethod` (required, one of: 'smtp', 'ses', 'oauth2')
