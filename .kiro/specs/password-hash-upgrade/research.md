# Research & Design Decisions

---

## Summary

- **Feature**: `password-hash-upgrade`
- **Discovery Scope**: Extension / Complex Integration (modification of an existing authentication system with a wide security impact surface)
- **Key Findings**:
  - The current implementation is `SHA-256(PASSWORD_SEED + plaintext)` — no per-user salt. It is a target of CodeQL `js/insufficient-password-hash` (CWE-916)
  - `node:crypto`'s scrypt is built into Node (OpenSSL) — zero new dependencies, no native build required on Alpine, and memory-hard. `argon2` (native binding) has known compatibility problems on Alpine (GitHub issues #223, #302, #402, #413). `bcryptjs` (Pure JS) is also Alpine-compatible but adds a third-party dependency and is not memory-hard → **adopt scrypt**
  - The User model is JavaScript (`.js`), and four or more methods call `generatePassword()`. The scrypt migration makes all of those methods async
  - `findUserByEmailAndPassword()` searches the DB by password hash (`{ email, password: hashedHash }`), and after migrating to scrypt (non-deterministic due to the salt) this pattern is no longer usable

---

## Research Log

### Selecting the password hashing algorithm

- **Context**: Selecting a library for migrating SHA-256 → an adaptive KDF
- **Sources Consulted**:
  - [npm-compare: argon2 vs bcrypt vs bcryptjs](https://npm-compare.com/argon2,bcrypt,bcrypt-nodejs,bcryptjs)
  - [node-argon2 Alpine issue #402](https://github.com/ranisalt/node-argon2/issues/402)
  - [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- **Findings**:
  - `node:crypto` scrypt: built into Node (OpenSSL), zero added dependencies, no node-gyp required, memory-hard. Ranked above bcrypt in the OWASP recommendation order
  - `bcryptjs` (Pure JS): ~3.2M weekly downloads, Alpine-compatible, no node-gyp required. However, it is a third-party dependency and is not memory-hard
  - `bcrypt` (native C++): ~1.8M weekly downloads, faster than bcryptjs but requires node-gyp / Python3
  - `argon2` (node-argon2): OWASP's most recommended algorithm, but there is an ongoing known problem where the prebuilt binaries fail on GROWI's Alpine-based Dockerfile due to a musl/glibc mismatch
- **Implications**: GROWI mainly supports Alpine-based Docker. Adopt `node:crypto` scrypt — memory-hard, requiring no native build and adding zero dependencies — to get both a simple Dockerfile and a strong KDF (bcryptjs was initially selected, but scrypt had been missed as a candidate, so it was re-evaluated and the choice was changed)

### CodeQL alert details

- **Context**: Which CodeQL rule is the target, and what determines that it is "fixed"
- **Sources Consulted**: [CodeQL: js/insufficient-password-hash](https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/)
- **Findings**:
  - Query ID: `js/insufficient-password-hash`, CWE-916
  - Flagged when data flows into a password field via `crypto.createHash('sha256')`
  - Fix: replace with one of `bcrypt.hash()`, `scrypt`, `argon2.hash()`, or `pbkdf2`
- **Implications**: The alert is resolved by using `node:crypto`'s `scrypt`

### Impact surface in the User model

- **Context**: Identifying the range of code affected by replacing `generatePassword()`
- **Findings**:
  - `generatePassword(password)`: a module-scoped private function
  - Call sites: `isPasswordValid`, `setPassword`, `findUserByEmailAndPassword` (inside the DB search query), `createUserByEmailAndPasswordAndStatus`
  - `findUserByEmailAndPassword` searches the DB with `{ email, password: sha256Hash }` → after the scrypt migration this pattern is not possible (scrypt is non-deterministic due to the salt). It must be changed to fetch-then-compare
  - The User model file is `.js` (not TypeScript). The new service file is created as `.ts`

### Patterns for a downgrade safety measure

- **Context**: Login continuity if a downgrade occurs after the scrypt migration
- **Findings**:
  - Due to the nature of a one-way hash, converting scrypt → SHA-256 is impossible (unless the plaintext is known)
  - Mainstream approaches: (A) keep the old hash in a separate field + write the new hash to a new field (B) reset the password before the downgrade
  - Lesson from Magento: there was a case where an inverted-condition bug overwrote bcrypt hashes with SHA-256 (breaking the hashes of migrated users)
- **Implications**: Adopt the dual-field approach (`password` = keep SHA-256, `passwordHash` = store scrypt). Because the old format remains in the existing field, the old version keeps working as-is even after a downgrade

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Assessment |
|--------|------|------|------------|------|
| **Single-field overwrite** | Overwrite the `password` field from SHA-256 → scrypt | Simple | Cannot log in after a downgrade; the cleanup migration is effectively a no-op | Rejected |
| **Dual-field approach** | `password` (keep SHA-256) + `passwordHash` (new field added, stores scrypt) | Downgrade-safe, the old version keeps working as-is, clear migration-state management | Requires adding a new field to the User schema | **Adopted** |
| **passwordHashVersion field** | Manage a version flag in a separate field | Explicit | Adds a field and redundantly manages information that the hash itself can already distinguish | Rejected (distinguishable by hash prefix) |
| **argon2id** | OWASP's top recommendation | Highest security | The native-build problem on Alpine Docker persists | Rejected (prioritize the zero-dependency scrypt) |

---

## Design Decisions

### Decision: Dual-field approach

- **Context**: Achieving both downgrade safety and seamless lazy migration
- **Alternatives Considered**:
  1. Single-field overwrite — overwrite `password` with scrypt. Simple but not downgrade-safe
  2. Dual-field — keep `password` (SHA-256) + add `passwordHash` (adopted)
  3. Format detection by prefix — both formats mixed in one field, distinguished by prefix
- **Selected Approach**: The `password` field keeps the SHA-256 hash as-is. On login, write the scrypt hash to the `passwordHash` field. New users set only `passwordHash` (no `password`)
- **Rationale**: Because the old version references only the `password` field, unmigrated users can still log in after a downgrade. Downgrade safety is maintained until the cleanup migration runs
- **Trade-offs**: Requires adding the `passwordHash` field to the schema. The migration script can decide based on field presence (clearer than a regular expression)
- **Follow-up**: Update the implementation of `isPasswordSet()` to check both fields

### Decision: Adopt scrypt (node:crypto) (changed after re-evaluation)

- **Context**: Selecting the adaptive KDF. `bcryptjs` was initially selected, but a review revealed that **Node.js's standard `crypto.scrypt` had been missed as a candidate**, so it was re-evaluated.
- **Alternatives Considered**:
  1. `node:crypto`'s **scrypt** — built into Node (OpenSSL), zero new dependencies, memory-hard, no native build required on Alpine (**adopted**)
  2. `bcryptjs` — Pure JS, Alpine-compatible, no native build. However, it adds a third-party dependency and is not memory-hard
  3. `bcrypt` (native C++) — fast but requires node-gyp / Python3 on Alpine
  4. `argon2` — OWASP's top recommendation, but the native-build compatibility problem on Alpine persists (still rejected)
- **Selected Approach**: `node:crypto`'s `scrypt`. Parameters **N=131072 (2^17), r=8, p=1 (OWASP minimum recommendation)**, keylen=64. Stored in the self-describing format `scrypt$N$r$p$salt$hash`. Verification uses `timingSafeEqual`. `maxmem` is set to ≥192MB, above the consumed memory (≈128MB) (leaving Node's default 32MB would throw)
- **Rationale**:
  - **Zero new dependencies** (built into Node), avoiding from the start the Alpine native-build problem that was the reason for giving up on argon2. No supply-chain or version-maintenance burden either
  - **memory-hard**, with higher GPU/ASIC brute-force resistance than bcrypt (also ranked above bcrypt by OWASP)
  - The goal of resolving CWE-916 can be achieved with bcrypt too, but scrypt best matches this feature's aim of "stronger without adding new dependencies"
- **Trade-offs**:
  - bcrypt's self-describing format (`$2b$…`) cannot be used, so the encoding/decomposition of salt+parameters is **implemented in-house** (a few dozen lines)
  - The OWASP minimum recommendation (N=2^17, r=8) consumes about 128MB per call, requiring `maxmem` to be raised to ≥192MB (Node's default 32MB would throw). The asynchronous `crypto.scrypt` is capped in concurrency by the libuv thread pool, so the peak is roughly "number of threads × 128MB ≈ 512MB". Factor this transient allocation into the container's memory budget (under pressure, consider the alternative N=2^16, r=8, p=2 ≈ 64MB/call) (see Security Considerations)
- **Follow-up**: Make the scrypt parameters adjustable via environment variables, and set lower-bound clamping and a `maxmem` upper bound. Rate limiting on the login endpoint is recommended

### Decision: Synthesis — separate PasswordHashService into an independent service

- **Context**: `generatePassword()` is a module-scoped private function, making direct replacement difficult
- **Selected Approach**: Create an independent service module as `src/server/service/password-hash.ts`. Injected into the User model as a dependency (`crowi.passwordHashService` or a direct import)
- **Rationale**: Separating the hashing logic from the User model improves testability. `PasswordHashService` can be unit-tested on its own. Future algorithm changes are then a one-file modification

---

## Risks & Mitigations

- **The DB search pattern of `findUserByEmailAndPassword`** — query-by-hash is impossible with the non-deterministic scrypt hash → change to the fetch-then-compare pattern. Identify and fix every place where existing code uses `{ email, password: hash }` in a query
- **Making Passport LocalStrategy async** — currently a synchronous callback. Making it async changes error handling → explicitly call done(err) in try/catch
- **scrypt memory consumption (operations)** — the OWASP minimum recommendation (N=2^17=131072, r=8) uses about 128MB per call. `maxmem` must be set to ≥192MB (Node's default 32MB would throw). The asynchronous `crypto.scrypt` is capped in concurrency by the libuv thread pool, so the peak is roughly "number of threads × 128MB ≈ 512MB". Factor this transient allocation into the container's memory budget, and under pressure either shrink `UV_THREADPOOL_SIZE` or consider the alternative N=2^16, r=8, p=2 ≈ 64MB/call. Rate limiting on the login endpoint is also recommended (scrypt does not have bcrypt's 72-byte truncation limit)
- **Legacy users not logging in for a long time** — with lazy migration alone, there can be users who remain on SHA-256 forever → periodically check via the Status migration, and separately consider a forced reset after a certain period (out of this scope)
- **User-enumeration timing attack (surfaced by the scrypt change)** — non-existent users return immediately, whereas existing users take tens to hundreds of ms due to the scrypt recomputation, so the response-time difference lets one infer whether a user exists. The difference is more pronounced than in the SHA-256 era. Mitigation: run a dummy scrypt comparison even when the user does not exist (within this scope, it is recommended to check whether rate limiting on the login endpoint already exists; if not, a separate task)
- **Non-constant-time comparison on the legacy SHA-256 path** — `this.password === generatePassword(password)` is not a strict constant-time comparison, but because it compares hashes rather than plaintext, the actual attack risk is extremely low. It can be fully resolved by using `crypto.timingSafeEqual` on the legacy path of `PasswordHashService.verify()` (not required)

---

## References

- [CodeQL: js/insufficient-password-hash (CWE-916)](https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/)
- [bcryptjs npm](https://www.npmjs.com/package/bcryptjs)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [node-argon2 Alpine issue #402](https://github.com/ranisalt/node-argon2/issues/402)
- [Migrating from SHA to bcrypt — DevToolbox](https://www.dev-toolbox.tech/tools/bcrypt-generator/examples/bcrypt-migration-strategy)

---

## Gap Analysis: verifying integration points with existing code (scrypt version, 2026-07-17)

Verified the gaps between the requirements ↔ the existing codebase by cross-checking against the actual code (`/kiro-validate-gap`).

### Confirmed (the premises actually exist)

| Integration Point | Verification Result |
|--------|---------|
| Callers of `isPasswordValid` | 2 places, `passport.ts:285` / `personal-setting/index.js:432` (sync boolean) ✅ |
| Callers of `setPassword` | 5 methods in `user/index.js` (208/277/575/591/683) ✅ |
| `password == null` substitute check | `login.js:145` / `personal-setting:702` / `user-activation.ts:278` ✅ |
| `findUserByEmailAndPassword` | definition only, zero callers (dead code) ✅ |
| `omitInsecureAttributes()` | excludes only `password`/`apiToken`/`email`, does not exclude `passwordHash` ✅ (needs adding) |
| `statusDelete()` | scrubs only `password=''`, does not clear `passwordHash` ✅ (needs adding) |
| migrate-mongo | `src/migrations/` (49 files) + the `dev:migrate-mongo` script actually exist ✅ |
| `PasswordResetOrder` | the `createPasswordResetOrder(email)` static actually exists in `src/server/models/password-reset-order.ts` ✅ |
| Crowi bootstrap (standalone) | `src/server/repl.ts` uses the `new Crowi()`+`crowi.init()` pattern. Launched with `pnpm run ts-node <file>` ✅ |
| mailService | `crowi.mailService.send(...)` (used by forgot-password.js) ✅ |
| scrypt | built into `node:crypto`, zero dependencies ✅ |

### Detected gaps (to be addressed during implementation)

1. **The `src/server/scripts/` directory does not yet exist**: cleanup / downgrade-prep are newly created in this directory. The standalone execution method is the same `pnpm run ts-node src/server/scripts/<name>.ts` as `repl.ts` (the `ts-node` script loads `dotenv-flow` + `tsconfig-paths`). We need to **either add an execution script entry to package.json or clearly document the execution command in the README/design**.
2. **The reset-email sending logic is not reusable**: `sendPasswordResetEmail()` is a local function inside `forgot-password.js` and is **not exported**. It cannot be reused directly from downgrade-prep, so we need to either (a) extract it into a shared helper, or (b) duplicate the `mailService.send()` call + template inside the script. The design's "send the reset email via the existing mail service" does not make this point explicit.
3. **`PasswordResetOrder` has both a Mongoose and a Prisma version**: `src/generated/prisma/models/passwordresetorders.ts` also exists, but `forgot-password.js` uses the Mongoose version (`~/server/models/password-reset-order`). This spec also standardizes on the Mongoose version for consistency (the Prisma version is not used).

### Implications
- Most of the premises actually exist, and there is no integration blocker that would prevent the scrypt migration.
- The above gaps 1 and 2 affect the implementation details of downgrade-prep (task 4.3), so reflecting them in the design/tasks will make implementation smoother.
