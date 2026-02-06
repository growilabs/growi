# Implementation Tasks - OAuth 2.0 Email Support

## Status Overview

**Current Phase**: Post-Implementation Improvement
**Baseline**: GitHub Copilot completed basic OAuth 2.0 functionality (Config, Mail Service, API, UI, State Management, Translations)
**Focus**: Address critical gaps for production readiness

### Implementation Status

✅ **Completed** (12 tasks): Basic OAuth 2.0 functionality working
- Configuration schema
- OAuth 2.0 transport creation (basic)
- API endpoints and validation
- Frontend components and state management
- Multi-language translations

⚠️ **Partially Complete** (2 tasks): Basic functionality exists but missing enhancements
- Help text (2 of 4 fields complete)
- Test email support (needs verification)

❌ **Not Implemented** (15 tasks): Critical gaps identified in validation
- Error handling with retry logic
- Failed email storage
- Field masking in UI
- Complete help text
- All test coverage

---

## Priority Tasks (Recommended Approach)

### 🔴 Phase A: Critical Production Requirements (Immediate - 4-6 hours)

These tasks are **mandatory before production deployment** to ensure reliability and proper error handling.

- [ ] 1. Implement retry logic with exponential backoff
  - Wrap email sending with automatic retry mechanism (3 attempts)
  - Apply exponential backoff intervals: 1 second, 2 seconds, 4 seconds
  - Log detailed error context on each failed attempt
  - Extract and log Google API error codes (invalid_grant, insufficient_permission, unauthorized_client)
  - Continue with existing email send flow on success
  - _Requirements: 5.1, 5.2_
  - _Components: MailService.sendWithRetry(), MailService.exponentialBackoff()_
  - _Priority: P0 (Blocking)_

- [ ] 2. Implement failed email storage
  - Create database schema for failed email tracking
  - Store email configuration after retry exhaustion
  - Capture error details (message, code, stack), transmission method, attempt count
  - Add createdAt and lastAttemptAt timestamps for tracking
  - Enable manual review and reprocessing via admin interface
  - _Requirements: 5.3_
  - _Components: MailService.storeFailedEmail(), FailedEmail model_
  - _Priority: P0 (Blocking)_

- [ ] 3. Enhance OAuth 2.0 error logging
  - Ensure credentials never logged in plain text (verify existing implementation)
  - Log client ID with only last 4 characters visible
  - Include user email, timestamp, and error context in all OAuth 2.0 error logs
  - Verify SSL/TLS validation for Google OAuth endpoints
  - Add monitoring tags for error categorization (oauth2_token_refresh_failure, gmail_api_error)
  - _Requirements: 5.4, 5.7_
  - _Components: MailService error handlers, logging infrastructure_
  - _Priority: P0 (Blocking)_

### 🟡 Phase B: Essential Test Coverage (Next - 8-12 hours)

These tests are **essential for production confidence** and prevent regressions.

- [ ] 4. Unit tests: Mail service OAuth 2.0 transport
  - Test createOAuth2Client() with valid credentials returns functional transport
  - Test createOAuth2Client() with missing credentials returns null and logs error
  - Test createOAuth2Client() with invalid email format logs error
  - Test initialize() sets isMailerSetup flag correctly for OAuth 2.0
  - Test mailer setup state when OAuth 2.0 credentials incomplete
  - _Requirements: 2.1, 2.2, 6.2, 6.4_
  - _Priority: P1 (High)_

- [ ] 5. Unit tests: Retry logic and error handling
  - Test sendWithRetry() succeeds on first attempt without retries
  - Test retry mechanism with exponential backoff (verify 1s, 2s, 4s intervals)
  - Test storeFailedEmail() called after 3 failed attempts
  - Test error logging includes OAuth 2.0 context (error code, client ID last 4, timestamp)
  - Verify credentials never appear in log output
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Priority: P1 (High)_

