import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { openApiDocument } from '../../src/http/openapi-route';
import { recordOf } from '../../src/http/spec-support/extract-client';
import { TS_NODE_ARGS } from '../../src/runner/spec-support';
import { SPEC_TMP_PREFIX } from '../fixtures';
import {
  readCommittedOpenApi,
  textAt,
  withoutDescriptions,
} from './openapi-support';

// Req 7.1: `scripts/export-openapi.ts --output <path>` writes the service's
// document, the file 8.2 commits to the client package. Run as its own
// process, as the package script runs it. Python test_export_openapi.py.

const SCRIPT = fileURLToPath(
  new URL('../../scripts/export-openapi.ts', import.meta.url),
);
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const run = promisify(execFile);

let workDir = '';
beforeAll(() => {
  workDir = mkdtempSync(
    path.join(tmpdir(), `${SPEC_TMP_PREFIX}export-openapi-`),
  );
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const exportTo = async (output: string): Promise<Record<string, unknown>> => {
  await run(process.execPath, [...TS_NODE_ARGS, SCRIPT, '--output', output], {
    cwd: PACKAGE_ROOT,
  });
  return recordOf(JSON.parse(readFileSync(output, 'utf8')));
};

describe('scripts/export-openapi.ts', () => {
  it('writes the service document as JSON', async () => {
    const written = await exportTo(path.join(workDir, 'openapi.json'));

    expect(written).toEqual(JSON.parse(JSON.stringify(openApiDocument)));
  }, 60_000);

  it('creates the parent directories of --output', async () => {
    const output = path.join(workDir, 'a', 'b', 'openapi.json');

    await exportTo(output);

    expect(existsSync(output)).toBe(true);
  }, 60_000);

  it('writes an OpenAPI 3.1 document with the three operations and five schemas', async () => {
    const written = await exportTo(path.join(workDir, 'shape.json'));

    expect(written.openapi).toBe('3.1.0');
    expect(Object.keys(written).sort()).toEqual([
      'components',
      'info',
      'openapi',
      'paths',
    ]);
    expect(Object.keys(recordOf(written.paths)).sort()).toEqual([
      '/extract',
      '/healthz',
      '/readyz',
    ]);
    expect(
      Object.keys(recordOf(textAt(written, ['components', 'schemas']))).sort(),
    ).toEqual([
      'Body_post_extract_extract_post',
      'ErrorCode',
      'ErrorResponse',
      'ExtractResponse',
      'PageInfo',
    ]);
  }, 60_000);

  it('documents every error status of POST /extract through ErrorResponse', async () => {
    const written = await exportTo(path.join(workDir, 'errors.json'));

    for (const status of ['400', '408', '413', '422', '500', '503']) {
      expect(
        textAt(written, [
          'paths',
          '/extract',
          'post',
          'responses',
          status,
          'content',
          'application/json',
          'schema',
          '$ref',
        ]),
        status,
      ).toBe('#/components/schemas/ErrorResponse');
    }
  }, 60_000);

  it('matches the committed client document apart from descriptions', async () => {
    const written = await exportTo(path.join(workDir, 'drift.json'));

    expect(withoutDescriptions(written)).toStrictEqual(
      withoutDescriptions(readCommittedOpenApi()),
    );
  }, 60_000);

  it('fails without --output', async () => {
    await expect(
      run(process.execPath, [...TS_NODE_ARGS, SCRIPT], { cwd: PACKAGE_ROOT }),
    ).rejects.toThrow();
  }, 60_000);
});
