# Research & Design Decisions

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design for OAuth 2.0 email support.

**Usage**:
- Log research activities and outcomes during the discovery phase.
- Document design decision trade-offs that are too detailed for `design.md`.
- Provide references and evidence for future audits or reuse.
---

## Summary
- **Feature**: `oauth2-email-support`
- **Discovery Scope**: Extension (integrating OAuth2 into existing mail service architecture)
- **Key Findings**:
  - Existing mail service supports SMTP and SES via transmission method pattern
  - Nodemailer has built-in OAuth2 support for Gmail with automatic token refresh
  - Admin UI follows modular pattern with separate setting components per transmission method
  - Config management uses `mail:*` namespace with type-safe definitions

## Research Log

### Existing Mail Service Architecture

- **Context**: Need to understand integration points for OAuth2 support
- **Sources Consulted**:
  - `apps/app/src/server/service/mail.ts` (MailService implementation)
  - `apps/app/src/client/components/Admin/App/MailSetting.tsx` (Admin UI)
  - `apps/app/src/server/service/config-manager/config-definition.ts` (Config schema)
- **Findings**:
  - MailService uses factory pattern: `createSMTPClient()`, `createSESClient()`
  - Transmission method determined by `mail:transmissionMethod` config value ('smtp' | 'ses')
  - `initialize()` method called on service startup and S2S message updates
  - Nodemailer transporter created based on transmission method
  - Admin UI uses conditional rendering for SMTP vs SES settings
  - State management via AdminAppContainer (unstated pattern)
  - Test email functionality exists for SMTP only
- **Implications**:
  - OAuth2 follows same pattern: add `createOAuth2Client()` method
  - Extend `mail:transmissionMethod` type to `'smtp' | 'ses' | 'oauth2'`
  - Create new `OAuth2Setting.tsx` component following SMTP/SES pattern
  - Add OAuth2-specific config keys following `mail:*` namespace

### Nodemailer OAuth2 Integration

