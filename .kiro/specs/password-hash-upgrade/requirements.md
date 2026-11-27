# Requirements Document

## Project Description (Input)
Improve the hashing algorithm for user passwords. Read the contents of the CodeQL alert and revise the password generation logic, implement a migration script, and account for the case where the system is downgraded to a version earlier than the release version. Please be mindful of backward compatibility for already-installed systems.

## Introduction

The current GROWI local authentication stores passwords as `SHA-256(PASSWORD_SEED + plaintext)` and does not have a per-user salt. CodeQL detects this as a weak cryptographic hash used for password storage. This feature achieves a migration to a memory-hard adaptive KDF (`node:crypto`'s scrypt) and maintains backward compatibility for existing installed systems: a user keeps their password and is migrated on their next successful login (lazy migration). The legacy hash is removed in the same step, so no user holds both formats and the weak hash disappears from the database as the migration progresses. Returning to a version that predates this feature is supported by restoring the database backup taken before the upgrade.

## Boundary Context

- **In scope**: Improving the password hashing algorithm for local authentication (username/password), lazy migration (automatic re-hashing at login time, retiring the legacy hash in the same step), and a read-only migration status report script
- **Out of scope**: External authentication providers such as LDAP, OAuth, SAML, and Passkey; improving the hashing of the `apiToken` field; immediate removal of the `PASSWORD_SEED` environment variable; supporting a rollback that keeps the upgraded database and reverts only the program (see Requirement 4)
- **Adjacent expectations**: The `PASSWORD_SEED` environment variable must remain set for as long as any user still holds a legacy SHA-256 hash, because verifying that hash depends on it. A legacy hash is removed only when that user next uses their local password, so users who authenticate solely through an external provider, users who are not active, and users who never return keep theirs indefinitely — on many installations the seed and those weak hashes stay permanently, and the status report (Requirement 3) is how an administrator sees how many remain. No released version of GROWI writes both hash formats to the same user: earlier versions never stored an adaptive-KDF hash, and this version removes the legacy hash whenever it stores one (Requirements 1.5 and 2.2)

## Requirements

### Requirement 1: Applying an adaptive KDF to new passwords

**Objective:** As a GROWI system administrator, I want newly set or changed passwords to use an industry-standard adaptive KDF, so that the CodeQL alert is resolved and resistance to GPU brute-force attacks is ensured.

#### Acceptance Criteria

1. When a user sets or changes a password, the GROWI authentication system shall hash the password using a memory-hard adaptive KDF (`node:crypto`'s scrypt, at or above OWASP-recommended parameters) and a per-user random salt.
2. The GROWI authentication system shall store the hash in a self-describing format (e.g., `scrypt$N$r$p$<salt>$<hash>`) that embeds the algorithm identifier, the parameters (N/r/p), and the salt, so that the algorithm and parameters can be detected without external metadata.
3. When a new password is set, the GROWI authentication system shall not use the legacy SHA-256+PASSWORD_SEED scheme to store the hash.
4. The GROWI authentication system shall guarantee, by means of the per-user random salt, that different hashes are generated from the same plaintext password.
5. When a user sets, changes, or resets a password, the GROWI authentication system shall remove any legacy SHA-256 hash that user held, so that a replaced password can no longer authenticate.

### Requirement 2: Backward compatibility with existing SHA-256 hashed passwords

**Objective:** As an existing GROWI user, I want to log in without resetting my password even after the upgrade, so that I can continue using the service without interruption during the migration period.

#### Acceptance Criteria

1. When a user with a legacy SHA-256 hashed password submits their login credentials, the GROWI authentication system shall verify the submitted password using the legacy SHA-256+PASSWORD_SEED scheme.
2. When a user successfully authenticates via the legacy SHA-256 verification path, the GROWI authentication system shall, within the same login transaction, re-hash the password with the new adaptive KDF, store that hash, and remove the legacy SHA-256 hash, so that no user holds both formats at once.
3. While users with legacy-format hashes and users with new-format hashes coexist in the system, the GROWI authentication system shall handle both formats transparently without requiring any user-side action.
4. If the stored hash field exists but its content matches neither known format (the `scrypt$…` prefix nor SHA-256 hex) — an abnormal case such as data corruption — then the GROWI authentication system shall reject the login attempt and emit a structured log entry including the user identifier at the WARNING level.
5. When a user with no password set (both the `password` and `passwordHash` fields absent — the normal state for external-authentication-only users or not-yet-activated users) attempts a local login, the GROWI authentication system shall reject the login attempt but shall not emit a WARNING log, because this is a normal case (each field holds exactly one format, so the absence of both means "not set" rather than "indeterminate").

### Requirement 3: Migration status reporting

**Objective:** As a GROWI system administrator, I want to see how far the migration has progressed, so that I know how many users still authenticate against a weak hash and whether the `PASSWORD_SEED` environment variable is still needed.

#### Acceptance Criteria

1. The GROWI migration system shall provide a status migration script that reports the number of users per hash format (legacy SHA-256 only, new adaptive KDF only, no password set) without modifying data.
2. When an administrator runs the status migration script, the GROWI migration system shall output the counts to standard output in a human-readable format.

### Requirement 4: Returning to a version without adaptive-KDF support

**Objective:** As a GROWI system administrator, I want one documented way to return to a version that predates this feature, so that I can plan the upgrade knowing what a rollback costs.

#### Acceptance Criteria

1. Where an administrator needs to run a version that cannot verify the new adaptive-KDF format, the GROWI upgrade documentation shall state that the supported procedure is to restore the database backup taken before the upgrade (changes made after the upgrade are lost), and that reverting the program alone while keeping the upgraded database leaves every user who has set, changed, or used their password since the upgrade without a legacy SHA-256 hash, so that those users can only recover by setting a new password through the password reset flow.
