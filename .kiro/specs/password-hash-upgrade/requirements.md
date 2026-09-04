# Requirements Document

## Project Description (Input)
Improve the hashing algorithm for user passwords. Read the contents of the CodeQL alert and revise the password generation logic, implement a migration script, and account for the case where the system is downgraded to a version earlier than the release version. Please be mindful of backward compatibility for already-installed systems.

## Introduction

The current GROWI local authentication stores passwords as `SHA-256(PASSWORD_SEED + plaintext)` and does not have a per-user salt. CodeQL detects this as a weak cryptographic hash used for password storage. This feature achieves a migration to a memory-hard adaptive KDF (`node:crypto`'s scrypt), maintains backward compatibility for existing installed systems (lazy migration), a migration script, and handling for downgrade scenarios.

## Boundary Context

- **In scope**: Improving the password hashing algorithm for local authentication (username/password), lazy migration (automatic re-hashing at login time), a migration status report script, a cleanup migration script, a downgrade preparation script, and a re-upgrade preparation script (run when returning to the new build after a temporary downgrade)
- **Out of scope**: External authentication providers such as LDAP, OAuth, SAML, and Passkey; improving the hashing of the `apiToken` field; immediate removal of the `PASSWORD_SEED` environment variable
- **Adjacent expectations**: Until the lazy migration is complete (until all users have re-logged in), the `PASSWORD_SEED` environment variable must remain set in order to verify existing SHA-256 hashes

## Requirements

### Requirement 1: Applying an adaptive KDF to new passwords

**Objective:** As a GROWI system administrator, I want newly set or changed passwords to use an industry-standard adaptive KDF, so that the CodeQL alert is resolved and resistance to GPU brute-force attacks is ensured.

#### Acceptance Criteria

1. When a user sets or changes a password, the GROWI authentication system shall hash the password using a memory-hard adaptive KDF (`node:crypto`'s scrypt, at or above OWASP-recommended parameters) and a per-user random salt.
2. The GROWI authentication system shall store the hash in a self-describing format (e.g., `scrypt$N$r$p$<salt>$<hash>`) that embeds the algorithm identifier, the parameters (N/r/p), and the salt, so that the algorithm and parameters can be detected without external metadata.
3. When a new password is set, the GROWI authentication system shall not use the legacy SHA-256+PASSWORD_SEED scheme to store the hash.
4. The GROWI authentication system shall guarantee, by means of the per-user random salt, that different hashes are generated from the same plaintext password.

### Requirement 2: Backward compatibility with existing SHA-256 hashed passwords

**Objective:** As an existing GROWI user, I want to log in without resetting my password even after the upgrade, so that I can continue using the service without interruption during the migration period.

#### Acceptance Criteria

1. When a user with a legacy SHA-256 hashed password submits their login credentials, the GROWI authentication system shall verify the submitted password using the legacy SHA-256+PASSWORD_SEED scheme.
2. When a user successfully authenticates via the legacy SHA-256 verification path, the GROWI authentication system shall automatically re-hash the password with the new adaptive KDF within the same login transaction and replace the stored hash.
3. While users with legacy-format hashes and users with new-format hashes coexist in the system, the GROWI authentication system shall handle both formats transparently without requiring any user-side action.
4. If the stored hash field exists but its content matches neither known format (the `scrypt$…` prefix nor SHA-256 hex) — an abnormal case such as data corruption — then the GROWI authentication system shall reject the login attempt and emit a structured log entry including the user identifier at the WARNING level.
5. When a user with no password set (both the `password` and `passwordHash` fields absent — the normal state for external-authentication-only users or not-yet-activated users) attempts a local login, the GROWI authentication system shall reject the login attempt but shall not emit a WARNING log, because this is a normal case (in the dual-field design, the presence of a field uniquely determines the format, so the absence of the fields means "not set" rather than "indeterminate").

### Requirement 3: Migration scripts

**Objective:** As a GROWI system administrator, I want to understand and manage the migration progress by means of migration scripts, so that I can safely remove legacy hashes at the appropriate time.

#### Acceptance Criteria

1. The GROWI migration system shall provide a status migration script that reports the number of users per hash format (legacy SHA-256 only, new adaptive KDF only, both formats coexisting, no password set) without modifying data.
2. When an administrator runs the status migration script, the GROWI migration system shall output the counts to standard output in a human-readable format.
3. The GROWI migration system shall provide a cleanup migration script that removes legacy SHA-256 credential data, targeting only users who have completed the migration to the new adaptive KDF format.
4. If the cleanup migration script detects **ACTIVE** users who retain only a legacy SHA-256 hash (not yet migrated via login), then the GROWI migration system shall abort without modifying data and display an error message indicating the number of affected users. The abort is scoped to ACTIVE users because a non-active user (invited / registered / suspended / deleted) cannot be compelled to log in before the cleanup window — an invitee may never accept, a suspended account may never return — so counting them as blocking would make the cleanup phase unreachable indefinitely. (Note: a non-active user *is* still migrated lazily if they do authenticate; the login path applies no status filter.) The GROWI migration system shall additionally report the number of non-active users in that state at the WARNING level so the administrator sees the full picture.

### Requirement 4: Downgrade safeguards

**Objective:** As a GROWI system administrator, I want to understand the scope of impact before downgrading the version and to execute a procedure that minimizes user impact, so that users can continue to authenticate after the downgrade, or affected users can be notified in advance.

#### Acceptance Criteria

1. The GROWI migration system shall provide a downgrade preparation script that reports the number of users who have completed the migration to the new adaptive KDF format (users who would become unable to log in if downgraded to a version that does not support the new format).
2. When the downgrade preparation script is run, the GROWI migration system shall provide an option to send a password reset email to all **ACTIVE** users with a new-format hash and no legacy hash, so that they can set a new password after the downgrade. The option is scoped to ACTIVE users because `/forgot-password` serves only ACTIVE users (it rejects non-active users on both POST and PUT), so a reset email cannot recover a non-active user and unsetting their `passwordHash` would strand them with neither a credential nor a recovery path. The GROWI migration system shall instead report non-active users in that state at the WARNING level for manual handling.
3. When the downgrade preparation script sends a password reset email, the GROWI migration system shall mark the corresponding users' passwords as requiring a reset and prohibit login until a new password is set.
4. The GROWI migration system shall provide a re-upgrade preparation script, to be run when returning to the new adaptive-KDF build after a temporary downgrade, that removes the scrypt `passwordHash` from every user holding BOTH credential fields (legacy `password` + `passwordHash`), so that a password changed while running on the downgraded build is not overridden by a now-stale `passwordHash` on re-upgrade. Rationale: on the downgraded build a password change updates only the legacy `password`, leaving `passwordHash` encoding the pre-change (potentially leaked) password; because verification prefers `passwordHash` and never falls back to `password`, the stale hash would revive the old password and lock out the current one. Resetting these users to legacy-only restores verification against the current legacy `password` and lets lazy migration rebuild a matching `passwordHash` on the next login. The removal is not scoped by status because every such user retains a live legacy `password`, so it can never strip a user's only credential.
