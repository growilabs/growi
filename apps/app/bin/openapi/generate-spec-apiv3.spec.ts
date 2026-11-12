import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isHttpMethod } from './http-methods';

/**
 * Contract test for the apiv3 spec generation script.
 *
 * The script is consumed by an *external* repository: growi-docs' `api:build`
 * runs it as `APP_PATH=tmp/growi/apps/app sh "${APP_PATH}/bin/openapi/generate-spec-apiv3.sh"`
 * and publishes the result to docs.growi.org. So the contract under test is the
 * one that caller depends on, exercised the way it actually calls it — a child
 * `sh <script>` process with APP_PATH given as a **bare relative path**.
 *
 * Regression guard for #11634: `node --import` resolves its value as an ES
 * module specifier, not as a filesystem path, so a bare relative APP_PATH made
 * Node read `tmp/growi/...` as a *package name* and fail with
 * ERR_MODULE_NOT_FOUND. The injection step never ran, yet the script still
 * exited 0 and printed "generated and transformed" — publishing a spec with no
 * operationId, which silently renamed every symbol in the generated SDKs.
 *
 * `swagger-jsdoc` is stubbed so these tests exercise the script's wiring and
 * failure propagation rather than re-scanning every route file (that is what
 * `generate-operation-ids.spec.ts` and the real build cover).
 */

const APP_ROOT = resolve(import.meta.dirname, '..', '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const SCRIPT = 'apps/app/bin/openapi/generate-spec-apiv3.sh';

/** Two operations taken from the endpoints named in #11634, with no operationId. */
const SPEC_WITHOUT_OPERATION_IDS = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'test', version: '1.0.0' },
  paths: {
    '/page/exist': { get: { responses: { 200: { description: 'ok' } } } },
    '/pages/delete': { post: { responses: { 200: { description: 'ok' } } } },
  },
});

describe.skipIf(process.platform === 'win32')('generate-spec-apiv3.sh', () => {
  let dir: string;
  let stubDir: string;
  let out: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'generate-spec-apiv3-'));
    stubDir = join(dir, 'bin');
    out = join(dir, 'openapi-spec-apiv3.json');
    writeFileSync(join(dir, 'fixture.json'), SPEC_WITHOUT_OPERATION_IDS);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Put a stub `swagger-jsdoc` first on PATH. It copies `payloadFile` to the
   * path given after `-o`, mimicking the real generator's only observable
   * effect, and exits with `exitCode`.
   */
  const stubSwaggerJsdoc = (payloadFile: string, exitCode = 0): void => {
    const stub = join(stubDir, 'swagger-jsdoc');
    mkdirSync(stubDir, { recursive: true });
    writeFileSync(
      stub,
      [
        '#!/bin/sh',
        'while [ $# -gt 0 ]; do',
        '  if [ "$1" = "-o" ]; then shift; OUTF="$1"; fi',
        '  shift',
        'done',
        `cat "${payloadFile}" > "$OUTF"`,
        `exit ${exitCode}`,
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    chmodSync(stub, 0o755);
  };

  /** Run the script the way growi-docs does: bare relative APP_PATH, from the repo root. */
  const runScript = () =>
    spawnSync('sh', [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_PATH: 'apps/app',
        OUT: out,
        PATH: `${stubDir}${delimiter}${process.env.PATH ?? ''}`,
      },
    });

  it('injects an operationId into every operation when APP_PATH is a bare relative path', () => {
    stubSwaggerJsdoc(join(dir, 'fixture.json'));

    const result = runScript();

    expect(result.status).toBe(0);

    const spec = JSON.parse(readFileSync(out, 'utf8'));

    // The published names the SDK generates from (#11634 lists both).
    expect(spec.paths['/page/exist'].get.operationId).toBe('getExistForPage');
    expect(spec.paths['/pages/delete'].post.operationId).toBe(
      'postDeleteForPages',
    );

    // Drift guard: no operation may reach the artifact without an id, however
    // the injection step is wired up.
    const withoutId = Object.entries<Record<string, { operationId?: string }>>(
      spec.paths,
    ).flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([method]) => isHttpMethod(method))
        .filter(([, operation]) => operation.operationId == null)
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );
    expect(withoutId).toEqual([]);
  });

  it('fails and does not claim success when the operationId injection step fails', () => {
    writeFileSync(join(dir, 'fixture.json'), 'this is not valid json');
    stubSwaggerJsdoc(join(dir, 'fixture.json'));

    const result = runScript();

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('generated and transformed');
  });

  it('fails when the swagger-jsdoc step itself fails', () => {
    stubSwaggerJsdoc(join(dir, 'fixture.json'), 1);

    const result = runScript();

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('generated and transformed');
  });
});