- **Context**: Verify OAuth2 support in nodemailer and configuration requirements
- **Sources Consulted**:
  - [OAuth2 | Nodemailer](https://nodemailer.com/smtp/oauth2)
  - [Using Gmail | Nodemailer](https://nodemailer.com/usage/using-gmail)
  - [Sending Emails Securely Using Node.js, Nodemailer, SMTP, Gmail, and OAuth2](https://dev.to/chandrapantachhetri/sending-emails-securely-using-node-js-nodemailer-smtp-gmail-and-oauth2-g3a)
  - Web search: "nodemailer gmail oauth2 configuration 2026"
- **Findings**:
  - Nodemailer has first-class OAuth2 support with type `'OAuth2'`
  - Configuration structure:
    ```javascript
    {
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: "user@gmail.com",
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN
      }
    }
    ```
  - Automatic access token refresh handled by nodemailer
  - Requires `https://mail.google.com/` OAuth scope
  - Gmail service shortcut available (simplifies configuration)
  - Production consideration: Gmail designed for individual users, not automated services
- **Implications**:
  - No additional dependencies needed (nodemailer already installed)
  - Four config values required: user email, clientId, clientSecret, refreshToken
  - Token refresh is automatic - no manual refresh logic needed
  - Should validate credentials before saving to config
  - Security: clientSecret and refreshToken must be encrypted in database

### Config Manager Pattern Analysis

- **Context**: Understand how to add new config keys for OAuth2 credentials
- **Sources Consulted**:
  - `apps/app/src/server/service/config-manager/config-definition.ts`
  - Existing mail config keys: `mail:from`, `mail:transmissionMethod`, `mail:smtpHost`, etc.
- **Findings**:
  - Config keys use namespace pattern: `mail:*`
  - Type-safe definitions using `defineConfig<T>()`
  - Existing transmission method: `defineConfig<'smtp' | 'ses' | undefined>()`
  - Config values stored in database via ConfigManager
  - No explicit encryption layer visible in config definition (handled elsewhere)
- **Implications**:
  - Add four new keys: `mail:oauth2User`, `mail:oauth2ClientId`, `mail:oauth2ClientSecret`, `mail:oauth2RefreshToken`
  - Update `mail:transmissionMethod` type to `'smtp' | 'ses' | 'oauth2' | undefined`
  - Encryption should be handled at persistence layer (ConfigManager or database model)
  - Follow same pattern as SMTP/SES for consistency

### Admin UI State Management Pattern

- **Context**: Understand how to integrate OAuth2 settings into admin UI
- **Sources Consulted**:
  - `apps/app/src/client/components/Admin/App/SmtpSetting.tsx`
  - `apps/app/src/client/components/Admin/App/SesSetting.tsx`
  - `apps/app/src/client/services/AdminAppContainer.js`
- **Findings**:
  - Separate component per transmission method (SmtpSetting, SesSetting)
  - Components receive `register` from react-hook-form
  - Unstated container pattern for state management
  - Container methods: `changeSmtpHost()`, `changeFromAddress()`, etc.
  - `updateMailSettingHandler()` saves all settings via API
  - Test email button only shown for SMTP
- **Implications**:
  - Create `OAuth2Setting.tsx` component following same structure
  - Add four state methods to AdminAppContainer: `changeOAuth2User()`, `changeOAuth2ClientId()`, etc.
  - Include OAuth2 credentials in `updateMailSettingHandler()` API call
  - Test email functionality should work for OAuth2 (same as SMTP)
  - Field masking needed for clientSecret and refreshToken

### Security Considerations

- **Context**: Ensure secure handling of OAuth2 credentials
- **Sources Consulted**:
  - GROWI security guidelines (`.claude/rules/security.md`)
  - Existing SMTP/SES credential handling
- **Findings**:
  - Credentials stored in MongoDB via ConfigManager
  - Input fields use `type="password"` for sensitive values
  - No explicit encryption visible in UI layer
  - Logging should not expose credentials
- **Implications**:
  - Use `type="password"` for clientSecret and refreshToken fields
  - Mask values when displaying saved configuration (show last 4 characters)
  - Never log credentials in plain text
  - Validate SSL/TLS when connecting to Google OAuth endpoints
  - Ensure admin authentication required before accessing config page

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Factory Method Extension | Add `createOAuth2Client()` to existing MailService | Follows existing pattern, minimal changes, consistent with SMTP/SES | None significant | Recommended - aligns with current architecture |
| Separate OAuth2Service | Create dedicated service for OAuth2 mail | Better separation of concerns | Over-engineering for simple extension, breaks existing pattern | Not recommended - unnecessary complexity |
| Adapter Pattern | Wrap OAuth2 in adapter implementing mail interface | More flexible for future auth methods | Premature abstraction, more code to maintain | Not needed for single OAuth2 implementation |

## Design Decisions

### Decision: Extend Existing MailService with OAuth2 Support

- **Context**: Need to add OAuth2 email sending without breaking existing SMTP/SES functionality
- **Alternatives Considered**:
  1. Create separate OAuth2MailService - more modular but introduces service management complexity
  2. Refactor to plugin architecture - future-proof but over-engineered for current needs
  3. Extend existing MailService with factory method - follows current pattern
- **Selected Approach**: Extend existing MailService with `createOAuth2Client()` method
- **Rationale**:
  - Maintains consistency with existing architecture
  - Minimal code changes reduce risk
  - Clear migration path (no breaking changes)
  - GROWI already uses this pattern successfully for SMTP/SES
- **Trade-offs**:
  - Benefits: Low risk, fast implementation, familiar pattern
  - Compromises: All transmission methods in single service (acceptable given simplicity)
- **Follow-up**: Ensure test coverage for OAuth2 path alongside existing SMTP/SES tests

### Decision: Use Nodemailer's Built-in OAuth2 Support

- **Context**: Need reliable OAuth2 implementation with automatic token refresh
- **Alternatives Considered**:
  1. Manual OAuth2 implementation with googleapis library - more control but complex
  2. Third-party OAuth2 wrapper - additional dependency
  3. Nodemailer built-in OAuth2 - zero additional dependencies
- **Selected Approach**: Use nodemailer's native OAuth2 support with Gmail service
- **Rationale**:
  - No additional dependencies (nodemailer already installed)
  - Automatic token refresh reduces complexity
  - Well-documented and actively maintained
  - Matches user's original plan (stated in requirements)
- **Trade-offs**:
  - Benefits: Simple, reliable, no new dependencies
  - Compromises: Limited to Gmail/Google Workspace (acceptable per requirements)
- **Follow-up**: Document Google Cloud Console setup steps for administrators

### Decision: Preserve Existing Transmission Method Pattern

- **Context**: Maintain backward compatibility while adding OAuth2 option
- **Alternatives Considered**:
  1. Deprecate transmission method concept - breaking change
  2. Add OAuth2 as transmission method option - extends existing pattern
  3. Support multiple simultaneous methods - unnecessary complexity
- **Selected Approach**: Add 'oauth2' as third transmission method option
- **Rationale**:
  - Zero breaking changes for existing users
  - Consistent admin UI experience
  - Clear mutual exclusivity (one method active at a time)
  - Easy to test and validate
- **Trade-offs**:
  - Benefits: Backward compatible, simple mental model
  - Compromises: Only one transmission method active (acceptable per requirements)
- **Follow-up**: Ensure switching between methods preserves all config values

### Decision: Component-Based UI Following SMTP/SES Pattern

- **Context**: Need consistent admin UI for OAuth2 configuration
- **Alternatives Considered**:
  1. Inline OAuth2 fields in main form - cluttered UI
  2. Modal dialog for OAuth2 setup - breaks existing pattern
  3. Separate OAuth2Setting component - matches SMTP/SES pattern
- **Selected Approach**: Create `OAuth2Setting.tsx` component rendered conditionally
- **Rationale**:
  - Maintains visual consistency across transmission methods
  - Reuses existing form patterns (react-hook-form, unstated)
  - Easy for admins familiar with SMTP/SES setup
  - Supports incremental development (component isolation)
- **Trade-offs**:
  - Benefits: Consistent UX, modular code, easy testing
  - Compromises: Minor code duplication in form field rendering (acceptable)
- **Follow-up**: Add help text for each OAuth2 field explaining Google Cloud Console setup

## Risks & Mitigations

- **Risk**: OAuth2 credentials stored in plain text in database
  - **Mitigation**: Implement encryption at ConfigManager persistence layer; use same encryption as SMTP passwords

- **Risk**: Refresh token expiration or revocation not handled
  - **Mitigation**: Nodemailer handles refresh automatically; log specific error codes for troubleshooting; document token refresh in admin help text

- **Risk**: Google rate limiting or account suspension
  - **Mitigation**: Document production usage considerations; implement exponential backoff retry logic; log detailed error responses from Gmail API

- **Risk**: Incomplete credential configuration causing service failure
  - **Mitigation**: Validate all four required fields before saving; display clear error messages; maintain isMailerSetup flag for health checks

- **Risk**: Breaking changes to existing SMTP/SES functionality
  - **Mitigation**: Preserve all existing code paths; add OAuth2 as isolated branch; comprehensive integration tests for all three methods

## Session 2: Production Implementation Discoveries (2026-02-10)

### Critical Technical Constraints Identified

#### 1. Nodemailer XOAuth2 Falsy Check Requirement

**Discovery**: Production testing revealed "Can't create new access token for user" errors from nodemailer's XOAuth2 handler.

**Root Cause**: Nodemailer's XOAuth2 implementation uses **falsy checks** (`!this.options.refreshToken`) at line 184, not null checks, rejecting empty strings as invalid credentials.

**Implementation Requirement**:
```typescript
// ❌ WRONG: Allows empty strings to pass validation
if (clientId != null && clientSecret != null && refreshToken != null) {
  // This passes validation but nodemailer will reject it
}

// ✅ CORRECT: Matches nodemailer's falsy check behavior
if (!clientId || !clientSecret || !refreshToken || !user) {
  logger.warn('OAuth 2.0 credentials incomplete, skipping transport creation');
  return null;
}
```

**Why This Matters**: Empty strings (`""`) are falsy in JavaScript. Using `!= null` in GROWI would allow empty strings through validation, but nodemailer's falsy check would then reject them, causing runtime failures.

**Impact**: All credential validation logic in MailService and ConfigManager **must use falsy checks** for OAuth 2.0 credentials to maintain compatibility with nodemailer.

**Reference**: [mail.ts:219-226](../../../apps/app/src/server/service/mail.ts#L219-L226)

---

#### 2. Gmail API FROM Address Rewriting

**Discovery**: Gmail API rewrites the FROM address to the authenticated account email, ignoring GROWI's configured `mail:from` address.

**Gmail API Behavior**: Gmail API enforces that emails are sent FROM the authenticated account unless send-as aliases are explicitly configured in Google Workspace.

**Example**:
```
Configured: mail:from = "notifications@example.com"
Authenticated: oauth2User = "admin@company.com"
Actual sent FROM: "admin@company.com"
```

**Workaround**: Google Workspace administrators must configure **send-as aliases**:
1. Gmail Settings → Accounts and Import → Send mail as
2. Add desired FROM address as an alias
3. Verify domain ownership

**Why This Happens**: Gmail API security policy prevents email spoofing by restricting FROM addresses to authenticated account or verified aliases.

**Impact**:
- GROWI's `mail:from` configuration has **limited effect** with OAuth 2.0
- Custom FROM addresses require Google Workspace send-as alias configuration
- This is **expected Gmail behavior**, not a GROWI limitation

**Documentation Note**: This behavior must be documented in admin UI help text and user guides.

---

#### 3. Credential Preservation Pattern

**Discovery**: Initial implementation allowed secret credentials to be accidentally overwritten with empty strings or masked placeholder values when updating non-secret fields.

**Problem**: Standard PUT request pattern sending all form fields would overwrite secrets with empty values when administrators only wanted to update non-secret fields like `from` address or `oauth2User`.

**Solution**: Conditional secret inclusion pattern:

```typescript
// Build request params with non-secret fields
const requestOAuth2SettingParams: Record<string, any> = {
  'mail:from': req.body.fromAddress,
  'mail:transmissionMethod': req.body.transmissionMethod,
  'mail:oauth2ClientId': req.body.oauth2ClientId,
  'mail:oauth2User': req.body.oauth2User,
};

// Only include secrets if non-empty values provided
if (req.body.oauth2ClientSecret) {
  requestOAuth2SettingParams['mail:oauth2ClientSecret'] = req.body.oauth2ClientSecret;
}
if (req.body.oauth2RefreshToken) {
  requestOAuth2SettingParams['mail:oauth2RefreshToken'] = req.body.oauth2RefreshToken;
}
```

**Frontend Consideration**: GET endpoint returns `undefined` for secrets (not masked values) to prevent accidental re-submission:

```typescript
// ❌ WRONG: Returns masked value that could be saved back
oauth2ClientSecret: '(set)',

// ✅ CORRECT: Returns undefined, frontend shows placeholder
oauth2ClientSecret: undefined,
```

**Why This Pattern**: Allows administrators to update non-secret OAuth 2.0 settings without re-entering sensitive credentials every time.

**Impact**: This pattern must be followed for **any API that updates OAuth 2.0 credentials** to prevent accidental secret overwrites.

**Reference**:
- PUT handler: [apiv3/app-settings/index.ts:293-306](../../../apps/app/src/server/routes/apiv3/app-settings/index.ts#L293-L306)
- GET response: [apiv3/app-settings/index.ts:273-276](../../../apps/app/src/server/routes/apiv3/app-settings/index.ts#L273-L276)

---

### Type Safety Enhancements

**NonBlankString Type**: OAuth 2.0 config definitions use `NonBlankString | undefined` for compile-time protection against empty string assignments:

```typescript
'mail:oauth2ClientSecret': defineConfig<NonBlankString | undefined>({
  defaultValue: undefined,
  isSecret: true,
}),
```

This provides **compile-time protection** complementing runtime falsy checks.

---

### Integration Pattern Discovered

**OAuth 2.0 Retry Logic**: OAuth 2.0 requires retry logic with exponential backoff due to potential token refresh failures:

```typescript
// OAuth 2.0 uses sendWithRetry() for automatic retry
if (transmissionMethod === 'oauth2') {
  return this.sendWithRetry(mailConfig as EmailConfig);
}

// SMTP/SES use direct sendMail()
return this.mailer.sendMail(mailConfig);
```

**Rationale**: OAuth 2.0 token refresh can fail transiently due to network issues or Google API rate limiting. Exponential backoff (1s, 2s, 4s) provides resilience.

---

## Session 3: Post-Refactoring Architecture (2026-02-10)

### MailService Modular Structure

The MailService was refactored from a single monolithic file (`mail.ts`, ~408 lines) into a feature-based directory structure with separate transport modules. This is the current production architecture.

#### Directory Structure

```
src/server/service/mail/
├── index.ts              # Barrel export (default: MailService, backward-compatible)
├── mail.ts               # MailService class (orchestration, S2S, retry logic)
├── mail.spec.ts          # MailService tests
├── smtp.ts               # SMTP transport factory: createSMTPClient()
├── smtp.spec.ts          # SMTP transport tests
├── ses.ts                # SES transport factory: createSESClient()
├── ses.spec.ts           # SES transport tests
├── oauth2.ts             # OAuth2 transport factory: createOAuth2Client()
├── oauth2.spec.ts        # OAuth2 transport tests
└── types.ts              # Shared types (StrictOAuth2Options, MailConfig, etc.)
```

#### Transport Factory Pattern

Each transport module exports a factory function with a consistent signature:

```typescript
export function create[Transport]Client(
  configManager: IConfigManagerForApp,
  option?: TransportOptions
): Transporter | null;
```

- Returns `null` if required credentials are missing (logs warning)
- MailService delegates transport creation based on `mail:transmissionMethod` config

#### StrictOAuth2Options Type

Defined in `types.ts`, this branded type prevents empty string credentials at compile time:

```typescript
import type { NonBlankString } from '@growi/core/dist/interfaces';

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
```

This is stricter than nodemailer's default `XOAuth2.Options` which allows `string | undefined`. The branded type ensures compile-time validation complementing runtime falsy checks.

#### Backward Compatibility

The barrel export at `mail/index.ts` maintains the existing import pattern:
```typescript
import MailService from '~/server/service/mail';  // Still works
```

**Source**: Migrated from `.kiro/specs/refactor-mailer-service/` (spec deleted after implementation completion).

---

## References

- [OAuth2 | Nodemailer](https://nodemailer.com/smtp/oauth2) - Official OAuth2 configuration documentation
- [Using Gmail | Nodemailer](https://nodemailer.com/usage/using-gmail) - Gmail-specific integration guide
- [Sending Emails Securely Using Node.js, Nodemailer, SMTP, Gmail, and OAuth2](https://dev.to/chandrapantachhetri/sending-emails-securely-using-node-js-nodemailer-smtp-gmail-and-oauth2-g3a) - Implementation tutorial
- [Using OAuth2 with Nodemailer for Secure Email Sending](https://shazaali.substack.com/p/using-oauth2-with-nodemailer-for) - Security best practices
- Internal: `apps/app/src/server/service/mail.ts` - Existing mail service implementation
- Internal: `apps/app/src/client/components/Admin/App/MailSetting.tsx` - Admin UI patterns
