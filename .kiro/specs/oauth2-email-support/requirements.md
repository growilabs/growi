# Requirements Document

## Project Description (Input)
OAuth 2.0 authentication で Google Workspace を利用し email を送信する機能を追加したい

### Context from User
This implementation adds OAuth 2.0 authentication support for sending emails using Google Workspace accounts. The feature is fully integrated into the admin settings UI and follows the existing patterns for SMTP and SES configuration.

Key configuration parameters:
- Email Address: The authorized Google account email
- Client ID: OAuth 2.0 Client ID from Google Cloud Console
- Client Secret: OAuth 2.0 Client Secret
- Refresh Token: OAuth 2.0 Refresh Token obtained from authorization flow

The implementation uses nodemailer's built-in Gmail OAuth 2.0 support, which handles token refresh automatically.

## Introduction

This specification defines the requirements for adding OAuth 2.0 authentication support for email transmission using Google Workspace accounts in GROWI. The feature enables administrators to configure email sending through Google's Gmail API using OAuth 2.0 credentials instead of traditional SMTP authentication. This provides enhanced security through token-based authentication and follows Google's recommended practices for application email integration.

## Requirements

### Requirement 1: OAuth 2.0 Configuration Management

**Objective:** As a GROWI administrator, I want to configure OAuth 2.0 credentials for Google Workspace email sending, so that the system can securely send emails without using SMTP passwords.

**Summary**: The Admin Settings UI provides OAuth 2.0 as a transmission method option alongside SMTP and SES. The configuration form includes fields for Email Address, Client ID, Client Secret, and Refresh Token. All fields are validated (email format, non-empty strings using falsy checks), and secrets are encrypted before database storage. Configuration updates preserve existing secrets when empty values are submitted, preventing accidental credential overwrites. Success and error feedback is displayed to administrators.

### Requirement 2: Email Sending Functionality

**Objective:** As a GROWI system, I want to send emails using OAuth 2.0 authenticated Google Workspace accounts, so that notifications and system emails can be delivered securely without SMTP credentials.

**Summary**: The Email Service uses nodemailer with Gmail OAuth 2.0 transport for email sending when OAuth 2.0 is configured. Authentication to Gmail API is automatic using configured credentials. The service supports all email content types (plain text, HTML, attachments, standard headers). Successful transmissions are logged with timestamp and recipient information. OAuth 2.0 sends use retry logic with exponential backoff (1s, 2s, 4s) to handle transient failures. Note: Gmail API rewrites FROM address to the authenticated account unless send-as aliases are configured in Google Workspace.

### Requirement 3: Token Management

**Objective:** As a GROWI system, I want to automatically manage OAuth 2.0 access token lifecycle, so that email sending continues without manual intervention when tokens expire.

**Summary**: Token refresh is handled automatically by nodemailer's built-in OAuth 2.0 support. Access tokens are cached in memory and reused until expiration. When refresh tokens are used, nodemailer requests new access tokens from Google's OAuth 2.0 endpoint transparently. Token refresh failures are logged with specific error codes for troubleshooting. When OAuth 2.0 configuration is updated, cached tokens are invalidated via service reinitialization triggered by S2S messaging.

### Requirement 4: Admin UI Integration

**Objective:** As a GROWI administrator, I want OAuth 2.0 email configuration to follow the same UI patterns as SMTP and SES, so that I can configure it consistently with existing mail settings.

**Summary**: The Mail Settings page displays OAuth 2.0 configuration form with consistent visual styling, preserves credentials when switching transmission methods, and shows configuration status. Browser autofill is prevented for secret fields, and placeholder text indicates that blank fields will preserve existing values.

### Requirement 5: Error Handling and Security

**Objective:** As a GROWI administrator, I want clear error messages and secure credential handling, so that I can troubleshoot configuration issues and ensure credentials are protected.

**Summary**: Authentication failures are logged with specific OAuth 2.0 error codes from Google's API for troubleshooting. Email sending failures trigger automatic retry with exponential backoff (3 attempts: 1s, 2s, 4s). Failed emails after retry exhaustion are stored in the database for manual review. Credentials are never logged in plain text (Client ID masked to last 4 characters). Admin authentication is required to access configuration. SSL/TLS validation is enforced by nodemailer. When OAuth 2.0 credentials are incomplete or deleted, the Email Service stops sending and displays configuration errors via isMailerSetup flag.

### Requirement 6: Migration and Compatibility

**Objective:** As a GROWI system, I want OAuth 2.0 email support to coexist with existing SMTP and SES configurations, so that administrators can choose the most appropriate transmission method for their deployment.

**Summary**: OAuth 2.0 is added as a third transmission method option without breaking changes to existing SMTP and SES functionality. Only the active transmission method is used for sending emails. Administrators can switch between methods without data loss (credentials for all methods are preserved). Configuration errors are displayed when no transmission method is properly configured (via isMailerSetup flag). OAuth 2.0 configuration status is exposed through existing admin API endpoints following the same pattern as SMTP/SES.
