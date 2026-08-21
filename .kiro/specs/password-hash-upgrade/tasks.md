# Implementation Plan

- [ ] 1. Foundation: Building PasswordHashService (scrypt)
- [x] 1.1 Confirm that scrypt is available without any new dependencies
  - scrypt is built into `node:crypto`, so **no dependency additions to package.json are needed** (do not add `bcryptjs` / `@types/bcryptjs` either)
  - Confirm that `import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'` resolves in TypeScript without type errors
  - Confirm the approach of promisifying the asynchronous `scrypt` for use (e.g. `util.promisify(scrypt)`)
  - _Requirements: 1.1_

- [x] 1.2 Implement PasswordHashService
  - Implement `hash(plaintext)`: generate a salt with `randomBytes(16)` → `scrypt(plaintext, salt, 64, {N, r, p, maxmem})` → encode and return as `scrypt$N$r$p$<salt base64>$<hash base64>` (keylen=64). PASSWORD_SEED is not used
  - scrypt parameters default to **N=131072 (2^17), r=8, p=1 (OWASP minimum recommendation)**. Make them adjustable via environment variables, and **clamp anything below the floor (N=2^17) and emit a startup WARNING**
  - Explicitly set `maxmem` to **≥192MB** (N=2^17 consumes about 128MB, and with Node's default `maxmem=32MB` `scrypt` would throw, so this is mandatory). Also clamp the parameter ceiling (to prevent memory exhaustion / DoS from an extreme N)
  - Confirm that the memory consumption (about 128MB per call, peaking at ~512MB with a thread pool of 4) is factored into the container's memory budget
  - Implement `verify(plaintext, scryptHash, legacyHash, passwordSeed)`:
    - `scryptHash` present → decompose `scrypt$…` to obtain N/r/p/salt, recompute with `scrypt` → compare with `timingSafeEqual` (`needsRehash: false`)
    - (optional extension) if the stored parameters are weaker than the current default, return `needsRehash: true` (automatic rehash on parameter update. Optional extension to maintain Req 1.1 — not mandatory)
    - `scryptHash` absent and `legacyHash` present → verify with `SHA-256(SEED + plaintext)` (`needsRehash: true`)
    - both fields absent (password not set = normal case) → return `isValid: false`. **Do not emit a WARNING log** (this is the normal state for external-auth-only / not-yet-activated users. Req 2.5)
    - fields exist but their content does not match a known format (`scrypt$…` / SHA-256 hex) (abnormal case) → return `isValid: false` and emit a WARNING log (including the user identifier. Req 2.4)
  - Export the `VerifyResult` interface (`isValid: boolean; needsRehash: boolean`)
  - Confirm that calling `hash()` returns a self-describing hash with the `scrypt$` prefix
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 2.4, 2.5_
  - _Boundary: PasswordHashService_

- [x] 1.3 Create unit tests for PasswordHashService
  - `hash()`: confirm that calling it twice with the same plaintext returns different hashes (per-user salt)
  - `hash()`: confirm that the return value starts with `scrypt$` (not a 64-character SHA-256 hex)
  - `verify()`: scrypt path → confirm `{ isValid: true, needsRehash: false }`
  - `verify()`: SHA-256 legacy path (`legacyHash` present) → confirm `{ isValid: true, needsRehash: true }`
  - `verify()`: invalid credentials → confirm `{ isValid: false }`
  - `verify()`: both fields absent (password not set) → confirm `{ isValid: false }` and that **no WARNING log is emitted** (Req 2.5)
  - `verify()`: abnormal case where field content does not match a known format → confirm `{ isValid: false }` and that a WARNING log is emitted (Req 2.4)
  - `verify()` (optional extension): a scrypt hash created with parameters weaker than the current default (e.g. a small N) → confirm `{ isValid: true, needsRehash: true }` (automatic rehash on parameter update)
  - Confirm that `pnpm vitest run password-hash.spec` fully PASSes
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: PasswordHashService_

- [ ] 2. Overhaul of the User model and password-related callers
- [x] 2.1 Add the passwordHash field to the User schema and update isPasswordSet
  - Add a `passwordHash: { type: String }` field to the Mongoose schema definition
  - Update `isPasswordSet()` to `!!(this.passwordHash || this.password)` so it checks both fields
  - Adding a MongoDB field does not affect existing documents (no automatic migration needed)
  - Confirm that the existing `password` field is unchanged and that `passwordHash` has been newly added
  - _Requirements: 2.2, 2.3_
  - _Boundary: User Model_

- [x] 2.2 Make isPasswordValid, setPassword, and updatePassword async and delegate to PasswordHashService
  - Make `isPasswordValid(password)` async: call `PasswordHashService.verify(password, this.passwordHash, this.password, SEED)` and return the `VerifyResult`
  - Make `setPassword(password, options?)` async: set `this.passwordHash = await PasswordHashService.hash(password)` **and retire the legacy `password` (SHA-256) field** (`this.password = undefined` → `$unset` on save). A replaced password must not stay verifiable: otherwise, after a change/reset, the OLD password still authenticates on a downgraded build. The exception is `options.keepLegacyHash: true`, passed only by the lazy migration in `verifyLocalCredentials`, which re-hashes the SAME password and therefore keeps the legacy field (the `both` state = downgrade safety during the migration period)
  - Update all **five existing methods** that call `setPassword` to add `await` (if left un-awaited, `save()` would persist without passwordHash set, making login impossible):
    - `updatePassword` (v8: setPassword call at line ~230)
    - `activateInvitedUser` (v8: line ~299) — invited-user activation. **If missing, the affected user cannot log in**
    - `resetPasswordByRandomString` (v8: line ~598)
    - `createUserByEmail` (v8: line ~614) — email-invited user creation. **If missing, the affected user cannot log in**
    - `createUserByEmailAndPasswordAndStatus` (v8: line ~706)
  - Confirm that after `setPassword()` `passwordHash` is set and the legacy `password` field is cleared (and that `{ keepLegacyHash: true }` keeps it), and that all five callers work without TypeScript compilation errors
  - _Requirements: 1.1, 1.3, 2.1, 2.2_
  - _Boundary: User Model_

- [x] 2.3 Remove findUserByEmailAndPassword (dead code)
  - `findUserByEmailAndPassword(email, password)` is dead code with no callers anywhere in the repository, so remove it (confirmed zero callers with `grep -rn findUserByEmailAndPassword apps/app/src packages`)
  - This method queries the DB by password hash and would be non-functional after the scrypt migration, but since it has no callers, deletion is appropriate rather than a fetch-then-compare refactor (avoids wasted implementation effort)
  - Only if a re-grep before deletion discovers a caller, refactor it to a fetch-then-compare using an `{ email }` search + `await user.isPasswordValid()`
  - Confirm that the method definition is removed and that TypeScript compilation and existing tests pass
  - _Requirements: 2.1, 2.3_
  - _Boundary: User Model_

- [x] 2.4 Prevent passwordHash from leaking in API responses (@growi/core)
  - Add `passwordHash` to the omit list in `omitInsecureAttributes()` in `packages/core/src/models/serializers/user-serializer.ts` (currently it only excludes `password`/`apiToken`/`email`, so the new field would leak)
  - Add `passwordHash?: string` to `IUser` in `packages/core/src/interfaces/user.ts`
  - Since `@growi/core` is a published package, create a patch bump with `npx changeset`
  - Confirm that the serialized user object does not contain `passwordHash`, and that `passwordHash` can be referenced on the `IUser` type
  - _Requirements: 1.1, 2.2_
  - _Boundary: User Model_

- [x] 2.5 Make the external caller of isPasswordValid (personal-setting) async
  - In `apps/app/src/server/routes/apiv3/personal-setting/index.js` (v8: line ~441), replace
    `if (user.isPasswordSet() && !user.isPasswordValid(oldPassword)) {` with
    `if (user.isPasswordSet() && !(await user.isPasswordValid(oldPassword)).isValid) {`
  - **CRITICAL**: because `isPasswordValid` returns a `Promise<VerifyResult>`, `!Promise` is always `false`, so old-password verification is skipped (= an authentication bypass that lets someone change to a new password without knowing the current one). Must use `await` + `.isValid` reference
  - Confirm that the handler is async and that the change is rejected when the old password is incorrect
  - _Requirements: 2.1, 2.2_
  - _Depends: 2.2_
  - _Boundary: User Model_

- [x] 2.6 Replace password-set checks that use `password == null` as a proxy with isPasswordSet()
  - Because they misclassify passwordHash-only users (`password` unset, `passwordHash` set), replace the following 3 locations with `isPasswordSet()`-based checks:
    - `apps/app/src/server/routes/login.js` (line ~145): `userData.password == null` → `!userData.isPasswordSet()` (prevents every passwordHash-only user from being wrongly redirected to `/me#password_settings` on each login)
    - `apps/app/src/server/routes/apiv3/personal-setting/index.js` (v8: line ~715): `user.password == null && count <= 1` → `!user.isPasswordSet() && count <= 1` (prevents wrongly blocking LDAP account disassociation)
    - `apps/app/src/server/routes/apiv3/user-activation.ts` (line ~278): `userData.password != null` → `userData.isPasswordSet()` (prevents misjudging the redirect destination)
  - Confirm that each check is replaced with `isPasswordSet()` and that passwordHash-only users no longer experience wrong redirects / wrong blocks
  - _Requirements: 2.2, 2.3_
  - _Depends: 2.1_
  - _Boundary: User Model_

- [x] 2.7 Clear passwordHash in statusDelete
  - Add `this.passwordHash = undefined;` to `statusDelete()` (`apps/app/src/server/models/user/index.js`, alongside `this.password = undefined`) so that deleted users do not retain a valid scrypt credential hash (both credential fields are unset on delete)
  - Reason for using `undefined` (unset) rather than `''`: so that verify() treats it as `noPassword` (normal case) and does not wrongly fire the format-mismatch Req 2.4 WARNING
  - Add verification that `passwordHash` is unset to the existing integration test `user.integ.ts` (the section that verifies deleted-user attributes and checks `password` for an empty string)
  - Confirm that the deleted user document retains no valid `passwordHash`
  - _Requirements: 1.1, 2.2_
  - _Boundary: User Model_

- [x] 2.8 Create an authentication-bypass regression test for the password-change flow
  - Confirm that the password change succeeds only when the old password is correct, and is rejected when it is incorrect / unspecified (regression prevention for task 2.5)
  - Confirm that a passwordHash-only user is not wrongly redirected to `/me#password_settings` after login (regression prevention for task 2.6)
  - Confirm that these tests fully PASS with `pnpm vitest run`
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.5, 2.6_
  - _Boundary: User Model_

- [ ] 3. (P) Making Passport LocalStrategy async and integrating lazy migration
- [x] 3.1 Make Passport LocalStrategy async and trigger lazy migration
  - Change or wrap `findUserByUsernameOrEmail` from callback style to Promise-based (async/await)
  - Change the LocalStrategy callback to an async function, passing all errors to `done(err)` in a try/catch
  - When `VerifyResult.needsRehash === true` (on successful legacy authentication): execute `await user.setPassword(password, { keepLegacyHash: true })` + `await user.save()` before returning `done(null, user)` (`keepLegacyHash` retains the legacy SHA-256 field — this path re-hashes the SAME password, so nothing is retired)
  - On a `save()` failure during lazy migration, record an error log but still let the login succeed (it can be retried on the next login)
  - When `isValid === false`, return `done(null, false)`
  - Confirm that when a user with a SHA-256 hash logs in for the first time, the `passwordHash` field is set in the DB
  - _Requirements: 2.1, 2.2, 2.3_
  - _Depends: 2.2, 2.3_
  - _Boundary: Passport LocalStrategy_

- [x] 3.2 Create integration tests for the login flow
  - Confirm that a legacy SHA-256 user logs in successfully and that after lazy migration `passwordHash` is written to the DB
  - Confirm that a scrypt user logs in successfully and that no rehash occurs
  - Confirm that login fails with invalid credentials
  - Confirm that local login fails for a user with no password set (both fields absent), and that **no WARNING log is emitted** (Req 2.5)
  - Confirm that the integration tests fully PASS with `pnpm vitest run`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: Passport LocalStrategy_

- [ ] 4. (P) Implementing the migration scripts
- [x] 4.1 (P) Implement the Status migration script
  - Create the `20260724000001-password-hash-status` migration (**v8: use a timestamp later than the current latest `20260721103639`**. The old `20260514000001` would become a past date and migrate-mongo would treat it as out-of-order, so it is not allowed)
  - Inside `up()`, tally the number of users in the following 4 categories (no DB writes):
    - upgradedOnly (`passwordHash` present, `password` absent): fully migrated
    - both (both fields present): mid-migration
    - legacyOnly (`passwordHash` absent, `password` present): not yet migrated
    - noPassword (both fields absent): password not set
  - Output the tally results to stdout via `logger.info`
  - Confirm that after running the migration nothing has been written to the DB and that the 4-category counts are output to logger.info
  - _Requirements: 3.1, 3.2_
  - _Boundary: Status migration script_

- [x] 4.2 (P) Implement the Cleanup standalone script
  - Create `apps/app/src/server/scripts/password-hash-cleanup.ts` (a standalone script not managed by migrate-mongo)
  - At script start, get the number of `legacyOnly` users (`passwordHash` absent, `password` present) **among ACTIVE users** (`activeUserFilter`), plus the non-active count separately
  - If the ACTIVE `legacyOnly` count > 0: output an error message (including both counts) and process.exit(1) (Req 3.4). Non-active `legacyOnly` users must NOT block the abort — they can never log in, so lazy migration can never migrate them and the cleanup phase would be unreachable forever; WARN about them instead
  - Otherwise: `$unset` the legacy `password` from every `both`-category user via `updateMany(bothFilter, { $unset: { password: '' } })`, using the shared `bothFilter` from `password-hash-format-filters.ts` (Req 3.3). This write is deliberately NOT status-scoped
  - Confirm that when ACTIVE `legacyOnly` users exist it aborts with no changes made to the DB, that the error message includes the count, and that a non-active `legacyOnly` user alone does not abort the run
  - _Requirements: 3.3, 3.4_
  - _Boundary: Cleanup migration script_

- [x] 4.3 (P) Implement the Downgrade prep standalone script
  - Create `apps/app/src/server/scripts/password-hash-downgrade-prep.ts` (a standalone script that requires the Crowi bootstrap)
  - In the script, tally and log the number of users who would be unable to log in after a downgrade (`passwordHash` present, `password` absent), split into ACTIVE (processed) and non-active (reported only) (Req 4.1)
  - When the environment variable `SEND_RESET_EMAILS` is `'true'`:
    - For each **ACTIVE** target user, create a `PasswordResetOrder` and send a reset email using the existing mail service (Req 4.2). Non-active users are never emailed and never `$unset`: `/forgot-password` rejects them on both POST and PUT, so removing their `passwordHash` would be a permanent lockout — WARN and leave them for manual handling
    - **Only after confirming the email was sent successfully**, `$unset` (remove the field entirely) the `passwordHash` of the successful users to make login impossible (Req 4.3)
    - **CRITICAL**: use `$unset` (remove the field entirely) rather than assigning `null`/`''`. The shared classification filters treat a `null`/empty credential as ABSENT (`present` = `{ $exists: true, $nin: [null, ''] }`), so `$unset` moves the user cleanly to `noPassword`; leaving a stray `null`/`''` field is avoided for consistency with `statusDelete`'s `undefined` scrub, keeping counts accurate and preventing duplicate email sends on re-run
    - Do not unset users whose send failed (they can be retried on the next re-run)
    - Log the success and failure counts at INFO/WARNING respectively
  - Confirm that when `SEND_RESET_EMAILS` is unset only the tally counts are output and the DB is not changed
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: Downgrade prep migration script_

- [ ] 5. Integration tests for the migration scripts
- [x] 5.1 (P) Create integration tests for the Status migration script
  - Prepare users in the 4 categories (upgradedOnly, both, legacyOnly, noPassword) in the test DB
  - Confirm that after running `up()` each count matches its expected value
  - Confirm that after running `up()` no user document in the DB has been changed at all
  - Confirm that the integration test PASSes
  - _Requirements: 3.1, 3.2_
  - _Boundary: Status migration script_

- [x] 5.2 (P) Create integration tests for the Cleanup standalone script
  - Confirm that with ACTIVE `legacyOnly` users present the script run aborts and no user document is changed, and that a NON-ACTIVE `legacyOnly` user does not block the run (it is only reported)
  - Confirm that when all users are already migrated to `passwordHash` the `password` field is `$unset`
  - Confirm that the integration test PASSes
  - _Requirements: 3.3, 3.4_
  - _Boundary: Cleanup migration script_

- [x] 5.3 (P) Create integration tests for the Downgrade prep standalone script
  - Confirm that when `SEND_RESET_EMAILS` is unset the DB is not changed and only the counts are output
  - Confirm that when `SEND_RESET_EMAILS=true` a `PasswordResetOrder` is created for the target users
  - Confirm that when `SEND_RESET_EMAILS=true` only users whose email was sent successfully have their `passwordHash` `$unset` (field absent), and that the `passwordHash` of users whose send failed is unchanged
  - Confirm that a NON-ACTIVE `upgradedOnly` user is never emailed and never `$unset` (it is only counted)
  - Confirm that a user after `$unset` is classified as `noPassword` by the status migration and does not remain in `upgradedOnly` (regression prevention for duplicate email sends)
  - Confirm that the integration test PASSes
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: Downgrade prep migration script_

- [ ] 6. Confirming resolution of the CodeQL alert (CWE-916 / #541)
- [ ] 6.1 Re-scan CodeQL after implementation and confirm the alert state
  _Manual/CI: CodeQL runs on GitHub Actions, so it cannot be confirmed in the devcontainer. After pushing the branch, confirm the state of #541 in the CI CodeQL re-scan._
  _Code-level evidence (confirmed in this run): the password **storage** path is scrypt-only (`hash()` in `password-hash.ts` is scrypt, and `setPassword` delegates to `hash()`). SHA-256 remains only in the legacy **verification** path (`SHA256(SEED+plaintext)` inside `verifyLegacy` at `password-hash.ts:248`) and cannot be removed for Req 2.1 backward compatibility. The sha256 at `user/index.js:163` is `generateApiToken` (out of scope). → The CWE-916 storage-path vulnerability is resolved. If the legacy verification line is re-flagged by CodeQL, apply a dismissal of "migration-period-only, not used for new storage, to be removed after Cleanup"; full green is achieved after the Cleanup phase._
  - Confirm via a CodeQL re-scan whether making the storage path scrypt-based resolves `js/insufficient-password-hash` (alert #541)
  - If the legacy verification path (`SHA256(SEED + plaintext)` inside `verify()`) is re-flagged, apply a **justified dismissal** at that location (e.g. "for migration-period-only legacy hash verification. Not used for new storage. Scheduled for removal after Cleanup")
  - Record in the PR / Issue that the SHA-256 computation cannot be removed for backward compatibility (Req 2.1) and that full green is achieved once the legacy verification code is deleted in the Cleanup phase
  - Confirm that the alert is resolved on CodeQL (or a justified dismissal is applied)
  - _Requirements: 1.1, 1.3_
  - _Boundary: PasswordHashService_

## v8 (8.0.x line) implementation notes

This spec is implemented on the 8.0.x line (`feat/170496-password-hash-algorithm-v8` → `feat/170496-183017-password-hash-upgrade-v8`). Unlike v7, follow these premises (per `apps/app/.claude/rules/`):

- **Imports have no extension** (do not write `.js`/`.jsx` in relative / `~/` specifiers; `.js` is added only in the build output). The imports in `password-hash.ts` and each modified file follow this convention.
- **The User model is still Mongoose `.js` in v8** (`src/server/models/user/index.js`). Since it has not been migrated to Prisma, edit the Mongoose methods as designed.
- **Standalone scripts (4.2 / 4.3)**: `src/server/scripts/` does not exist yet in v8, so create it new. Run them with `pnpm run tsrun <path>` (not `ts-node`, but the ESM runner that `--import`s `bin/runtime/dev-esm-resolver.mjs` + `bin/runtime/env-preload.mjs`). The downgrade-prep Crowi bootstrap must also work under ESM.
- **migrate-mongo (4.1)**: the v8 config is `config/migrate-mongo-config.cjs` (the trigger `pnpm run migrate:migrate-mongo` itself is unchanged). The migration file is `.js` and the co-located integration test is `.integ.ts` (following the existing example `20260721103639-backfill-users-timestamps.integ.ts`). Use a timestamp later than the current latest (`20260721103639`).
- **server-boot-imports**: `PasswordHashService` uses only `node:crypto` (no added cost), so a top-level import is fine. It does not violate the lazy-loading convention for heavyweight SDKs.
- **activity-recording**: this spec only edits conditional expressions within existing routes (login / personal-setting / user-activation), with no route additions or middleware-order changes, so no activity-recording changes are needed.
- The line numbers in the tasks are approximate values (`~`) matched to the v8 actual code. When implementing, grep to confirm the relevant pattern before editing.

## Implementation Notes (implementation log)

- **1.1 (v8)**: `bcryptjs`/`@types/bcryptjs` are absent from the v8 package.json (scrypt is built into `node:crypto`, no new dependency needed). Because `util.promisify(scrypt)` drops the options-bearing overload (TS2554), call `scrypt(pw, salt, keylen, {N,r,p,maxmem}, cb)` via a manual `new Promise` wrapper. Confirmed the type check passes on the v8 tsconfig (`tsgo --noEmit`). Type checking in v8 is `tsgo` (not `tsc`).
- **1.2 (v8)**: Export a `createPasswordHashServiceForTest(params)` factory (the `ForTest` suffix is load-bearing — it skips the security floor so tests can inject a small N), the env resolver `resolveScryptParamsFromEnv()`, and an env-bound default singleton `passwordHashService` (env names `PASSWORD_SCRYPT_N/R/P`). Defaults N=2^17/r=8/p=1, `maxmem=Math.max(192MB, 128*N*r*2)`. The factory has no floor clamp (allows injecting a small N in tests; ceiling clamp only) / the env path (`resolveScryptParamsFromEnv`) has floor+ceiling clamps + a startup WARNING. `verify()` delegates to verifyScrypt/verifyLegacy and does not throw. To avoid biome's `useAwait` warning, verifyLegacy is a synchronous method. In task 2.2 the User model imports the default singleton `passwordHashService`. **Imports have no extension** (v8 convention).
- **PROCESS (v8)**: Subagents tend to skip the heavy `tsgo --noEmit` (~400s), and **biome/vitest do not detect type errors**, so type errors slipped through commits (tasks 1.2/2.2). Actually occurred: ① pino's `logger.warn` takes **an object as the first argument** (`logger.warn({ error }, 'msg')`. String-first, object-second is TS2769) ② `crowi.env` from `mockDeep<Crowi>()` is a proxy type, so assigning `crowi.env = {…}` is not allowed; set the property as `crowi.env.PASSWORD_SEED = …`. **Run `pnpm exec tsgo --noEmit` once at the completion of each group** (`lint:typecheck` = `tsgo --noEmit`).
- **3.1 (v8)**: Extract the LocalStrategy verify logic into an exported pure function `verifyLocalCredentials(User, username, password, done)` and make `setupLocalStrategy` a thin adapter. `findUserByUsernameOrEmail` (callback) is Promise-wrapped inside passport.ts (the User model is unchanged = boundary maintained). On `needsRehash`, `setPassword`+`save`; a failure of that save is logged only and login continues to succeed. All errors go through try/catch → `done(err)`.
- **2.4 (v8)**: `omitInsecureAttributes()` uses destructure-drop (`const { password, passwordHash, apiToken, email, ...rest }`) for runtime exclusion. `passwordHash` was also added to the Omit union of `IUserSerializedSecurely`. `passwordHash?: string` on `IUser`. The changeset is `.changeset/password-hash-omit.md` (@growi/core patch). **Because @growi/core consumers import `dist`, `turbo run build --filter @growi/core` is required before the app-level integ tests (2.8/3.2)**. Note: subagent tool executions leak grep/echo permissions into `.claude/settings.json` (outside the boundary) → revert with `git checkout -- .claude/settings.json` before committing.
- **2.2 (v8)**: The User model uses the default singleton via `import { passwordHashService } from '~/server/service/password-hash';` (no extension). `isPasswordValid` passes `crowi.env.PASSWORD_SEED` (= the same accessor as the existing generatePassword) to verify and returns `Promise<VerifyResult>` (not boolean → external callers are awaited in 2.5/3.1). `setPassword` writes `this.passwordHash` and, by default, RETIRES the legacy `this.password`; only the Passport lazy re-hash passes `keepLegacyHash: true` (same password, nothing replaced) — see the credential-revocation note in design.md. (This entry originally recorded the pre-review behaviour of leaving `password` untouched.) All 5 callers (updatePassword/activateInvitedUser/resetPasswordByRandomString/createUserByEmail/createUserByEmailAndPasswordAndStatus) are awaited. `generatePassword` is kept through 2.3 (findUserByEmailAndPassword is its last caller). This change resolves 2 pre-existing useAwait warnings in updatePassword/activateInvitedUser.
- **1.3 (v8)**: All required matrix cases of 1.3 + the optional extension (weak parameters → needsRehash:true) are already covered by `password-hash.spec.ts` (all 12 cases) created in 1.2. Confirmed no additional tests are needed and completed 1.3. noPassword treats an empty string as absent too, and malformed verifies 3 cases: invalid scrypt envelope / non-hex legacy / corrupt envelope.
