/**
 * Tests for the cjs-to-esm jscodeshift transform.
 * Uses vitest as the test runner and jscodeshift's applyTransform as the test utility.
 *
 * Patterns covered:
 *   P1: module.exports → named export
 *   P2: static require('./x') → import x from './x'
 *   P3: factory invoke require('./x')(crowi, app) → import { setup } + invoke
 *   P4: ternary × factory invoke (enclosing non-async)
 *   P5: destructuring require: const { x } = require('pkg') → named import
 *   P6: partial namespace require('pkg').member → named import
 *   P7: dynamic require(modulePath)(ctx) → await import + singleton memoize
 *   P8: exclusion list — intentional lazy require must not be transformed
 * Plus: config specifier rewrite (/config/*.{js,ts} → .cjs)
 */

import { createRequire } from 'node:module';
import jscodeshift from 'jscodeshift';
import { describe, expect, it } from 'vitest';

// Load the transform module. It is a CommonJS module (jscodeshift transform convention).
// We use createRequire so vitest can resolve from the correct directory.
const require = createRequire(import.meta.url);
const transform = require('./cjs-to-esm.cjs');

/** Call the transform and return trimmed output (matches jscodeshift testUtils behavior). */
function applyTransform(
  source: string,
  filePath = 'src/server/dummy.ts',
): string {
  const j = jscodeshift.withParser('ts');
  const result = transform(
    { source, path: filePath },
    { jscodeshift: j, j, stats: () => {} },
    {},
  );
  return (result || '').trim();
}

// ─── Pattern 1: module.exports → named export ────────────────────────────────

describe('P1: module.exports → named export', () => {
  it('converts module.exports = function factory to export function setup', () => {
    const input = `
module.exports = (crowi, app) => {
  const router = express.Router();
  return router;
};
`.trim();

    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`
      "export const setup = (crowi, app) => {
        const router = express.Router();
        return router;
      };"
    `);
  });

  it('converts module.exports = class to export default class', () => {
    const input = `
class MyClass {
  hello() {}
}
module.exports = MyClass;
`.trim();
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`
      "class MyClass {
        hello() {}
      }
      export default MyClass;"
    `);
  });

  it('converts module.exports = identifier to export default identifier', () => {
    const input = `
const service = new MyService();
module.exports = service;
`.trim();
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`
      "const service = new MyService();
      export default service;"
    `);
  });
});

// ─── Pattern 2: static require('./x') → import ───────────────────────────────

describe('P2: static require → import', () => {
  it('converts const x = require("./x") to import x from "./x"', () => {
    const input = `const express = require('express');`;
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`"import express from 'express';"`);
  });

  it('converts multiple static requires', () => {
    const input = `
const multer = require('multer');
const autoReap = require('multer-autoreap');
`.trim();
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`
      "import multer from 'multer';
      import autoReap from 'multer-autoreap';"
    `);
  });
});

// ─── Pattern 3: factory invoke require('./x')(crowi) → import + invoke ────────

describe('P3: factory invoke → import { setup } + invoke', () => {
  it('converts require("./x")(crowi) to import { setup as setupX } + call', () => {
    const input = `
const healthcheck = require('./healthcheck')(crowi);
`.trim();
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`
      "import { setup as setupHealthcheck } from './healthcheck';
      const healthcheck = setupHealthcheck(crowi);"
    `);
  });

  it('converts require("./x")(crowi, app) with two args', () => {
    const input = `
const page = require('./page')(crowi, app);
`.trim();
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`
      "import { setup as setupPage } from './page';
      const page = setupPage(crowi, app);"
    `);
  });

  it('converts inline router.use require factory invoke', () => {
    const input = `
router.use('/healthcheck', require('./healthcheck')(crowi));
`.trim();
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`
      "import { setup as setupHealthcheck } from './healthcheck';
      router.use('/healthcheck', setupHealthcheck(crowi));"
    `);
  });
});

// ─── Pattern 4: ternary × factory invoke ─────────────────────────────────────

describe('P4: ternary × factory invoke (non-async enclosing)', () => {
  it('converts ternary with factory require in false branch', () => {
    // Extracted from routes/apiv3/index.js:124
    const input = `
import { allreadyInstalledMiddleware } from '~/server/middlewares/application-not-installed';
routerForAdmin.use(
  '/installer',
  isInstalled ? allreadyInstalledMiddleware : require('./installer')(crowi),
);
`.trim();
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`
      "import { allreadyInstalledMiddleware } from '~/server/middlewares/application-not-installed';
      import { setup as setupInstaller } from './installer';
      routerForAdmin.use(
        '/installer',
        isInstalled ? allreadyInstalledMiddleware : setupInstaller(crowi),
      );"
    `);
  });
});

// ─── Pattern 5: destructuring require → named import ─────────────────────────

describe('P5: destructuring require → named import', () => {
  it('converts const { x } = require("pkg") to import { x } from "pkg"', () => {
    const input = `const { createApiRouter } = require('~/server/util/createApiRouter');`;
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(
      `"import { createApiRouter } from '~/server/util/createApiRouter';"`,
    );
  });

  it('converts const { x, y } = require("pkg") to named imports', () => {
    const input = `const { sync, genSyncFunc } = require('uid-safe');`;
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(
      `"import { sync, genSyncFunc } from 'uid-safe';"`,
    );
  });
});

