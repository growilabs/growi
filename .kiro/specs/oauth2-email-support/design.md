# OAuth 2.0 Email Support - Technical Design

## Overview

This feature adds OAuth 2.0 authentication support for sending emails through Google Workspace accounts in GROWI. Administrators can configure email transmission using OAuth 2.0 credentials (Client ID, Client Secret, Refresh Token) instead of traditional SMTP passwords. This integration extends the existing mail service architecture while maintaining full backward compatibility with SMTP and SES configurations.

**Purpose**: Enable secure, token-based email authentication for Google Workspace accounts, improving security by eliminating password-based SMTP authentication and following Google's recommended practices for application email integration.

**Users**: GROWI administrators configuring email transmission settings will use the new OAuth 2.0 option alongside existing SMTP and SES methods.

**Impact**: Extends the mail service to support a third transmission method (oauth2) without modifying existing SMTP or SES functionality. No breaking changes to existing deployments.

### Goals

- Add OAuth 2.0 as a transmission method option in mail settings
- Support Google Workspace email sending via Gmail API with OAuth 2.0 credentials
- Maintain backward compatibility with existing SMTP and SES configurations
- Provide consistent admin UI experience following SMTP/SES patterns
- Implement automatic OAuth 2.0 token refresh using nodemailer's built-in support
- Ensure secure storage and handling of OAuth 2.0 credentials

### Non-Goals

- OAuth 2.0 providers beyond Google Workspace (Microsoft 365, generic OAuth 2.0 servers)
- Migration tool from SMTP to OAuth 2.0 (administrators manually reconfigure)
- Authorization flow UI for obtaining refresh tokens (documented external process via Google Cloud Console)
- Multi-account or account rotation support (single OAuth 2.0 account per instance)
- Email queuing or rate limiting specific to OAuth 2.0 (relies on existing mail service behavior)

## Architecture

### Existing Architecture Analysis

**Current Mail Service Implementation**:
- **Service Location**: `apps/app/src/server/service/mail.ts` (MailService class)
- **Initialization**: MailService instantiated from Crowi container, loaded on app startup
- **Transmission Methods**: Currently supports 'smtp' and 'ses' via `mail:transmissionMethod` config
- **Factory Pattern**: `createSMTPClient()` and `createSESClient()` create nodemailer transports
- **Configuration**: ConfigManager loads settings from MongoDB via `mail:*` namespace keys
- **S2S Messaging**: Supports distributed config updates via `mailServiceUpdated` events
- **Test Email**: SMTP-only test email functionality in admin UI

**Current Admin UI Structure**:
- **Main Component**: `MailSetting.tsx` - form container with transmission method radio buttons
- **Sub-Components**: `SmtpSetting.tsx`, `SesSetting.tsx` - conditional rendering based on selected method
- **State Management**: AdminAppContainer (unstated) manages form state and API calls
- **Form Library**: react-hook-form for validation and submission
- **API Integration**: `updateMailSettingHandler()` saves all mail settings via REST API

**Integration Points**:
- Config definition in `config-definition.ts` (add OAuth 2.0 keys)
- MailService initialize() method (add OAuth 2.0 branch)
- MailSetting.tsx transmission method array (add 'oauth2' option)
- AdminAppContainer state methods (add OAuth 2.0 credential methods)

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph "Client Layer"
        MailSettingUI[MailSetting Component]
        OAuth2SettingUI[OAuth2Setting Component]
        SmtpSettingUI[SmtpSetting Component]
        SesSettingUI[SesSetting Component]
        AdminContainer[AdminAppContainer]
    end

    subgraph "API Layer"
        AppSettingsAPI[App Settings API]
        MailTestAPI[Mail Test API]
    end

    subgraph "Service Layer"
        MailService[MailService]
        ConfigManager[ConfigManager]
        S2SMessaging[S2S Messaging]
    end

    subgraph "External Services"
        GoogleOAuth[Google OAuth 2.0 API]
        GmailAPI[Gmail API]
        SMTPServer[SMTP Server]
        SESAPI[AWS SES API]
    end

    subgraph "Data Layer"
        MongoDB[(MongoDB Config)]
    end

    MailSettingUI --> AdminContainer
    OAuth2SettingUI --> AdminContainer
    SmtpSettingUI --> AdminContainer
    SesSettingUI --> AdminContainer

    AdminContainer --> AppSettingsAPI
    AdminContainer --> MailTestAPI

    AppSettingsAPI --> ConfigManager
    MailTestAPI --> MailService

    MailService --> ConfigManager
    MailService --> S2SMessaging

    ConfigManager --> MongoDB

    MailService --> GoogleOAuth
    MailService --> GmailAPI
    MailService --> SMTPServer
    MailService --> SESAPI

    S2SMessaging -.->|mailServiceUpdated| MailService
