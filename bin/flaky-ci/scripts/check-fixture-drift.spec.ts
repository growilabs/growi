import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { type GhApi, GhError, type GhParams } from '../lib/gh.ts';
import { checkFixtureDrift, parseArgv } from './check-fixture-drift.ts';

describe('check-fixture-drift.parseArgv', () => {
  it('returns help for --help', () => {
    expect(parseArgv(['--help'])).toEqual({ kind: 'help' });
  });

  it('returns args for an empty argv (this script takes no arguments)', () => {
    expect(parseArgv([])).toEqual({ kind: 'args' });
  });

  it('rejects any positional/flag argument', () => {
    const result = parseArgv(['--issue', '1']);
    expect(result.kind).toBe('invalid');
  });
});

/** A `GhApi` whose `get`/`getAll` always return the given value, verbatim, and record calls made to them. */
const fakeGhApi = (
  value: unknown,
  calls: Array<{ method: 'get' | 'getAll'; path: string; params?: GhParams }>,
): GhApi => ({
  get: (p: string, params?: GhParams) => {
    calls.push({ method: 'get', path: p, params });
    return Promise.resolve(value as never);
  },
  getAll: (p: string, params?: GhParams) => {
    calls.push({ method: 'getAll', path: p, params });
    return Promise.resolve(value as never);
  },
});

/** A `GhApi` that throws if either method is called — for asserting no GitHub call is made. */
const noCallGhApi = (): GhApi => ({
  get: () => {
    throw new Error('unexpected call to GhApi.get in this test');
  },
  getAll: () => {
    throw new Error('unexpected call to GhApi.getAll in this test');
  },
});

const failingGhApi = (error: unknown): GhApi => ({
  get: () => Promise.reject(error),
  getAll: () => Promise.reject(error),
});