// ─── Pattern 6: partial namespace require('pkg').member ──────────────────────

describe('P6: partial namespace require("pkg").member', () => {
  it('converts require("eazy-logger").Logger(...) to named import + call', () => {
    // Extracted from crowi/dev.js:65
    const input = `
const eazyLogger = require('eazy-logger').Logger({
  prefix: '[{green:GROWI}] ',
  useLevelPrefixes: false,
});
`.trim();
    const output = applyTransform(input);
    // Note: recast adds a blank line after an import when the original node was multi-line.
    // This is acceptable formatting for a codemod tool.
    expect(output).toMatchInlineSnapshot(`
      "import { Logger } from 'eazy-logger';

      const eazyLogger = Logger({
        prefix: '[{green:GROWI}] ',
        useLevelPrefixes: false,
      });"
    `);
  });

  it('converts require("uid-safe").sync to named import', () => {
    // Extracted from crowi/index.ts:364
    const input = `const uid = require('uid-safe').sync;`;
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(
      `"import { sync as uid } from 'uid-safe';"`,
    );
  });

  it('converts require("crypto").createHash to named import', () => {
    // Extracted from models/attachment.ts:16
    const input = `const hash = require('crypto').createHash('md5');`;
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`
      "import { createHash } from 'crypto';
      const hash = createHash('md5');"
    `);
  });
});

// ─── Pattern 7: dynamic require(modulePath)(ctx) → await import ──────────────

describe('P7: dynamic require(modulePath)(ctx) → await import', () => {
  it('converts require(modulePath)(crowi) to (await import(modulePath)).default(crowi)', () => {
    // Extracted from service/file-uploader/index.ts:16
    const input = `
const uploader = require(modulePath)(crowi);
`.trim();
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(
      `"const uploader = ((await import(modulePath)).default ?? (await import(modulePath)))(crowi);"`,
    );
  });

  it('converts require(modulePath)(crowi) in class method body', () => {
    // Extracted from service/s2s-messaging/index.ts:60
    const input = `
this.delegator = require(modulePath)(crowi);
`.trim();
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(
      `"this.delegator = ((await import(modulePath)).default ?? (await import(modulePath)))(crowi);"`,
    );
  });

  it('converts require(modulePath)(crowi) inside try-catch', () => {
    // Extracted from service/slack-integration.ts:288
    const input = `
try {
  handler = require(modulePath)(this.crowi);
} catch (err) {
  throw err;
}
`.trim();
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(`
      "try {
        handler = ((await import(modulePath)).default ?? (await import(modulePath)))(this.crowi);
      } catch (err) {
        throw err;
      }"
    `);
  });
});

// ─── Pattern 8: exclusion list ───────────────────────────────────────────────

describe('P8: exclusion list — intentional lazy require must NOT be transformed', () => {
  it('does NOT transform setupMailer lazy require in crowi/index.ts at line ~500', () => {
    // The exclusion list entry for crowi/index.ts:setupMailer.
    // Must be wrapped in a class so the TS parser accepts the method body.
    const input = `
class Crowi {
  async setupMailer() {
    const MailService = require('~/server/service/mail').default;
    this.mailService = new MailService(this);
  }
}
`.trim();
    // When the file path is crowi/index.ts, the excluded require must remain unchanged.
    const output = applyTransform(input, 'src/server/crowi/index.ts');
    // Transform returns undefined (no-op) → applyTransform returns ''.
    // The source is left untouched: the caller can compare '' to detect no-op.
    expect(output).toBe('');
  });
});

// ─── Specifier rewrite: /config/*.cjs ────────────────────────────────────────

describe('Config specifier rewrite (.cjs)', () => {
  it('rewrites import from ~/config/migrate-mongo-config to .cjs', () => {
    const input = `import config from '~/config/migrate-mongo-config';`;
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(
      `"import config from '~/config/migrate-mongo-config.cjs';"`,
    );
  });

  it('rewrites import from ~/config/next-i18next.config to .cjs', () => {
    const input = `import config from '~/config/next-i18next.config';`;
    const output = applyTransform(input);
    expect(output).toMatchInlineSnapshot(
      `"import config from '~/config/next-i18next.config.cjs';"`,
    );
  });

  it('rewrites import from ~/config/i18next.config to .cjs', () => {
    const input = `const i18n = require('~/config/i18next.config');`;
    const output = applyTransform(input);
    // The require becomes an import with .cjs specifier
    expect(output).toMatchInlineSnapshot(
      `"import i18n from '~/config/i18next.config.cjs';"`,
    );
  });

  it('does not rewrite specifiers that already have .cjs extension', () => {
    // The specifier already ends in .cjs, so no change is made.
    // jscodeshift returns undefined for no-op → applyTransform returns ''.
    const input = `import config from '~/config/migrate-mongo-config.cjs';`;
    const output = applyTransform(input);
    expect(output).toBe('');
  });
});