```

**Architecture Integration**:
- **Selected Pattern**: Factory Method Extension - adds `createOAuth2Client()` to existing MailService factory methods
- **Domain Boundaries**:
  - **Client**: Admin UI components for OAuth 2.0 configuration (follows existing SmtpSetting/SesSetting pattern)
  - **Service**: MailService handles all transmission methods; OAuth 2.0 isolated in new factory method
  - **Config**: ConfigManager persists OAuth 2.0 credentials using `mail:oauth2*` namespace
  - **External**: Google OAuth 2.0 API for token management; Gmail API for email transmission
- **Existing Patterns Preserved**:
  - Transmission method selection pattern (radio buttons, conditional rendering)
  - Factory method pattern for transport creation
  - Config namespace pattern (`mail:*` keys)
  - Unstated container state management
  - S2S messaging for distributed config updates
- **New Components Rationale**:
  - **OAuth2Setting Component**: Maintains UI consistency with SMTP/SES; enables modular development
  - **createOAuth2Client() Method**: Isolates OAuth 2.0 transport logic; follows existing factory pattern
  - **Four Config Keys**: Minimal set for OAuth 2.0 (user, clientId, clientSecret, refreshToken)
- **Steering Compliance**:
  - Feature-based organization (mail service domain)
  - Named exports throughout
  - Type safety with explicit TypeScript interfaces
  - Immutable config updates
  - Security-first credential handling

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| Frontend | React 18.x + TypeScript | OAuth2Setting UI component | Existing stack, no new dependencies |
| Frontend | react-hook-form | Form validation and state | Existing dependency, consistent with SmtpSetting/SesSetting |
| Backend | Node.js + TypeScript | MailService OAuth 2.0 integration | Existing runtime, no version changes |
| Backend | nodemailer 6.x | OAuth 2.0 transport creation | Existing dependency with built-in OAuth 2.0 support |
| Data | MongoDB | Config storage for OAuth 2.0 credentials | Existing database, new config keys only |
| External | Google OAuth 2.0 API | Token refresh endpoint | Standard Google API, https://oauth2.googleapis.com/token |
| External | Gmail API | Email transmission via OAuth 2.0 | Accessed via nodemailer Gmail transport |

**Key Technology Decisions**:
- **Nodemailer OAuth 2.0**: Built-in support eliminates need for additional OAuth 2.0 libraries; automatic token refresh reduces complexity
- **No New Dependencies**: Feature fully implemented with existing packages; zero dependency risk
- **MongoDB Encryption**: Credentials stored using existing ConfigManager encryption (same as SMTP passwords)
- **Gmail Service Shortcut**: Nodemailer's `service: "gmail"` simplifies configuration and handles Gmail API specifics

## System Flows

### OAuth 2.0 Configuration Flow

```mermaid
sequenceDiagram
    participant Admin as Administrator
    participant UI as MailSetting UI
    participant Container as AdminAppContainer
    participant API as App Settings API
    participant Config as ConfigManager
    participant DB as MongoDB

    Admin->>UI: Select "oauth2" transmission method
    UI->>UI: Render OAuth2Setting component
    Admin->>UI: Enter OAuth 2.0 credentials
    Admin->>UI: Click Update button
    UI->>Container: handleSubmit formData
    Container->>API: POST app-settings
    API->>API: Validate OAuth 2.0 fields
    alt Validation fails
        API-->>Container: 400 Bad Request
        Container-->>UI: Display error toast
    else Validation passes
        API->>Config: setConfig mail:oauth2*
        Config->>DB: Save encrypted credentials
        DB-->>Config: Success
        Config-->>API: Success
        API-->>Container: 200 OK
        Container-->>UI: Display success toast
    end
```

### Email Sending with OAuth 2.0 Flow

```mermaid
sequenceDiagram
    participant App as GROWI Application
    participant Mail as MailService
    participant Nodemailer as Nodemailer Transport
    participant Google as Google OAuth 2.0 API
    participant Gmail as Gmail API

    App->>Mail: send emailConfig
    Mail->>Mail: Check mailer setup
    alt Mailer not setup
        Mail-->>App: Error Mailer not set up
    else Mailer setup oauth2
        Mail->>Nodemailer: sendMail mailConfig
        Nodemailer->>Nodemailer: Check access token validity
        alt Access token expired
            Nodemailer->>Google: POST token refresh
            Google-->>Nodemailer: New access token
            Nodemailer->>Nodemailer: Cache access token
        end
        Nodemailer->>Gmail: POST send message
        alt Authentication failure
            Gmail-->>Nodemailer: 401 Unauthorized
            Nodemailer-->>Mail: Error Invalid credentials
            Mail-->>App: Error with OAuth 2.0 details
        else Success
            Gmail-->>Nodemailer: 200 OK message ID
            Nodemailer-->>Mail: Success
            Mail->>Mail: Log transmission success
            Mail-->>App: Email sent successfully
        end
    end
