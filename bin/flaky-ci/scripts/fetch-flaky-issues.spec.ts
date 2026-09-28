import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { LABELS } from '../lib/constants.ts';
import type { GhApi, GhParams } from '../lib/gh.ts';
import { GhError } from '../lib/gh.ts';
import { parseArgv, run } from './fetch-flaky-issues.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./fetch-flaky-issues.ts', import.meta.url),
);

const readFixture = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

const CONFIRMED_PAGE = readFixture(
  '../fixtures/api/issues/fetch-flaky-issues-confirmed-page1.json',
) as readonly { readonly number: number }[];
const OBSERVING_PAGE = readFixture(
  '../fixtures/api/issues/fetch-flaky-issues-observing-page1.json',
) as readonly { readonly number: number }[];
const COMMENTS_11862 = readFixture(
  '../fixtures/api/issues/fetch-flaky-issues-11862-comments.json',
) as readonly { readonly id: number; readonly body: string }[];
const COMMENTS_11903 = readFixture(
  '../fixtures/api/issues/fetch-flaky-issues-11903-comments.json',
) as readonly { readonly id: number; readonly body: string }[];
const COMMENTS_11800 = readFixture(
  '../fixtures/api/issues/fetch-flaky-issues-11800-comments.json',
) as readonly { readonly id: number; readonly body: string }[];
const COMMENTS_11914 = readFixture(
  '../fixtures/api/issues/11914-comments.json',
) as readonly { readonly id: number; readonly body: string }[];

/**
 * A `GhApi` whose `getAll` dispatches on the endpoint path: the issues-list
 * endpoint (keyed by the `labels` param) and each issue's comments endpoint
 * (keyed by issue number).
 */
const fakeGhApi = (
  issuesByLabel: Readonly<Record<string, unknown[] | GhError>>,
  commentsByIssue: Readonly<Record<string, unknown[] | GhError>>,
): GhApi => ({
  get: () => Promise.reject(new Error('get() is not used by this script')),
  getAll: (path: string, params: GhParams = {}) => {
    if (path === 'repos/growilabs/growi/issues') {
      const label = String(params.labels);
      const result = issuesByLabel[label];
      if (result == null) {
        return Promise.reject(new Error(`test fixture has no label ${label}`));
      }
      return result instanceof GhError
        ? Promise.reject(result)
        : Promise.resolve(result as never);
    }
    const match = /issues\/([^/]+)\/comments$/.exec(path);
    if (match == null) {
      return Promise.reject(new Error(`unexpected path: ${path}`));
    }
    const issue = match[1];
    const result = commentsByIssue[issue];
    if (result == null) {
      return Promise.reject(
        new Error(`test fixture has no comments for ${issue}`),
      );
    }
    return result instanceof GhError
      ? Promise.reject(result)
      : Promise.resolve(result as never);
  },
});

