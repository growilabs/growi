import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { getPath, jsonOf } from '../../src/http/spec-support/extract-client';
import { fakeRunner } from '../../src/http/spec-support/fake-runner';
import { startTestService } from '../../src/http/spec-support/test-service';
import { TS_NODE_ARGS } from '../../src/runner/spec-support';
import { SPEC_TMP_PREFIX } from '../fixtures';

// Req 7.1: `scripts/export-openapi.ts --output <path>` writes the document
// GET /openapi.json serves, the file 8.2 commits to the client package. Run
// as its own process, as the package script runs it. Python
// test_export_openapi.py.

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

const exportTo = async (output: string): Promise<unknown> => {
  await run(process.execPath, [...TS_NODE_ARGS, SCRIPT, '--output', output], {
    cwd: PACKAGE_ROOT,
  });
  return JSON.parse(readFileSync(output, 'utf8'));
};

describe('scripts/export-openapi.ts', () => {
  // Settings other than the defaults: the document must not depend on them.
  it('writes exactly the document GET /openapi.json serves', async () => {
    const service = await startTestService(fakeRunner(), {
      MAX_FILE_SIZE_MB: '1',
      MAX_CONCURRENCY: '1',
      UPLOAD_TIMEOUT_S: '2',
    });
    try {
      const served = jsonOf(await getPath(service.url, '/openapi.json'));

      const written = await exportTo(path.join(workDir, 'openapi.json'));

      expect(written).toStrictEqual(served);
    } finally {
      await service.close();
    }
  }, 60_000);

  it('creates the parent directories of --output', async () => {
    const output = path.join(workDir, 'a', 'b', 'openapi.json');

    await exportTo(output);

    expect(existsSync(output)).toBe(true);
  }, 60_000);

  it('fails without --output', async () => {
    await expect(
      run(process.execPath, [...TS_NODE_ARGS, SCRIPT], { cwd: PACKAGE_ROOT }),
    ).rejects.toThrow();
  }, 60_000);
});