```

**Flow-Level Decisions**:
- **Token Refresh**: Handled entirely by nodemailer; MailService does not implement custom refresh logic
- **Error Handling**: OAuth 2.0 errors logged with specific Google API error codes for admin troubleshooting
- **Credential Validation**: Performed at API layer before persisting to database; prevents invalid config states
- **S2S Sync**: OAuth 2.0 config changes trigger `mailServiceUpdated` event for distributed deployments (existing pattern)

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | Add OAuth 2.0 transmission method option | MailSetting.tsx, config-definition.ts | ConfigDefinition | Configuration |
| 1.2 | Display OAuth 2.0 config fields when selected | OAuth2Setting.tsx, MailSetting.tsx | React Props | Configuration |
| 1.3 | Validate email address format | AdminAppContainer, App Settings API | API Contract | Configuration |
| 1.4 | Validate non-empty OAuth 2.0 credentials | AdminAppContainer, App Settings API | API Contract | Configuration |
| 1.5 | Securely store OAuth 2.0 credentials with encryption | ConfigManager, MongoDB | Data Model | Configuration |
| 1.6 | Confirm successful configuration save | AdminAppContainer, MailSetting.tsx | API Contract | Configuration |
| 1.7 | Display descriptive error messages on save failure | AdminAppContainer, MailSetting.tsx | API Contract | Configuration |
| 2.1 | Use nodemailer Gmail OAuth 2.0 transport | MailService.createOAuth2Client() | Service Interface | Email Sending |
| 2.2 | Authenticate to Gmail API with OAuth 2.0 | MailService.createOAuth2Client() | External API | Email Sending |
| 2.3 | Set FROM address to configured email | MailService.setupMailConfig() | Service Interface | Email Sending |
| 2.4 | Log successful email transmission | MailService.send() | Service Interface | Email Sending |
| 2.5 | Support all email content types | MailService.send() (existing) | Service Interface | Email Sending |
| 2.6 | Process email queue sequentially | MailService.send() (existing) | Service Interface | Email Sending |
| 3.1 | Use nodemailer automatic token refresh | Nodemailer OAuth 2.0 transport | External Library | Email Sending |
| 3.2 | Request new access token with refresh token | Nodemailer OAuth 2.0 transport | External API | Email Sending |
| 3.3 | Continue email sending after token refresh | Nodemailer OAuth 2.0 transport | External Library | Email Sending |
| 3.4 | Log error and notify admin on refresh failure | MailService.send(), Error Handler | Service Interface | Email Sending |
| 3.5 | Cache access tokens in memory | Nodemailer OAuth 2.0 transport | External Library | Email Sending |
| 3.6 | Invalidate cached tokens on config update | MailService.initialize() | Service Interface | Configuration |
| 4.1 | Display OAuth 2.0 form with consistent styling | OAuth2Setting.tsx | React Component | Configuration |
| 4.2 | Preserve OAuth 2.0 credentials when switching methods | AdminAppContainer state | State Management | Configuration |
| 4.3 | Provide field-level help text | OAuth2Setting.tsx | React Component | Configuration |
| 4.4 | Mask sensitive fields (last 4 characters) | OAuth2Setting.tsx | React Component | Configuration |
| 4.5 | Provide test email button | MailSetting.tsx | API Contract | Email Sending |
| 4.6 | Display test email result with detailed errors | AdminAppContainer, MailSetting.tsx | API Contract | Email Sending |
| 5.1 | Log specific OAuth 2.0 error codes | MailService error handler | Service Interface | Email Sending |
| 5.2 | Retry email sending with exponential backoff | MailService.send() | Service Interface | Email Sending |
| 5.3 | Store failed emails after all retries | MailService.send() | Service Interface | Email Sending |
| 5.4 | Never log credentials in plain text | MailService, ConfigManager | Security Pattern | All flows |
| 5.5 | Require admin authentication for config page | App Settings API | API Contract | Configuration |
| 5.6 | Stop OAuth 2.0 sending when credentials deleted | MailService.initialize() | Service Interface | Email Sending |
| 5.7 | Validate SSL/TLS for OAuth 2.0 endpoints | Nodemailer OAuth 2.0 transport | External Library | Email Sending |
| 6.1 | Maintain backward compatibility with SMTP/SES | MailService, config-definition.ts | All Interfaces | All flows |
| 6.2 | Use only active transmission method | MailService.initialize() | Service Interface | Email Sending |
| 6.3 | Allow switching transmission methods without data loss | AdminAppContainer, ConfigManager | State Management | Configuration |
| 6.4 | Display configuration error if no method set | MailService, MailSetting.tsx | Service Interface | Configuration |
| 6.5 | Expose OAuth 2.0 status via admin API | App Settings API | API Contract | Configuration |

## Components and Interfaces

### Component Summary

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies (P0/P1) | Contracts |
|-----------|--------------|--------|--------------|--------------------------|-----------|
| MailService | Server/Service | Email transmission with OAuth 2.0 support | 2.1-2.6, 3.1-3.6, 5.1-5.7, 6.2, 6.4 | ConfigManager (P0), Nodemailer (P0), S2SMessaging (P1) | Service |
| OAuth2Setting | Client/UI | OAuth 2.0 credential input form | 1.2, 4.1, 4.3, 4.4 | AdminAppContainer (P0), react-hook-form (P0) | State |
| AdminAppContainer | Client/State | State management for mail settings | 1.3, 1.4, 1.6, 1.7, 4.2, 6.3 | App Settings API (P0) | API |
| ConfigManager | Server/Service | Persist OAuth 2.0 credentials | 1.5, 6.1, 6.3 | MongoDB (P0) | Service, State |
| App Settings API | Server/API | Mail settings CRUD operations | 1.3-1.7, 4.5-4.6, 5.5, 6.5 | ConfigManager (P0), MailService (P1) | API |
| Config Definition | Server/Config | OAuth 2.0 config schema | 1.1, 6.1 | None | State |

### Server / Service Layer

#### MailService

| Field | Detail |
|-------|--------|
| Intent | Extend email transmission service with OAuth 2.0 support using Gmail API |
| Requirements | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 6.2, 6.4 |
| Owner / Reviewers | Backend team |

**Responsibilities & Constraints**
- Create OAuth 2.0 nodemailer transport using Gmail service with credentials from ConfigManager
- Handle OAuth 2.0 authentication failures and token refresh errors with specific error logging
- Implement retry logic with exponential backoff (1s, 2s, 4s) for transient failures
- Store failed emails after all retry attempts for manual review
- Maintain single active transmission method (smtp, ses, or oauth2) per instance
- Invalidate cached OAuth 2.0 tokens when configuration changes via S2S messaging

**Dependencies**
- Inbound: Crowi container — service initialization (P0)
- Inbound: Application modules — email sending requests (P0)
- Inbound: S2S Messaging — config update notifications (P1)
- Outbound: ConfigManager — load OAuth 2.0 credentials (P0)
- Outbound: Nodemailer — create transport and send emails (P0)
- External: Google OAuth 2.0 API — token refresh (P0)
- External: Gmail API — email transmission (P0)

**Contracts**: Service [x]

##### Service Interface

```typescript
interface MailServiceOAuth2Extension {
  /**
   * Create OAuth 2.0 nodemailer transport for Gmail
   */
  createOAuth2Client(option?: OAuth2TransportOptions): Transporter | null;