- [ ] 6. Unit tests: Configuration encryption
  - Test client secret encrypted when saved to database (isSecret: true)
  - Test refresh token encrypted when saved to database (isSecret: true)
  - Test client secret decrypted correctly when loaded from database
  - Test refresh token decrypted correctly when loaded from database
  - Verify transmission method includes 'oauth2' value
  - _Requirements: 1.5, 6.1_
  - _Priority: P1 (High)_

- [ ] 7. Integration test: OAuth 2.0 email sending flow
  - Test end-to-end email send with mocked OAuth 2.0 transport
  - Test token refresh triggered by nodemailer (mock Google OAuth API)
  - Test retry logic invoked on transient Gmail API failures
  - Test failed email storage after all retries exhausted
  - Verify error context logged at each step
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.2, 5.3_
  - _Priority: P1 (High)_

- [ ] 8. Integration test: API validation and security
  - Test PUT /api/v3/app-settings with valid OAuth 2.0 credentials returns 200
  - Test PUT with invalid email returns 400 with field-specific error
  - Test PUT with missing credentials returns 400 with validation errors
  - Test GET response never includes client secret or refresh token values
  - Test S2S messaging triggered after successful configuration update
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 5.5, 6.5_
  - _Priority: P1 (High)_

- [ ] 9. E2E test: Configuration and basic email flow
  - Navigate to Mail Settings page as admin
  - Select OAuth 2.0 transmission method
  - Enter all four OAuth 2.0 credentials
  - Save configuration and verify success notification
  - Send test email and verify success/failure with detailed error if applicable
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 4.1, 4.5, 4.6_
  - _Priority: P1 (High)_

### 🟢 Phase C: UI Polish & Enhancements (Then - 3-4 hours)

These tasks improve **user experience** but don't block production deployment.

- [ ] 10. Complete help text for all OAuth 2.0 fields
  - Add help text for oauth2ClientId: "Obtain from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID"
  - Add help text for oauth2ClientSecret: "Found in the same OAuth 2.0 Client ID details page"
  - Verify existing help text for oauth2User and oauth2RefreshToken
  - Ensure help text visible below each input field
  - _Requirements: 4.3_
  - _Priority: P2 (Medium)_

- [ ] 11. Implement credential field masking
  - Display saved client secret with masking: ****abcd (last 4 characters)
  - Display saved refresh token with masking: ****abcd (last 4 characters)
  - Clear mask when field receives focus to allow editing
  - Preserve mask when field loses focus without changes
  - Apply masking using AdminAppContainer state values
  - _Requirements: 4.4_
  - _Priority: P2 (Medium)_

- [ ] 12. Verify test email support for OAuth 2.0
  - Confirm test email button enabled when OAuth 2.0 is configured
  - Verify test email functionality works with OAuth 2.0 transmission method
  - Display detailed error messages with OAuth 2.0 error codes on failure
  - Test end-to-end: configure OAuth 2.0 → send test email → verify success
  - _Requirements: 4.5, 4.6_
  - _Priority: P2 (Medium)_

---

## Completed Tasks (Baseline Implementation)

<details>
<summary>✅ Click to expand completed tasks from baseline implementation</summary>

### Configuration & Foundation
- [x] 1. Configuration schema for OAuth 2.0 credentials
- [x] 1.1 Add OAuth 2.0 configuration keys
  - Defined four new configuration keys (user, clientId, clientSecret, refreshToken)
  - Extended transmission method enum to include 'oauth2'
  - Enabled encryption for sensitive credentials (isSecret: true)
  - Verified TypeScript type safety
  - _Requirements: 1.1, 1.5, 6.1_

### Mail Service Extension
- [x] 2. OAuth 2.0 email transmission capability (partial)
- [x] 2.1 Create OAuth 2.0 transport for Gmail
  - Built OAuth 2.0 transport using nodemailer Gmail service
  - Loads credentials from configuration manager
  - Validates presence of all required fields
  - Sets mailer setup flag based on success
  - **Note**: Basic implementation without retry logic
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.5, 6.2_