describe('check-fixture-drift.checkFixtureDrift', () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot != null) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  const makeFixturesDir = (): string => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'check-fixture-drift-'));
    const fixturesDir = path.join(tmpRoot, 'fixtures');
    mkdirSync(path.join(fixturesDir, 'api'), { recursive: true });
    return fixturesDir;
  };

  it('reports no drift when the live response has the same shape as the on-disk fixture', async () => {
    const fixturesDir = makeFixturesDir();
    writeFileSync(
      path.join(fixturesDir, 'api', 'issue-1-comments.json'),
      JSON.stringify([{ id: 1, body: 'hi' }]),
    );
    writeFileSync(
      path.join(fixturesDir, 'api', 'issue-1-comments.json.meta.md'),
      '# Source\n\n- **Real.** `gh api -X GET repos/growilabs/growi/issues/1/comments`.\n',
    );

    const calls: Array<{ method: 'get' | 'getAll'; path: string }> = [];
    const ghApi = fakeGhApi([{ id: 2, body: 'bye' }], calls);

    const result = await checkFixtureDrift(ghApi, fixturesDir);

    expect(result).toEqual({ checked: 1, drift: [], unchecked: [] });
    expect(calls).toEqual([
      {
        method: 'get',
        path: 'repos/growilabs/growi/issues/1/comments',
        params: {},
      },
    ]);
  });

  it('reports drift when the live response has a different shape (added/removed/changed key)', async () => {
    const fixturesDir = makeFixturesDir();
    writeFileSync(
      path.join(fixturesDir, 'api', 'issue-1-comments.json'),
      JSON.stringify([{ id: 1, body: 'hi' }]),
    );
    writeFileSync(
      path.join(fixturesDir, 'api', 'issue-1-comments.json.meta.md'),
      '# Source\n\n- **Real.** `gh api -X GET repos/growilabs/growi/issues/1/comments`.\n',
    );

    const calls: Array<{ method: 'get' | 'getAll'; path: string }> = [];
    // `body` is missing and a new `extra` key is present — a shape change.
    const ghApi = fakeGhApi([{ id: 2, extra: true }], calls);

    const result = await checkFixtureDrift(ghApi, fixturesDir);

    // "checked" counts every fixture that was actually fetched and
    // shape-compared, whether or not the comparison found drift — see the
    // module doc comment for why drift is not excluded from this count.
    expect(result.checked).toBe(1);
    expect(result.unchecked).toEqual([]);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]?.file).toBe('api/issue-1-comments.json');
    expect(result.drift[0]?.source).toBe(
      'repos/growilabs/growi/issues/1/comments',
    );
    expect(result.drift[0]?.diffPaths.length).toBeGreaterThan(0);
  });

  it('excludes a synthetic fixture entirely: not checked, not drift, not unchecked, and no GhApi call is made', async () => {
    const fixturesDir = makeFixturesDir();
    writeFileSync(
      path.join(fixturesDir, 'api', 'synthetic-example.json'),
      JSON.stringify({ id: 1 }),
    );
    writeFileSync(
      path.join(fixturesDir, 'api', 'synthetic-example.json.meta.md'),
      '# Source\n\n- **Synthetic.** Hand-built for a case with no real example.\n',
    );

    const result = await checkFixtureDrift(noCallGhApi(), fixturesDir);

    expect(result).toEqual({ checked: 0, drift: [], unchecked: [] });
  });

  it('classifies an unrecognized .meta.md (e.g. a -q filter) as unchecked, without calling GhApi', async () => {
    const fixturesDir = makeFixturesDir();
    writeFileSync(
      path.join(fixturesDir, 'api', 'filtered.json'),
      JSON.stringify({ id: 1 }),
    );
    writeFileSync(
      path.join(fixturesDir, 'api', 'filtered.json.meta.md'),
      "# Source\n\n- **Real.** `gh api -X GET repos/growilabs/growi/issues/1/comments -q '.[].id'`.\n",
    );

    const result = await checkFixtureDrift(noCallGhApi(), fixturesDir);

    expect(result.checked).toBe(0);
    expect(result.drift).toEqual([]);
    expect(result.unchecked).toEqual([
      { file: 'api/filtered.json', reason: expect.any(String) },
    ]);
  });

  it('classifies a GhError from a real-checkable fixture fetch as unchecked, not drift, without propagating the exception', async () => {
    const fixturesDir = makeFixturesDir();
    writeFileSync(
      path.join(fixturesDir, 'api', 'rate-limited.json'),
      JSON.stringify({ id: 1 }),
    );
    writeFileSync(
      path.join(fixturesDir, 'api', 'rate-limited.json.meta.md'),
      '# Source\n\n- **Real.** `gh api -X GET repos/growilabs/growi/issues/1/comments`.\n',
    );

    const error = new GhError('exit-nonzero', 'gh api failed: rate limited');

    const result = await checkFixtureDrift(failingGhApi(error), fixturesDir);

    expect(result).toEqual({
      checked: 0,
      drift: [],
      unchecked: [{ file: 'api/rate-limited.json', reason: error.message }],
    });
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it as unchecked', async () => {
    const fixturesDir = makeFixturesDir();
    writeFileSync(
      path.join(fixturesDir, 'api', 'broken.json'),
      JSON.stringify({ id: 1 }),
    );
    writeFileSync(
      path.join(fixturesDir, 'api', 'broken.json.meta.md'),
      '# Source\n\n- **Real.** `gh api -X GET repos/growilabs/growi/issues/1/comments`.\n',
    );

    const bug = new TypeError('something else went wrong');

    await expect(
      checkFixtureDrift(failingGhApi(bug), fixturesDir),
    ).rejects.toBe(bug);
  });

  it('calls GhApi.getAll (not .get) when the .meta.md command carries --paginate', async () => {
    const fixturesDir = makeFixturesDir();
    writeFileSync(
      path.join(fixturesDir, 'api', 'paginated.json'),
      JSON.stringify([{ id: 1 }]),
    );
    writeFileSync(
      path.join(fixturesDir, 'api', 'paginated.json.meta.md'),
      '# Source\n\n- **Real.** `gh api -X GET repos/growilabs/growi/issues/1/comments --paginate`.\n',
    );

    const calls: Array<{ method: 'get' | 'getAll'; path: string }> = [];
    const ghApi = fakeGhApi([{ id: 1 }], calls);

    const result = await checkFixtureDrift(ghApi, fixturesDir);

    expect(calls).toEqual([
      {
        method: 'getAll',
        path: 'repos/growilabs/growi/issues/1/comments',
        params: {},
      },
    ]);
    expect(result).toEqual({ checked: 1, drift: [], unchecked: [] });
  });

  it('scans all three real-data subdirectories (api, lockfile, job-logs)', async () => {
    const fixturesDir = makeFixturesDir();
    mkdirSync(path.join(fixturesDir, 'lockfile'), { recursive: true });
    writeFileSync(
      path.join(fixturesDir, 'lockfile', 'diff.json'),
      JSON.stringify({ ok: true }),
    );
    writeFileSync(
      path.join(fixturesDir, 'lockfile', 'diff.json.meta.md'),
      '# Source\n\n- **Real.** `gh api -X GET repos/growilabs/growi/pulls/1/files`.\n',
    );

    const calls: Array<{ method: 'get' | 'getAll'; path: string }> = [];
    const ghApi = fakeGhApi({ ok: true }, calls);

    const result = await checkFixtureDrift(ghApi, fixturesDir);

    expect(result).toEqual({ checked: 1, drift: [], unchecked: [] });
    expect(calls).toEqual([
      {
        method: 'get',
        path: 'repos/growilabs/growi/pulls/1/files',
        params: {},
      },
    ]);
  });
});
