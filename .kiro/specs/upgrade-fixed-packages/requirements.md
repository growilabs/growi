# Requirements Document

## Introduction

The `apps/app/package.json` file contains several packages whose versions are intentionally pinned due to ESM-only upgrades, upstream bugs, or licensing concerns. These pinning reasons were documented in `// comments for dependencies` and `// comments for defDependencies` comment blocks. Since the build environment has significantly changed (webpack → Turbopack), and upstream issues may have been resolved, a systematic audit is needed to determine which packages can now be safely upgraded.

### Pinned Packages Inventory

| # | Package | Current Version | Pinning Reason |
|---|---------|----------------|----------------|
| 1 | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | `3.454.0` | Fix version above 3.186.0 required by mongodb@4.16.0 |
| 2 | `@keycloak/keycloak-admin-client` | `^18.0.0` | 19.0.0+ exports only ESM |
| 3 | `bootstrap` | `=5.3.2` | v5.3.3 has a bug (twbs/bootstrap#39798) |
| 4 | `escape-string-regexp` | `^4.0.0` | 5.0.0+ exports only ESM |
| 5 | `next-themes` | `^0.2.1` | 0.3.0 causes type error (pacocoursey/next-themes#122) |
| 6 | `string-width` | `=4.2.2` | 5.0.0+ exports only ESM |
| 7 | `@handsontable/react` | `=2.1.0` | v3 requires handsontable >= 7.0.0 |
| 8 | `handsontable` | `=6.2.2` | v7.0.0+ is no longer MIT license |

## Requirements

### Requirement 1: Upstream Bug and Issue Investigation

**Objective:** As a maintainer, I want to verify whether upstream bugs and issues that originally caused version pinning have been resolved, so that I can make informed upgrade decisions.

#### Acceptance Criteria

1. When investigating the bootstrap pinning, the audit process shall check the current status of https://github.com/twbs/bootstrap/issues/39798 and determine whether v5.3.3+ has fixed the reported bug.
2. When investigating the next-themes pinning, the audit process shall check the current status of https://github.com/pacocoursey/next-themes/issues/122 and determine whether v0.3.0+ has resolved the type error.
3. When investigating the @aws-sdk pinning, the audit process shall verify whether the mongodb version used in GROWI still requires the `>=3.186.0` constraint and whether the latest @aws-sdk versions are compatible.
4. The audit process shall document the investigation result for each package, including: current upstream status, whether the original issue is resolved, and the recommended action (upgrade/keep/replace).

### Requirement 2: ESM-Only Package Compatibility Assessment

**Objective:** As a maintainer, I want to assess whether ESM-only versions of pinned packages are now compatible with the current Turbopack-based build environment, so that outdated CJS-only constraints can be removed.

#### Acceptance Criteria

1. When assessing ESM compatibility, the audit process shall evaluate each ESM-pinned package (`escape-string-regexp`, `string-width`, `@keycloak/keycloak-admin-client`) against the current build pipeline (Turbopack for client, tsc for server).
2. When a package is used in server-side code (transpiled via tsc with `tsconfig.build.server.json`), the audit process shall verify whether the server build output format (CJS or ESM) supports importing ESM-only packages.
3. When a package is used only in client-side code (bundled via Turbopack), the audit process shall confirm that Turbopack can resolve ESM-only packages without issues.
4. The audit process shall produce a compatibility matrix showing each ESM-pinned package, its usage context (server/client/both), and whether upgrading to the ESM-only version is feasible.

### Requirement 3: License Compliance Verification

**Objective:** As a maintainer, I want to confirm that the handsontable/`@handsontable/react` licensing situation has not changed, so that I can determine whether these packages must remain pinned or can be replaced.

#### Acceptance Criteria

1. When evaluating handsontable, the audit process shall verify the current license of handsontable v7.0.0+ and confirm whether it remains non-MIT.
2. If handsontable v7.0.0+ is still non-MIT, the audit process shall document that `handsontable` (`=6.2.2`) and `@handsontable/react` (`=2.1.0`) must remain pinned or an alternative library must be identified.
3. If a MIT-licensed alternative to handsontable exists, the audit process shall note it as a potential replacement candidate (out of scope for this spec but documented for future work).

### Requirement 4: Safe Upgrade Execution

**Objective:** As a maintainer, I want to upgrade packages that are confirmed safe to update, so that the project benefits from bug fixes, security patches, and new features.

#### Acceptance Criteria

1. When upgrading a pinned package, the upgrade process shall update the version specifier in `apps/app/package.json` and remove or update the corresponding entry in the `// comments for dependencies` or `// comments for defDependencies` block.
2. When a package is upgraded, the upgrade process shall verify that `turbo run build --filter @growi/app` completes successfully.
3. When a package is upgraded, the upgrade process shall verify that `turbo run lint --filter @growi/app` completes without new errors.
4. When a package is upgraded, the upgrade process shall verify that `turbo run test --filter @growi/app` passes without new failures.
5. If a package upgrade causes build, lint, or test failures, the upgrade process shall revert that specific package change and document the failure reason.
6. When all upgrades are complete, the `// comments for dependencies` and `// comments for defDependencies` blocks shall accurately reflect only the packages that remain pinned, with updated reasons if applicable.

### Requirement 5: Audit Documentation

**Objective:** As a maintainer, I want a clear record of the audit results, so that future maintainers understand which packages were evaluated and why decisions were made.

#### Acceptance Criteria

1. The audit process shall produce a summary table documenting each pinned package with: package name, previous version, new version (or "unchanged"), and rationale for the decision.
2. When a package remains pinned, the documentation shall include the verified reason for continued pinning.
3. When a package is upgraded, the documentation shall note what changed upstream that made the upgrade possible.