- [x] 2.5 Service initialization and token management (partial)
  - Integrated OAuth 2.0 into mail service initialization
  - Handles mailer setup state for OAuth 2.0
  - Maintains backward compatibility with SMTP/SES
  - **Note**: Token invalidation on config change exists via S2S
  - _Requirements: 2.3, 2.5, 2.6, 3.6, 5.6, 6.2, 6.4_

### API Layer
- [x] 3. OAuth 2.0 configuration management endpoints
- [x] 3.1 OAuth 2.0 settings validation and persistence
  - Accepts OAuth 2.0 credentials in API request body
  - Validates email address format
  - Validates non-empty strings for all credentials
  - Enforces field length limits
  - _Requirements: 1.3, 1.4_

- [x] 3.2 OAuth 2.0 settings persistence and S2S messaging
  - Persists credentials via configuration manager
  - Triggers S2S messaging for config updates
  - Returns success response with mailer status
  - Never returns sensitive credentials in GET responses
  - _Requirements: 1.5, 1.6, 5.5, 6.5_

- [x] 3.3 Field-specific validation error messages
  - Generates descriptive error messages per field
  - Returns 400 Bad Request with validation details
  - _Requirements: 1.7_

### Frontend Components
- [x] 4. OAuth 2.0 admin UI components
- [x] 4.1 OAuth 2.0 settings component
  - Created OAuth2Setting component with four input fields
  - Applied password type for sensitive fields
  - Follows SMTP/SES visual patterns
  - Integrated with react-hook-form
  - _Requirements: 1.2, 4.1_

### State Management
- [x] 5. OAuth 2.0 state management integration
- [x] 5.1 AdminAppContainer OAuth 2.0 state
  - Added four state properties for OAuth 2.0 credentials
  - Created state setter methods for each field
  - Preserves credentials when switching transmission methods
  - _Requirements: 4.2, 6.3_

- [x] 5.2 Mail settings form submission
  - Includes OAuth 2.0 credentials in API payload
  - Validates email format before submission
  - Displays success/error toast notifications
  - _Requirements: 1.3, 1.6, 1.7_

- [x] 5.3 Transmission method selection integration
  - Added 'oauth2' to transmission method options
  - Conditionally renders OAuth2Setting component
  - Maintains UI consistency with SMTP/SES
  - _Requirements: 1.1, 1.2_

### Internationalization
- [x] 6. Multi-language support for OAuth 2.0 UI
- [x] 6.1 Translation keys for OAuth 2.0 settings
  - Added translation keys for OAuth 2.0 label and description
  - Added translation keys for all field labels
  - Covered all supported languages (en, ja, fr, ko, zh)
  - **Note**: Help text only exists for 2 of 4 fields
  - _Requirements: 1.2, 4.1, 4.3_

</details>

---

## Deferred Tasks (Optional Enhancements)

<details>
<summary>📋 Click to expand optional/deferred tasks</summary>

These tasks provide additional test coverage and validation but are not blocking for initial production deployment.

### Additional UI Component Tests
- [ ]* 13. OAuth 2.0 UI component rendering tests
  - Test OAuth2Setting component renders with all four input fields
  - Test react-hook-form integration and field registration
  - Test help text displays correctly
  - Test component follows SMTP/SES styling patterns
  - _Requirements: 1.2, 4.1, 4.3_
  - _Priority: P3 (Optional)_

### Additional State Management Tests
- [ ]* 14. AdminAppContainer state management tests
  - Test OAuth 2.0 state properties initialize correctly
  - Test state setter methods update credentials
  - Test OAuth 2.0 credentials included in API payload when method is 'oauth2'
  - Test email validation rejects invalid format
  - Test credentials preserved when switching methods
  - _Requirements: 1.3, 4.2, 6.3_
  - _Priority: P3 (Optional)_

### E2E User Flow Tests
- [ ]* 15. E2E: Credential masking and preservation
  - Test masked credentials display (****abcd format)
  - Test mask clears on field focus
  - Test switching transmission methods preserves credentials
  - _Requirements: 4.2, 4.4, 6.3_
  - _Priority: P3 (Optional)_

