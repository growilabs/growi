import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPEC_TMP_PREFIX } from '../fixtures';

// Req 9.1 / 9.5: the image check compares the document the container serves
// with the one scripts/export-openapi.ts writes (research.md 17.7, 27.8), by
// running scripts/check-openapi-drift.ts as a command, with plain `node` as
// the CI job does. Python check_openapi_drift.py's command line.

const SCRIPT = fileURLToPath(
  new URL('../../scripts/check-openapi-drift.ts', import.meta.url),
);

let workDir = '';
beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), `${SPEC_TMP_PREFIX}drift-cli-`));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const fileWith = (name: string, text: string): string => {
  const file = path.join(workDir, name);
  writeFileSync(file, text);
  return file;
};

const compare = (...args: readonly string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
  });

describe('scripts/check-openapi-drift.ts as a command', () => {
  it('exits 0 when the two files hold the same JSON, whatever the key order', () => {
    const served = fileWith('served.json', '{"a":1,"b":{"c":[1,2],"d":"x"}}');
    const written = fileWith(
      'written.json',
      '{\n  "b": { "d": "x", "c": [1, 2] },\n  "a": 1\n}\n',
    );

    const result = compare(served, written);

    expect(result.status).toBe(0);
  });

  it('exits 1 and names each place that differs', () => {
    const served = fileWith('served-2.json', '{"a":1,"b":{"c":[1,2]}}');
    const written = fileWith('written-2.json', '{"a":2,"b":{"c":[1,3]}}');

    const result = compare(served, written);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('/a');
    expect(result.stderr).toContain('/b/c/1');
  });

  it.each([
    ['one file is missing', (ok: string) => [ok, path.join(workDir, 'none')]],
    ['one file is not JSON', (ok: string) => [ok, fileWith('bad.json', '{')]],
    ['a file argument is left out', (ok: string) => [ok]],
  ])('exits 2, not 0 or 1, when %s', (_, argsFor) => {
    const ok = fileWith('ok.json', '{}');

    const result = compare(...argsFor(ok));

    expect(result.status).toBe(2);
  });
});
