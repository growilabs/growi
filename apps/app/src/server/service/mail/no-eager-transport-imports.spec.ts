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
// nodemailer (~13-19MB RSS) and nodemailer-ses-transport, which drags in the
// full aws-sdk v2 (~23MB RSS), must only load once a mail transport is
// actually selected by config — not merely because the mail service module
// itself was loaded, and not merely because the server booted.
//
// Two walks guard this from different angles:
//
// 1. From the mail service's own barrel (not a server boot entrypoint: crowi
//    loads this module via a dynamic `import()`, which is itself already a
//    boundary the walker won't cross — this walk instead guards the module's
//    *internal* static graph, which is where a `./smtp`/`./ses`/`./oauth2`
//    top-level import would reintroduce the cost unconditionally).
// 2. From the server's boot entrypoints (shared with the heavy-AI-package
//    boundary spec, see `test-utils/boot-entrypoints`). This is the
//    realistic leak path: crowi only reaches the mail service through a
//    dynamic import(), so walk (1) alone would miss a top-level transport
//    import sneaking into some *other* module reachable from boot — e.g. an
//    admin route module under routes/apiv3 statically importing
//    `~/server/service/mail/smtp` (see app-settings/index.ts, which does this
//    lazily via a dynamic import() specifically to avoid the regression this
//    walk catches).
//
// Dynamic import() calls are treated as boundaries (not followed). `import
// type` lines are skipped (erased at build) — the type-only nodemailer
// imports in types.ts/smtp.ts/ses.ts/oauth2.ts are fine and must remain.

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

const TRANSPORT_PACKAGE =
  /^(nodemailer|nodemailer-ses-transport|aws-sdk)($|\/)/;

const MAIL_ENTRYPOINTS = ['server/service/mail/index.ts'];

describe('lazy-load boundary for mail transport packages', () => {
  it('has no static import chain from the mail service entry to nodemailer / nodemailer-ses-transport / aws-sdk', () => {
    const violations = traceStaticImportChains({
      srcRoot: SRC_ROOT,
      entrypoints: MAIL_ENTRYPOINTS,
      bannedPattern: TRANSPORT_PACKAGE,
    });
    const formatted = violations.map(formatViolation);

    expect(
      formatted,
      `The mail service entry must not statically reach transport packages.\n` +
        `Select the transport factory via a dynamic import() keyed by the ` +
        `configured transmission method instead of a top-level import.\n\n` +
        `${formatted.join('\n\n')}`,
    ).toEqual([]);
  });

  // Guards the tracer itself: if the entrypoint were renamed/moved, the walk
  // would silently trace nothing and the boundary test above would pass
  // vacuously.
  it('still finds the mail service entrypoint it traces from', () => {
    for (const entry of MAIL_ENTRYPOINTS) {
      expect(
        fs.existsSync(path.join(SRC_ROOT, entry)),
        `mail entrypoint disappeared: ${entry} — update MAIL_ENTRYPOINTS`,
      ).toBe(true);
    }
  });
});

describe('boot-time import boundary for mail transport packages', () => {
  it('has no static import chain from a boot entrypoint to nodemailer / nodemailer-ses-transport / aws-sdk', () => {
    const violations = traceStaticImportChains({
      srcRoot: SRC_ROOT,
      entrypoints: BOOT_ENTRYPOINTS,
      bannedPattern: TRANSPORT_PACKAGE,
    });
    const formatted = violations.map(formatViolation);

    expect(
      formatted,
      `Boot entrypoints must not statically reach transport packages.\n` +
        `crowi reaches the mail service only through a dynamic import(), so this ` +
        `catches the realistic leak: a *different* boot-reachable module (e.g. an ` +
        `admin route under routes/apiv3) adding a top-level ` +
        `'~/server/service/mail/smtp'-style import. Load the transport factory via a ` +
        `dynamic import() at the call site instead.\n\n` +
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