- [ ]* 16. E2E: Error handling scenarios
  - Test invalid credentials display error message
  - Test incomplete configuration shows validation errors
  - Test mailer not setup displays alert banner
  - _Requirements: 1.7, 5.1, 6.4_
  - _Priority: P3 (Optional)_

### Backward Compatibility Verification
- [ ]* 17. SMTP and SES regression testing
  - Verify SMTP email sending unchanged
  - Verify SES email sending unchanged
  - Test switching between SMTP, SES, OAuth 2.0 preserves all credentials
  - Test only active transmission method used
  - Test mixed deployment scenarios
  - _Requirements: 6.1, 6.2, 6.3_
  - _Priority: P3 (Optional)_

</details>

---

## Requirements Coverage Summary

**Total Requirements**: 37
**Requirements with Priority Tasks**: 12 (critical for production)
**Requirements Fully Covered by Baseline**: 25

| Phase | Requirements | Coverage |
|-------|--------------|----------|
| Phase A (Critical) | 5.1, 5.2, 5.3, 5.4, 5.7 | Error handling and logging |
| Phase B (Testing) | 2.1-2.6, 3.1-3.6, 5.1-5.5, 6.2, 6.4, 6.5 | Test coverage for all critical paths |
| Phase C (UI Polish) | 4.3, 4.4, 4.5, 4.6 | User experience enhancements |
| Baseline Complete | 1.1-1.7, 2.1, 2.3, 2.5, 3.6, 4.1, 4.2, 5.6, 6.1, 6.3 | Core functionality working |

---

## Execution Guidance

### Quick Start (Recommended)

Execute priority tasks in order:

```bash
# Phase A: Critical Production Requirements (4-6 hours)
/kiro:spec-impl oauth2-email-support 1,2,3 -y

# Phase B: Essential Test Coverage (8-12 hours)
/kiro:spec-impl oauth2-email-support 4,5,6,7,8,9 -y

# Phase C: UI Polish (3-4 hours)
/kiro:spec-impl oauth2-email-support 10,11,12 -y
```

### Context Management

⚠️ **IMPORTANT**: Clear conversation history between phases to avoid context bloat:
- Clear after Phase A before starting Phase B
- Clear after Phase B before starting Phase C
- Each phase is self-contained

### Verification After Each Phase

**After Phase A**:
```bash
# Verify retry logic works
npm test -- mail.spec

# Check error logging
grep -r "sendWithRetry\|storeFailedEmail" apps/app/src/server/service/mail.ts
```

**After Phase B**:
```bash
# Run full test suite
cd apps/app && pnpm test

# Verify coverage
pnpm test -- --coverage
```

**After Phase C**:
```bash
# Manual UI verification
# 1. Start dev server
# 2. Navigate to Admin → App → Mail Settings
# 3. Test OAuth 2.0 configuration with masking
```

---

## Production Readiness Checklist

Before deploying to production, ensure:

- [ ] **Phase A Complete**: Retry logic, failed email storage, enhanced logging implemented
- [ ] **Phase B Complete**: All essential tests passing (mail service, API, E2E config flow)
- [ ] **Phase C Complete**: UI polish (help text, masking, test email) implemented
- [ ] **Integration Tests Pass**: Run `pnpm test` in apps/app with no failures
- [ ] **Manual Verification**: Admin can configure OAuth 2.0 and send test email successfully
- [ ] **Error Handling Verified**: Test with invalid credentials to confirm proper error messages
- [ ] **Backward Compatibility**: Verify existing SMTP/SES functionality unaffected

---

## Notes

**Baseline Implementation Source**: GitHub Copilot (completed Phases 1-6 from original task plan)

**Validation Report Reference**: See `.kiro/specs/oauth2-email-support/validation-report.md` for detailed gap analysis

**Task Numbering**: Renumbered to reflect priority order (1-12 for priority tasks, 13-17 for optional)

**Estimated Total Time**: 15-22 hours for priority tasks (Phases A-C)