describe('fetch-flaky-issues.run', () => {
  it('fetches every default-labelled issue, sorted by number ascending, each with its full comments', async () => {
    const ghApi = fakeGhApi(
      {
        [LABELS.observing]: OBSERVING_PAGE as unknown[],
        [LABELS.suspected]: [],
        [LABELS.confirmed]: CONFIRMED_PAGE as unknown[],
      },
      {
        '11870': [],
        '11800': COMMENTS_11800 as unknown[],
        '11914': COMMENTS_11914 as unknown[],
        '11903': COMMENTS_11903 as unknown[],
        '11862': COMMENTS_11862 as unknown[],
      },
    );

    const result = await run(ghApi, {
      labels: [LABELS.observing, LABELS.suspected, LABELS.confirmed],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = result.facts.issues as readonly {
      readonly number: number;
      readonly commentsStatus: string;
      readonly comments: readonly unknown[];
    }[];
    // Both labels' issues are present, merged and sorted ascending by number
    // (11800 < 11862 < 11870 < 11903 < 11914), not left grouped per label.
    expect(issues.map((issue) => issue.number)).toEqual([
      11800, 11862, 11870, 11903, 11914,
    ]);
    expect(issues.every((issue) => issue.commentsStatus === 'ok')).toBe(true);
    const issue11862 = issues.find((issue) => issue.number === 11862);
    expect(issue11862?.comments).toHaveLength(COMMENTS_11862.length);
  });

  it('carries number, title, state, body and label names through unchanged for one real issue', async () => {
    const ghApi = fakeGhApi(
      { [LABELS.confirmed]: CONFIRMED_PAGE as unknown[] },
      {
        '11914': COMMENTS_11914 as unknown[],
        '11903': COMMENTS_11903 as unknown[],
        '11862': COMMENTS_11862 as unknown[],
      },
    );
    const raw11862 = (
      CONFIRMED_PAGE as unknown as {
        readonly number: number;
        readonly title: string;
        readonly state: string;
        readonly body: string | null;
        readonly labels: readonly { readonly name: string }[];
      }[]
    ).find((issue) => issue.number === 11862);
    if (raw11862 == null) {
      throw new Error('fixture is missing issue #11862');
    }

    const result = await run(ghApi, { labels: [LABELS.confirmed] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = result.facts.issues as readonly {
      readonly number: number;
      readonly title: string;
      readonly state: string;
      readonly body: string | null;
      readonly labels: readonly string[];
      readonly comments: readonly {
        readonly id: number;
        readonly body: string;
      }[];
    }[];
    const issue = issues.find((candidate) => candidate.number === 11862);
    expect(issue).toMatchObject({
      title: raw11862.title,
      state: raw11862.state,
      body: raw11862.body,
      labels: raw11862.labels.map((label) => label.name),
    });
    expect(issue?.comments).toEqual(
      COMMENTS_11862.map((comment) => ({ id: comment.id, body: comment.body })),
    );
  });

  it('returns issues from labels that succeeded even when one label fetch fails outright', async () => {
    const ghApi = fakeGhApi(
      {
        [LABELS.observing]: OBSERVING_PAGE as unknown[],
        [LABELS.suspected]: new GhError(
          'exit-nonzero',
          'gh api failed: rate limited',
        ),
        [LABELS.confirmed]: [],
      },
      { '11870': [], '11800': COMMENTS_11800 as unknown[] },
    );

    const result = await run(ghApi, {
      labels: [LABELS.observing, LABELS.suspected, LABELS.confirmed],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = result.facts.issues as readonly {
      readonly number: number;
    }[];
    expect(issues.map((issue) => issue.number)).toEqual([11800, 11870]);
    // The suspected-tier fetch failed outright: the caller must be able to
    // tell that apart from "suspected genuinely has zero issues right now".
    expect(result.facts.labelFetchFailures).toEqual([LABELS.suspected]);
  });

  it('reports an empty labelFetchFailures[] when every label fetch succeeds', async () => {
    const ghApi = fakeGhApi(
      {
        [LABELS.observing]: OBSERVING_PAGE as unknown[],
        [LABELS.suspected]: [],
        [LABELS.confirmed]: CONFIRMED_PAGE as unknown[],
      },
      {
        '11870': [],
        '11800': COMMENTS_11800 as unknown[],
        '11914': COMMENTS_11914 as unknown[],
        '11903': COMMENTS_11903 as unknown[],
        '11862': COMMENTS_11862 as unknown[],
      },
    );

    const result = await run(ghApi, {
      labels: [LABELS.observing, LABELS.suspected, LABELS.confirmed],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts.labelFetchFailures).toEqual([]);
  });

  it('fails with a reason (not an empty success) when every label fetch fails', async () => {
    const error = new GhError('exit-nonzero', 'gh api failed: rate limited');
    const ghApi = fakeGhApi(
      {
        [LABELS.observing]: error,
        [LABELS.suspected]: error,
        [LABELS.confirmed]: error,
      },
      {},
    );

    const result = await run(ghApi, {
      labels: [LABELS.observing, LABELS.suspected, LABELS.confirmed],
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        reason: expect.stringContaining('could not fetch issues'),
      },
    });
  });

  it("marks one issue's row commentsStatus unavailable on a comments-fetch failure without failing the other rows", async () => {
    const ghApi = fakeGhApi(
      { [LABELS.confirmed]: CONFIRMED_PAGE as unknown[] },
      {
        '11914': COMMENTS_11914 as unknown[],
        '11903': new GhError(
          'exit-nonzero',
          'gh api failed: Not Found (HTTP 404)',
        ),
        '11862': COMMENTS_11862 as unknown[],
      },
    );

    const result = await run(ghApi, { labels: [LABELS.confirmed] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = result.facts.issues as readonly {
      readonly number: number;
      readonly commentsStatus: string;
      readonly comments: readonly unknown[];
    }[];
    const unavailable = issues.find((issue) => issue.number === 11903);
    expect(unavailable).toMatchObject({
      commentsStatus: 'unavailable',
      comments: [],
    });
    const others = issues.filter((issue) => issue.number !== 11903);
    expect(others.every((issue) => issue.commentsStatus === 'ok')).toBe(true);
  });

  it('deduplicates an issue that carries more than one of the requested labels', async () => {
    const sharedIssue = {
      number: 42,
      title: 'flaky: vitest:foo.spec.ts:bar',
      state: 'open',
      body: 'body',
      labels: [{ name: LABELS.observing }, { name: LABELS.suspected }],
    };
    const ghApi = fakeGhApi(
      {
        [LABELS.observing]: [sharedIssue],
        [LABELS.suspected]: [sharedIssue],
        [LABELS.confirmed]: [],
      },
      { '42': [] },
    );

    const result = await run(ghApi, {
      labels: [LABELS.observing, LABELS.suspected, LABELS.confirmed],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = result.facts.issues as readonly {
      readonly number: number;
    }[];
    expect(issues).toHaveLength(1);
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it', async () => {
    const ghApi: GhApi = {
      get: () => Promise.reject(new Error('unused')),
      getAll: () => Promise.reject(new TypeError('boom')),
    };

    await expect(run(ghApi, { labels: [LABELS.observing] })).rejects.toThrow(
      'boom',
    );
  });
});

describe('fetch-flaky-issues.parseArgv', () => {
  it('defaults to the three tier labels when none are given', () => {
    expect(parseArgv([])).toEqual({
      kind: 'args',
      value: { labels: [LABELS.observing, LABELS.suspected, LABELS.confirmed] },
    });
  });

  it('collects every --labels occurrence, in order, overriding the default', () => {
    expect(
      parseArgv(['--labels', 'flaky/observing', '--labels', 'flaky/confirmed']),
    ).toEqual({
      kind: 'args',
      value: { labels: ['flaky/observing', 'flaky/confirmed'] },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--labels', 'flaky/observing', '--help'])).toEqual({
      kind: 'help',
    });
  });
});

describe('fetch-flaky-issues CLI process', () => {
  it('exits 0 on --help without contacting GitHub', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--labels');
  });
});