  /**
   * Send email with retry logic and error handling
   */
  sendWithRetry(config: EmailConfig, maxRetries?: number): Promise<SendResult>;

  /**
   * Store failed email for manual review
   */
  storeFailedEmail(config: EmailConfig, error: Error): Promise<void>;

  /**
   * Wait with exponential backoff
   */
  exponentialBackoff(attempt: number): Promise<void>;
}

interface OAuth2TransportOptions {
  user: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface MailService {
  send(config: EmailConfig): Promise<void>;
  initialize(): void;
  isMailerSetup: boolean;
}

interface EmailConfig {
  to: string;
  from?: string;
  subject?: string;
  template: string;
  vars?: Record<string, unknown>;
}

interface SendResult {
  messageId: string;
  response: string;
  envelope: {
    from: string;
    to: string[];
  };
}
```

- **Preconditions**:
  - ConfigManager loaded with valid `mail:oauth2*` configuration values
  - Nodemailer package version supports OAuth 2.0 (v6.x+)
  - Google OAuth 2.0 refresh token has `https://mail.google.com/` scope

- **Postconditions**:
  - OAuth 2.0 transport created with automatic token refresh enabled
  - `isMailerSetup` flag set to true when transport successfully created
  - Failed transport creation returns null and logs error
  - Successful email sends logged with messageId and recipient
  - Failed emails stored after retry exhaustion

- **Invariants**:
  - Only one transmission method active at a time
  - Credentials never logged in plain text
  - Token refresh handled transparently by nodemailer
  - Retry backoff: 1s, 2s, 4s

**Implementation Notes**
- **Integration**: Add OAuth 2.0 branch to initialize() method
- **Validation**: createOAuth2Client() validates all four credentials present
- **Error Handling**:
  - Extract Google API error codes (invalid_grant, insufficient_permission)
  - Log context: error, code, user, clientId (last 4 chars), timestamp
  - Implement sendWithRetry() wrapper with exponential backoff
  - Store failed emails in MongoDB failedEmails collection
- **Token Refresh**: Nodemailer handles refresh automatically
- **Encryption**: Credentials loaded from ConfigManager (handles decryption)
- **Testing**: Mock nodemailer OAuth 2.0 transport; test invalid credentials, expired tokens, network failures, retry logic
- **Risks**: Google rate limiting (mitigated by backoff), refresh token revocation (logged for admin action)

#### ConfigManager

| Field | Detail |
|-------|--------|
| Intent | Persist and retrieve OAuth 2.0 credentials with encryption |
| Requirements | 1.5, 6.1, 6.3 |

**Responsibilities & Constraints**
- Store four new OAuth 2.0 config keys with encryption
- Support transmission method value 'oauth2'
- Maintain all SMTP and SES config values when OAuth 2.0 is configured

**Dependencies**
- Inbound: MailService, App Settings API (P0)
- Outbound: MongoDB, Encryption Service (P0)

**Contracts**: Service [x] / State [x]

##### Service Interface

```typescript
interface ConfigManagerOAuth2Extension {
  getConfig(key: 'mail:oauth2User'): string | undefined;
  getConfig(key: 'mail:oauth2ClientId'): string | undefined;
  getConfig(key: 'mail:oauth2ClientSecret'): string | undefined;
  getConfig(key: 'mail:oauth2RefreshToken'): string | undefined;
  getConfig(key: 'mail:transmissionMethod'): 'smtp' | 'ses' | 'oauth2' | undefined;

  setConfig(key: 'mail:oauth2User', value: string): Promise<void>;
  setConfig(key: 'mail:oauth2ClientId', value: string): Promise<void>;
  setConfig(key: 'mail:oauth2ClientSecret', value: string): Promise<void>;
  setConfig(key: 'mail:oauth2RefreshToken', value: string): Promise<void>;
  setConfig(key: 'mail:transmissionMethod', value: 'smtp' | 'ses' | 'oauth2'): Promise<void>;
}
```

##### State Management

- **State Model**: OAuth 2.0 credentials stored as separate config documents in MongoDB
- **Persistence**: Encrypted at write time; decrypted at read time
- **Consistency**: Atomic writes per config key
- **Concurrency**: Last-write-wins; S2S messaging for eventual consistency

**Implementation Notes**
- Add config definitions following mail:smtp* pattern
- Use isSecret: true for clientSecret and refreshToken
- Define transmissionMethod as 'smtp' | 'ses' | 'oauth2' | undefined

### Client / UI Layer

#### OAuth2Setting Component

| Field | Detail |
|-------|--------|
| Intent | Render OAuth 2.0 credential input form with help text and field masking |
| Requirements | 1.2, 4.1, 4.3, 4.4 |

**Responsibilities & Constraints**
- Display four input fields with help text
- Mask saved Client Secret and Refresh Token (show last 4 characters)
- Follow SMTP/SES visual patterns
- Use react-hook-form register

**Dependencies**
- Inbound: MailSetting component (P0)
- Outbound: AdminAppContainer (P1)
- External: react-hook-form (P0)

**Contracts**: State [x]

##### State Management

```typescript
interface OAuth2SettingProps {
  register: UseFormRegister<MailSettingsFormData>;
  adminAppContainer?: AdminAppContainer;
}

interface MailSettingsFormData {
  fromAddress: string;
  transmissionMethod: 'smtp' | 'ses' | 'oauth2';
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  sesAccessKeyId: string;
  sesSecretAccessKey: string;
  oauth2User: string;
  oauth2ClientId: string;
  oauth2ClientSecret: string;
  oauth2RefreshToken: string;
}
```

**Implementation Notes**
- **Help Text**: Include for all four fields
  - oauth2User: "The email address of the authorized Google account"
  - oauth2ClientId: "Obtain from Google Cloud Console → APIs & Services → Credentials"
  - oauth2ClientSecret: "Found in the same OAuth 2.0 Client ID details page"
  - oauth2RefreshToken: "The refresh token obtained from OAuth 2.0 authorization flow"
- **Field Masking**:
  - Display ****abcd (last 4 characters) when field not edited
  - Clear mask on focus for full edit
  - Applies to oauth2ClientSecret, oauth2RefreshToken

#### AdminAppContainer (Extension)

| Field | Detail |
|-------|--------|
| Intent | Manage OAuth 2.0 credential state and API interactions |
| Requirements | 1.3, 1.4, 1.6, 1.7, 4.2, 6.3 |

**Responsibilities & Constraints**
- Add four state properties and setter methods
- Include OAuth 2.0 credentials in API payload
- Validate email format before API call
- Display success/error toasts

**Dependencies**
- Inbound: MailSetting, OAuth2Setting (P0)
- Outbound: App Settings API (P0)

**Contracts**: State [x] / API [x]

##### State Management

```typescript
interface AdminAppContainerOAuth2State {
  fromAddress?: string;
  transmissionMethod?: 'smtp' | 'ses' | 'oauth2';
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPassword?: string;
  sesAccessKeyId?: string;
  sesSecretAccessKey?: string;
  isMailerSetup: boolean;
  oauth2User?: string;
  oauth2ClientId?: string;
  oauth2ClientSecret?: string;
  oauth2RefreshToken?: string;
}

interface AdminAppContainerOAuth2Methods {
  changeOAuth2User(oauth2User: string): Promise<void>;
  changeOAuth2ClientId(oauth2ClientId: string): Promise<void>;
  changeOAuth2ClientSecret(oauth2ClientSecret: string): Promise<void>;
  changeOAuth2RefreshToken(oauth2RefreshToken: string): Promise<void>;
  updateMailSettingHandler(): Promise<void>;
}
```

**Implementation Notes**
- Add OAuth 2.0 state properties to constructor
- Follow pattern of existing changeSmtpHost() methods
- Email validation: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
- Field-specific error messages in toast

### Server / API Layer

#### App Settings API (Extension)

| Field | Detail |
|-------|--------|
| Intent | Handle OAuth 2.0 credential CRUD operations with validation |
| Requirements | 1.3, 1.4, 1.5, 1.6, 1.7, 4.5, 4.6, 5.5, 6.5 |

**Responsibilities & Constraints**
- Accept OAuth 2.0 credentials in PUT request
- Validate email format and non-empty credentials
- Persist via ConfigManager
- Trigger S2S messaging
- Require admin authentication

**Dependencies**
- Inbound: AdminAppContainer (P0)
- Outbound: ConfigManager, MailService, S2S Messaging (P0/P1)

**Contracts**: API [x]

##### API Contract

| Method | Endpoint | Request | Response | Errors |
|--------|----------|---------|----------|--------|
| PUT | /api/v3/app-settings | UpdateMailSettingsRequest | AppSettingsResponse | 400, 401, 500 |
| GET | /api/v3/app-settings | - | AppSettingsResponse | 401, 500 |
| POST | /api/v3/mail/send-test | - | TestEmailResponse | 400, 401, 500 |

**Request/Response Schemas**:

```typescript
interface UpdateMailSettingsRequest {
  'mail:from'?: string;
  'mail:transmissionMethod'?: 'smtp' | 'ses' | 'oauth2';
  'mail:smtpHost'?: string;
  'mail:smtpPort'?: string;
  'mail:smtpUser'?: string;
  'mail:smtpPassword'?: string;
  'mail:sesAccessKeyId'?: string;
  'mail:sesSecretAccessKey'?: string;
  'mail:oauth2User'?: string;
  'mail:oauth2ClientId'?: string;
  'mail:oauth2ClientSecret'?: string;
  'mail:oauth2RefreshToken'?: string;
}

interface AppSettingsResponse {
  appSettings: {
    'mail:from'?: string;
    'mail:transmissionMethod'?: 'smtp' | 'ses' | 'oauth2';
    'mail:smtpHost'?: string;
    'mail:smtpPort'?: string;
    'mail:smtpUser'?: string;
    'mail:sesAccessKeyId'?: string;
    'mail:oauth2User'?: string;
    'mail:oauth2ClientId'?: string;
  };
  isMailerSetup: boolean;
}

interface TestEmailResponse {
  success: boolean;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}
```

**Validation Rules**:
- oauth2User: Email regex /^[^\s@]+@[^\s@]+\.[^\s@]+$/
- oauth2ClientId: Non-empty string, max 1024 characters
- oauth2ClientSecret: Non-empty string, max 1024 characters
- oauth2RefreshToken: Non-empty string, max 2048 characters
- When transmissionMethod is oauth2, all four fields required

**Implementation Notes**
- Never return oauth2ClientSecret or oauth2RefreshToken in GET response
- Call mailService.publishUpdatedMessage() after config save
- Support OAuth 2.0 in test email functionality
- Field-specific validation error messages

### Server / Config Layer

#### Config Definition (Extension)

| Field | Detail |
|-------|--------|
| Intent | Define OAuth 2.0 configuration schema with type safety |
| Requirements | 1.1, 6.1 |

**Config Schema**:

```typescript
const CONFIG_KEYS = [
  'mail:oauth2User',
  'mail:oauth2ClientId',
  'mail:oauth2ClientSecret',
  'mail:oauth2RefreshToken',
];

'mail:transmissionMethod': defineConfig<'smtp' | 'ses' | 'oauth2' | undefined>({
  defaultValue: undefined,
}),

'mail:oauth2User': defineConfig<string | undefined>({
  defaultValue: undefined,
}),
'mail:oauth2ClientId': defineConfig<string | undefined>({
  defaultValue: undefined,
}),
'mail:oauth2ClientSecret': defineConfig<string | undefined>({
  defaultValue: undefined,
  isSecret: true,
}),
'mail:oauth2RefreshToken': defineConfig<string | undefined>({
  defaultValue: undefined,
  isSecret: true,
}),
```

## Data Models

### Domain Model

**Mail Configuration Aggregate**:
- **Root Entity**: MailConfiguration
- **Value Objects**: TransmissionMethod, OAuth2Credentials, SmtpCredentials, SesCredentials
- **Business Rules**: Only one transmission method active; OAuth2Credentials complete when all fields present
- **Invariants**: Credentials encrypted; FROM address required

### Logical Data Model

**Structure Definition**:
- **Entity**: Config (MongoDB document)
- **Attributes**: ns, key, value, createdAt, updatedAt
- **Natural Keys**: ns field (unique)

**Consistency & Integrity**:
- **Transaction Boundaries**: Each config key saved independently
- **Temporal Aspects**: updatedAt tracked per entry

### Physical Data Model

```typescript
interface ConfigDocument {
  ns: string;
  key: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}

interface FailedEmailDocument {
  emailConfig: {
    to: string;
    from: string;
    subject: string;
    template: string;
    vars: Record<string, unknown>;
  };
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
  transmissionMethod: 'smtp' | 'ses' | 'oauth2';
  attempts: number;
  lastAttemptAt: Date;
  createdAt: Date;
}
```

**Index Definitions**:
- Config ns field (unique)
- FailedEmail createdAt field

**Encryption Strategy**:
- AES-256 for clientSecret and refreshToken
- Encryption key from environment variable

### Data Contracts & Integration

**API Data Transfer**:
- OAuth 2.0 credentials via JSON in PUT /api/v3/app-settings
- Client Secret and Refresh Token never returned in GET responses

**Cross-Service Data Management**:
- S2S messaging broadcasts mailServiceUpdated event
- Eventual consistency across instances

## Error Handling

### Error Strategy

**Retry Strategy**: Exponential backoff with 3 attempts (1s, 2s, 4s) for transient failures

**Failed Email Storage**: After retry exhaustion, store in MongoDB failedEmails collection

### Error Categories and Responses

**User Errors (4xx)**:
- Invalid Email Format: 400 "OAuth 2.0 User Email must be valid email format"
- Missing Credentials: 400 "OAuth 2.0 Client ID, Client Secret, and Refresh Token are required"
- Unauthorized: 401 "Admin authentication required"

**System Errors (5xx)**:
- Token Refresh Failure: Log with Google API error code
- Network Timeout: Retry with exponential backoff
- Account Suspension: Log critical error with full context
- Encryption Failure: 500 "Failed to encrypt OAuth 2.0 credentials"

**Business Logic Errors (422)**:
- Incomplete Configuration: isMailerSetup = false, display alert banner
- Invalid Refresh Token: Log error code invalid_grant

### Error Handling Implementation

```typescript
async sendWithRetry(config: EmailConfig, maxRetries = 3): Promise<SendResult> {
  const backoffIntervals = [1000, 2000, 4000];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await this.mailer.sendMail(config);
      logger.info('OAuth 2.0 email sent successfully', {
        messageId: result.messageId,
        recipient: config.to,
        attempt,
      });
      return result;
    } catch (error) {
      logger.error(`OAuth 2.0 email send failed (attempt ${attempt}/${maxRetries})`, {
        error: error.message,
        code: error.code,
        user: config.from,
        recipient: config.to,
        attemptNumber: attempt,
        timestamp: new Date().toISOString(),
      });

      if (attempt === maxRetries) {
        await this.storeFailedEmail(config, error);
        throw new Error(`OAuth 2.0 email send failed after ${maxRetries} attempts`);
      }

      await this.exponentialBackoff(attempt);
    }
  }
}

async exponentialBackoff(attempt: number): Promise<void> {
  const backoffIntervals = [1000, 2000, 4000];
  const delay = backoffIntervals[attempt - 1] || 4000;
  return new Promise(resolve => setTimeout(resolve, delay));
}

async storeFailedEmail(config: EmailConfig, error: Error): Promise<void> {
  const failedEmail = {
    emailConfig: config,
    error: {
      message: error.message,
      code: (error as any).code,
      stack: error.stack,
    },
    transmissionMethod: 'oauth2',
    attempts: 3,
    lastAttemptAt: new Date(),
    createdAt: new Date(),
  };

  await this.crowi.model('FailedEmail').create(failedEmail);
}
```

### Monitoring

- All OAuth 2.0 errors logged with context
- Error codes tagged: oauth2_token_refresh_failure, oauth2_invalid_credentials, gmail_api_error
- isMailerSetup flag exposed in admin UI
- Never log clientSecret or refreshToken in plain text

## Testing Strategy

### Unit Tests

- createOAuth2Client() with valid/missing/invalid credentials
- initialize() sets isMailerSetup correctly
- sendWithRetry() succeeds, retries, logs errors
- exponentialBackoff() waits correct intervals
- storeFailedEmail() creates document
- ConfigManager encryption/decryption
- AdminAppContainer state methods

### Integration Tests

- End-to-end email send with mocked transport
- Token refresh triggered
- Retry logic on failures
- Failed email storage
- OAuth2Setting component rendering
- Field masking display
- API validation

### E2E Tests

**Happy Path**:
1. Navigate to Mail Settings
2. Select OAuth 2.0
3. Enter credentials
4. Click Update
5. Verify success toast
6. Send test email
7. Verify success

**Credential Masking**:
1. Navigate to Mail Settings
2. Select OAuth 2.0
3. Verify masked values (****abcd)
4. Focus field, verify mask clears

**Method Switching**:
1. Configure OAuth 2.0
2. Switch to SMTP
3. Switch back to OAuth 2.0
4. Verify credentials preserved

**Invalid Credentials**:
1. Send test email with invalid token
2. Verify error message
3. Check logs for error code

**Network Timeout**:
1. Send email, mock timeout
2. Verify 3 retry attempts
3. Verify correct backoff intervals

**Incomplete Config**:
1. Enter partial OAuth 2.0 config
2. Verify validation error
3. Verify alert banner

### Performance Tests

- 100 emails with OAuth 2.0: verify 1-2 token refreshes
- Token refresh latency < 2s
- Config load < 100ms

## Security Considerations

### Threat Modeling

- Credential Exposure: Encrypted at rest
- Log Leakage: Filters prevent plain text output
- Unauthorized Access: Admin authentication required
- MITM: SSL/TLS validation enforced
- Token Replay: Short-lived access tokens

### Data Protection

- Client Secret: Encrypted, never logged, masked (last 4), never returned
- Refresh Token: Encrypted, never logged, masked (last 4), never returned
- Access Token: Cached in memory, expires in 1 hour
- User Email: Plain text, used for logging

### Compliance

- A02:2021 Cryptographic Failures: AES-256 encryption
- A03:2021 Injection: Email validation
- A07:2021 Auth Failures: Admin authentication required
- A09:2021 Logging Failures: Context logged, no credentials

## Migration Strategy

### Backward Compatibility

- Zero breaking changes
- Existing SMTP/SES unmodified
- OAuth 2.0 added as new option

### Rollback Plan

- Revert code removes OAuth 2.0 option
- SMTP/SES configs unaffected
- OAuth 2.0 configs remain in database

### Deployment Checklist

**Pre-Deployment**:
- Run test suite
- Verify nodemailer v6.x+
- Confirm encryption key
- Review Gmail API quotas

**Post-Deployment**:
- Verify OAuth 2.0 option appears
- Test OAuth 2.0 credentials
- Monitor logs 24 hours
- Update documentation

**Production Validation**:
- Send test email
- Confirm token refresh after 1 hour
- Verify encryption in MongoDB
- Test method switching
