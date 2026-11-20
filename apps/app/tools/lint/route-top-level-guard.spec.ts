/**
 * Tests for the route top-level side-effect guard (task 3.3.h).
 *
 * The guard enforces that route modules under src/server/routes/ contain no
 * top-level statements other than imports, type declarations, function
 * declarations, exports, and variable declarations with provably
 * crowi-independent initializers. It also forbids any CJS syntax
 * (require / module.exports) as a regression guard for Req 2.2 / 2.3.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { collectViolations } = require('./route-top-level-guard.cjs');

const check = (source: string): string[] =>
  collectViolations(source, 'fixture.ts').map((v: { rule: string }) => v.rule);

describe('route-top-level-guard: allowed constructs', () => {
  it('accepts imports, types, function declarations, and export setup', () => {
    const src = `
import express from 'express';
import type { Router } from 'express';
import loggerFactory from '~/utils/logger';

interface Foo { a: string }
type Bar = string;

function helper() { return 1; }

const logger = loggerFactory('growi:routes:fixture');
const router = express.Router();
const NAME = 'fixture';
const LIMIT = 100;
const template = \`v\${NAME}\`;
const validator = { rules: [] };
const list = [1, 2, 3];
const fn = (a) => a + 1;
let cache;

export const setup = (crowi) => {
  router.get('/', (req, res) => res.json({}));
  return router;
};
`;
    expect(check(src)).toEqual([]);
  });

  it('accepts allowlisted call initializers (Router(), Buffer.from)', () => {
    const src = `
import { Router } from 'express';
const router = Router();
const empty = Buffer.from('');
export const setup = () => router;
`;
    expect(check(src)).toEqual([]);
  });

  it('accepts export * re-exports', () => {
    const src = `export * from './sub-module';`;
    expect(check(src)).toEqual([]);
  });
});

describe('route-top-level-guard: violations', () => {
  it('rejects top-level expression statements (side effects)', () => {
    const src = `
import autoReap from 'multer-autoreap';
autoReap.options.reapOnError = true;
export const setup = () => {};
`;
    expect(check(src)).toContain('top-level-statement');
  });

  it('rejects top-level non-allowlisted call initializers', () => {
    const src = `
import fs from 'node:fs';
const data = fs.readFileSync('/etc/passwd');
export const setup = () => {};
`;
    expect(check(src)).toContain('top-level-call');
  });

  it('rejects top-level new expressions', () => {
    const src = `
const today = new Date();
export const setup = () => {};
`;
    expect(check(src)).toContain('top-level-call');
  });

  it('rejects require() anywhere (CJS regression guard)', () => {
    const src = `
export const setup = (crowi) => {
  const page = require('./page').setup(crowi);
  return page;
};
`;
    expect(check(src)).toContain('cjs-require');
  });

  it('rejects module.exports anywhere (CJS regression guard)', () => {
    const src = `
module.exports = (crowi) => {};
`;
    expect(check(src)).toContain('cjs-module-exports');
  });

  it('rejects exports.x assignments anywhere, including inside setup', () => {
    const src = `
export const setup = (crowi) => {
  exports.helper = () => crowi;
};
`;
    expect(check(src)).toContain('cjs-module-exports');
  });

  it('rejects top-level crowi-dependent execution', () => {
    const src = `
import mongoose from 'mongoose';
const Page = mongoose.model('Page');
export const setup = () => {};
`;
    expect(check(src)).toContain('top-level-call');
  });
});

describe('route-top-level-guard: cjsOnly mode (import/no-commonjs equivalent)', () => {
  const checkCjsOnly = (source: string): string[] =>
    collectViolations(source, 'fixture.ts', { cjsOnly: true }).map(
      (v: { rule: string }) => v.rule,
    );

  it('still rejects require / module.exports', () => {
    expect(checkCjsOnly(`const x = require('y');`)).toContain('cjs-require');
    expect(checkCjsOnly(`module.exports = {};`)).toContain(
      'cjs-module-exports',
    );
  });

  it('does not apply the top-level shape rule', () => {
    const src = `
import mongoose from 'mongoose';
const Page = mongoose.model('Page');
new Date();
`;
    expect(checkCjsOnly(src)).toEqual([]);
  });

  it('allows typeof require guards (not a call)', () => {
    const src = `
const cjsRequire = typeof require === 'function' ? require : undefined;
if (cjsRequire) { cjsRequire.extensions['.ts'] = undefined; }
`;
    expect(checkCjsOnly(src)).toEqual([]);
  });
});
