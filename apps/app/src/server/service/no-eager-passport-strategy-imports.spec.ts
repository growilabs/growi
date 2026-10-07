import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOOT_ENTRYPOINTS } from '~/test-utils/boot-entrypoints';
import {
  formatViolation,
  traceStaticImportChains,
} from '~/test-utils/static-import-graph';

// --- Contract --------------------------------------------------------------
//
// Every tenant boots the passport service, but the strategy SDKs are only
// needed by tenants that actually enable the matching external auth provider.
// Two of them are expensive to load: passport-ldapauth drags in ldapjs
// (+18.4 MiB RSS measured) and openid-client drags in jose (84 files). Loading
// them at boot for the local-auth-only majority is pure waste.
//
// So these five strategy SDKs must only load when their strategy is actually
// set up (i.e. enabled in config) — reached through a dynamic import()
// executed *after* the per-strategy "isEnabled" check inside each
// setupXStrategy() method, never through a top-level import.
//
// passport itself and passport-local (always used) stay static, as do all
// `import type` lines (erased at build).
//
// Two walks guard this from different angles, mirroring the mail-transport
// boundary spec:
//
// 1. From the passport service module itself (server/service/passport.ts):
//    guards the module's *internal* static graph, which is exactly where a
//    top-level `import { Strategy } from 'passport-saml'` would reintroduce
//    the cost unconditionally.
// 2. From the server's boot entrypoints (shared BOOT_ENTRYPOINTS): crowi
//    reaches the passport service through a *static* import, so this is the
//    realistic boot-time leak path — and it also catches any *other*
//    boot-reachable module (an admin route, another service) adding a
//    top-level import of one of these packages.
//
// Dynamic import() calls are treated as boundaries (not followed), matching
// runtime behavior: they only load when executed. `import type` lines are
// skipped (erased at build) — the type-only `Profile`/`VerifiedCallback`
// imports from passport-saml are fine and must remain.

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const STRATEGY_PACKAGE =
  /^(openid-client|passport-ldapauth|ldapjs|passport-saml|passport-github|passport-google-oauth20)($|\/)/;

const PASSPORT_ENTRYPOINTS = ['server/service/passport.ts'];

describe('lazy-load boundary for passport strategy SDKs', () => {
  it('has no static import chain from the passport service to openid-client / passport-ldapauth / ldapjs / passport-saml / passport-github / passport-google-oauth20', () => {
    const violations = traceStaticImportChains({
      srcRoot: SRC_ROOT,
      entrypoints: PASSPORT_ENTRYPOINTS,
      bannedPattern: STRATEGY_PACKAGE,
    });
    const formatted = violations.map(formatViolation);

    expect(
      formatted,
      `The passport service must not statically reach strategy SDKs.\n` +
        `Import each strategy SDK via a dynamic import() inside its setupXStrategy() ` +
        `method, after the "isEnabled" check, instead of a top-level import.\n\n` +
        `${formatted.join('\n\n')}`,
    ).toEqual([]);
  });

  // Guards the tracer itself: if the entrypoint were renamed/moved, the walk
  // would silently trace nothing and the boundary test above would pass
  // vacuously.
  it('still finds the passport service entrypoint it traces from', () => {
    for (const entry of PASSPORT_ENTRYPOINTS) {
      expect(
        fs.existsSync(path.join(SRC_ROOT, entry)),
        `passport entrypoint disappeared: ${entry} — update PASSPORT_ENTRYPOINTS`,
      ).toBe(true);
    }
  });
});

describe('boot-time import boundary for passport strategy SDKs', () => {
  it('has no static import chain from a boot entrypoint to openid-client / passport-ldapauth / ldapjs / passport-saml / passport-github / passport-google-oauth20', () => {
    const violations = traceStaticImportChains({
      srcRoot: SRC_ROOT,
      entrypoints: BOOT_ENTRYPOINTS,
      bannedPattern: STRATEGY_PACKAGE,
    });
    const formatted = violations.map(formatViolation);

    expect(
      formatted,
      `Boot entrypoints must not statically reach passport strategy SDKs.\n` +
        `crowi reaches the passport service through a static import, so a top-level ` +
        `strategy-SDK import there (or in any other boot-reachable module) loads ` +
        `ldapjs/jose for every tenant at boot. Load each SDK via a dynamic import() ` +
        `inside its setupXStrategy() method instead.\n\n` +
        `${formatted.join('\n\n')}`,
    ).toEqual([]);
  });

  // Guards the tracer itself: if the boot entrypoints were renamed/moved, the
  // walk would silently trace nothing and the boundary test above would pass
  // vacuously.
  it('still finds every boot entrypoint it traces from', () => {
    for (const entry of BOOT_ENTRYPOINTS) {
      expect(
        fs.existsSync(path.join(SRC_ROOT, entry)),
        `boot entrypoint disappeared: ${entry} — update BOOT_ENTRYPOINTS`,
      ).toBe(true);
    }
  });
});
