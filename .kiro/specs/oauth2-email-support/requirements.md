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

#### Acceptance Criteria

1. The Admin Settings UI shall provide a new transmission method option "OAuth 2.0 (Google Workspace)" alongside existing SMTP and SES options
2. When OAuth 2.0 transmission method is selected, the Mail Settings interface shall display configuration fields for Email Address, Client ID, Client Secret, and Refresh Token
3. The Mail Settings Service shall validate that Email Address is a valid email format before saving configuration
4. The Mail Settings Service shall validate that Client ID, Client Secret, and Refresh Token are non-empty strings before saving configuration
5. The Mail Settings Service shall securely store OAuth 2.0 credentials in the database with encryption for Client Secret and Refresh Token
6. When configuration is saved successfully, the Mail Settings Service shall confirm save operation to the administrator
7. If configuration save fails, then the Mail Settings Service shall display a descriptive error message indicating which field caused the failure

### Requirement 2: Email Sending Functionality

**Objective:** As a GROWI system, I want to send emails using OAuth 2.0 authenticated Google Workspace accounts, so that notifications and system emails can be delivered securely without SMTP credentials.

#### Acceptance Criteria

1. When OAuth 2.0 is configured as the transmission method, the Email Service shall use nodemailer with Gmail OAuth 2.0 transport for sending emails
2. When sending an email, the Email Service shall authenticate to Gmail API using the configured Client ID, Client Secret, and Refresh Token
3. The Email Service shall set the FROM address to the configured Email Address for all outgoing emails
4. When email is sent successfully, the Email Service shall log the successful transmission with timestamp and recipient information
5. The Email Service shall support sending emails with plain text body, HTML body, attachments, and standard email headers (subject, to, cc, bcc)
6. When multiple emails are queued, the Email Service shall process them sequentially while maintaining OAuth 2.0 session state

### Requirement 3: Token Management

**Objective:** As a GROWI system, I want to automatically manage OAuth 2.0 access token lifecycle, so that email sending continues without manual intervention when tokens expire.

#### Acceptance Criteria

1. The Email Service shall use nodemailer's automatic token refresh mechanism to obtain new access tokens when needed
2. When the refresh token is used, the Email Service shall request a new access token from Google's OAuth 2.0 token endpoint
3. If token refresh succeeds, then the Email Service shall continue with email sending operation using the new access token
4. If token refresh fails due to invalid refresh token, then the Email Service shall log an error and notify administrators of authentication failure
5. The Email Service shall cache access tokens in memory and reuse them until expiration to minimize token refresh requests
6. When OAuth 2.0 configuration is updated, the Email Service shall invalidate cached tokens and re-authenticate on next send operation

### Requirement 4: Admin UI Integration

**Objective:** As a GROWI administrator, I want OAuth 2.0 email configuration to follow the same UI patterns as SMTP and SES, so that I can configure it consistently with existing mail settings.

#### Acceptance Criteria

1. The Mail Settings page shall display OAuth 2.0 configuration form with the same visual styling and layout patterns as SMTP and SES sections
2. When transmission method is changed from OAuth 2.0 to another method, the Mail Settings UI shall preserve entered OAuth 2.0 credentials without deleting them
3. The Mail Settings UI shall provide field-level help text explaining each OAuth 2.0 parameter and how to obtain it from Google Cloud Console
4. When displaying saved OAuth 2.0 configuration, the Mail Settings UI shall mask the Client Secret and Refresh Token fields showing only the last 4 characters
5. The Mail Settings page shall provide a "Test Email" button that sends a test email using the configured OAuth 2.0 settings
6. When test email is sent, the Mail Settings Service shall display success or failure status with detailed error information if sending fails

### Requirement 5: Error Handling and Security

**Objective:** As a GROWI administrator, I want clear error messages and secure credential handling, so that I can troubleshoot configuration issues and ensure credentials are protected.

#### Acceptance Criteria

1. If authentication fails due to invalid credentials, then the Email Service shall log the specific OAuth 2.0 error code and message from Google's API
2. If email sending fails due to network timeout, then the Email Service shall retry the operation up to 3 times with exponential backoff
3. If email sending fails after all retries, then the Email Service shall log the final failure and store the failed email for manual review
4. The Mail Settings Service shall never log or display Client Secret or Refresh Token values in plain text in logs or error messages
5. The Mail Settings Service shall require admin authentication before displaying OAuth 2.0 configuration page
6. If OAuth 2.0 credentials are deleted from configuration, then the Email Service shall immediately stop attempting to send emails via OAuth 2.0 and fall back to default transmission method or display configuration error
7. The Email Service shall validate SSL/TLS certificates when connecting to Google's OAuth 2.0 and Gmail API endpoints

### Requirement 6: Migration and Compatibility

**Objective:** As a GROWI system, I want OAuth 2.0 email support to coexist with existing SMTP and SES configurations, so that administrators can choose the most appropriate transmission method for their deployment.

#### Acceptance Criteria

1. The Mail Settings Service shall maintain backward compatibility with existing SMTP and SES configurations without requiring migration
2. When transmission method is set to OAuth 2.0, the Email Service shall not use SMTP or SES credentials even if they are configured
3. The Mail Settings Service shall allow switching between transmission methods (SMTP, SES, OAuth 2.0) without data loss
4. If no transmission method is configured, then the Email Service shall display a configuration error when attempting to send emails
5. The Mail Settings API shall expose OAuth 2.0 configuration status through existing admin API endpoints following the same schema pattern as SMTP/SES
