import {
  createApprovalReviewer,
  createBaseRefResolver,
  createI18nLintGate,
  createStructuralPrPublisher,
  createTranslationOnlyPrPublisher,
  type RunCommand,
  type RunCommandResult,
} from './github-adapters.ts';
import type {
  ApprovalReviewer,
  StructuralPrPublisher,
  TranslationOnlyPrPublisher,
} from './pull-translations.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Two deliberately dissimilar token strings. The whole point of the split
 * between `TranslationOnlyPrPublisher` and `ApprovalReviewer` is that these
 * two never reach the same call, so every isolation assertion below is
 * written against these exact literals.
 */
const PUBLISH_TOKEN = 'publish-token-PPPPPPPP';
const APPROVAL_TOKEN = 'approval-token-AAAAAAAA';

const REPOSITORY = 'growilabs/growi';
const API_BASE_URL = 'https://api.github.com';
const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';

const ok = (stdout = ''): RunCommandResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
});

/** A `RunCommand` fake that records every invocation and answers `git rev-parse` with a fixed sha. */
const createRunCommandFake = (): {
  runCommand: RunCommand;
  calls: { command: string; args: readonly string[] }[];
} => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const runCommand: RunCommand = (command, args) => {
    calls.push({ command, args });
    if (command === 'git' && args[0] === 'rev-parse') {
      return Promise.resolve(ok(`${BASE_SHA}\n`));
    }
    return Promise.resolve(ok());
  };
  return { runCommand, calls };
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const headerOf = (init: RequestInit | undefined, name: string): string => {
  const headers = new Headers(init?.headers);
  return headers.get(name) ?? '';
};

const gitCallsOf = (
  calls: readonly { command: string; args: readonly string[] }[],
): readonly (readonly string[])[] =>
  calls.filter((call) => call.command === 'git').map((call) => call.args);

interface PublisherHarness {
  readonly translationOnly: TranslationOnlyPrPublisher;
  readonly structural: StructuralPrPublisher;
  readonly calls: { command: string; args: readonly string[] }[];
  readonly fetchFn: ReturnType<typeof vi.fn>;
}

const buildPublishers = (): PublisherHarness => {
  const { runCommand, calls } = createRunCommandFake();
  const fetchFn = vi.fn();
  // A single shared resolver, exactly as `main()` wires it -- see the
  // "resolves the base ref once" test for why sharing it is load-bearing.
  const resolveBaseRef = createBaseRefResolver({ runCommand });
  const shared = {
    publishToken: PUBLISH_TOKEN,
    repository: REPOSITORY,
    baseBranch: 'master',
    resolveBaseRef,
    runCommand,
    fetchFn: fetchFn as unknown as typeof fetch,
  };
  return {
    translationOnly: createTranslationOnlyPrPublisher(shared),
    structural: createStructuralPrPublisher(shared),
    calls,
    fetchFn,
  };
};

// ---------------------------------------------------------------------------

describe('createTranslationOnlyPrPublisher', () => {
  describe('publishBranch', () => {
    it('branches off the resolved base ref, stages only the given paths, commits and force-pushes', async () => {
      const { translationOnly, calls } = buildPublishers();

      await translationOnly.publishBranch({
        headBranch: 'i18n-sync/translation-only',
        commitMessage: 'chore(i18n): apply translation-only updates',
        filePaths: ['/repo/apps/app/public/static/locales/ja_JP/admin.json'],
      });

      const gitCalls = gitCallsOf(calls);
      expect(gitCalls[0]).toEqual(['rev-parse', 'HEAD']);
      expect(gitCalls[1]).toEqual([
        'checkout',
        '-B',
        'i18n-sync/translation-only',
        BASE_SHA,
      ]);
      // `--` separates paths from revisions, and only the listed file is
      // staged -- never `git add -A`.
      expect(gitCalls[2]).toEqual([
        'add',
        '--',
        '/repo/apps/app/public/static/locales/ja_JP/admin.json',
      ]);
      expect(gitCalls[3]).toContain('commit');
      expect(gitCalls[3]).toContain(
        'chore(i18n): apply translation-only updates',
      );
      // The commit names its paths too: a bare `git commit` would take
      // whatever the index happens to hold, including another group's files
      // left staged by an earlier failed publish.
      expect(gitCalls[3].slice(-2)).toEqual([
        '--',
        '/repo/apps/app/public/static/locales/ja_JP/admin.json',
      ]);
      expect(gitCalls[4]).toEqual([
        'push',
        '--force',
        'origin',
        'i18n-sync/translation-only',
      ]);
    });

    it('never stages the whole working tree', async () => {
      const { translationOnly, calls } = buildPublishers();

      await translationOnly.publishBranch({
        headBranch: 'i18n-sync/translation-only',
        commitMessage: 'msg',
        filePaths: ['/repo/a.json', '/repo/b.json'],
      });

      const addCall = gitCallsOf(calls).find((args) => args[0] === 'add');
      expect(addCall).toEqual(['add', '--', '/repo/a.json', '/repo/b.json']);
      expect(addCall).not.toContain('-A');
      expect(addCall).not.toContain('.');
    });

    it('commits only its own paths even when an earlier publish left files staged', async () => {
      // `runPull` reports a failed translation-only publish and still runs
      // the structural one, so the structural commit can find the other
      // group's files sitting in the index. It must not pick them up: that
      // would put a translation-only change into the human-review pull
      // request.
      const calls: { command: string; args: readonly string[] }[] = [];
      const runCommand: RunCommand = (command, args) => {
        calls.push({ command, args });
        if (args[0] === 'rev-parse') {
          return Promise.resolve(ok(`${BASE_SHA}\n`));
        }
        // The commit args start with `-c user.name=...`, so match on
        // membership rather than position.
        if (args.includes('commit') && calls.length <= 4) {
          return Promise.resolve({
            exitCode: 1,
            stdout: '',
            stderr: 'pre-commit hook failed',
          });
        }
        return Promise.resolve(ok());
      };
      const resolveBaseRef = createBaseRefResolver({ runCommand });
      const shared = {
        publishToken: PUBLISH_TOKEN,
        repository: REPOSITORY,
        resolveBaseRef,
        runCommand,
        fetchFn: vi.fn() as unknown as typeof fetch,
      };

      await expect(
        createTranslationOnlyPrPublisher(shared).publishBranch({
          headBranch: 'i18n-sync/translation-only',
          commitMessage: 'translation-only',
          filePaths: ['/repo/translation-only.json'],
        }),
      ).rejects.toThrow('pre-commit hook failed');

      await createStructuralPrPublisher(shared).publishBranch({
        headBranch: 'i18n-sync/structural-review',
        commitMessage: 'structural',
        filePaths: ['/repo/structural.json'],
      });

      const structuralCommit = gitCallsOf(calls)
        .filter((args) => args.includes('commit'))
        .at(-1);
      expect(structuralCommit).toContain('/repo/structural.json');
      expect(structuralCommit).not.toContain('/repo/translation-only.json');
    });

    it('throws with the failing command output when a git command exits non-zero', async () => {
      const runCommand: RunCommand = (command, args) => {
        if (command === 'git' && args[0] === 'rev-parse') {
          return Promise.resolve(ok(`${BASE_SHA}\n`));
        }
        if (command === 'git' && args[0] === 'push') {
          return Promise.resolve({
            exitCode: 128,
            stdout: '',
            stderr: 'remote: Permission denied',
          });
        }
        return Promise.resolve(ok());
      };
      const publisher = createTranslationOnlyPrPublisher({
        publishToken: PUBLISH_TOKEN,
        repository: REPOSITORY,
        resolveBaseRef: createBaseRefResolver({ runCommand }),
        runCommand,
        fetchFn: vi.fn() as unknown as typeof fetch,
      });

      await expect(
        publisher.publishBranch({
          headBranch: 'i18n-sync/translation-only',
          commitMessage: 'msg',
          filePaths: ['/repo/a.json'],
        }),
      ).rejects.toThrow('remote: Permission denied');
    });
  });

  describe('findExistingPr', () => {
    it('scopes the query to owner:branch and returns the matching open pull request', async () => {
      const { translationOnly, fetchFn } = buildPublishers();
      fetchFn.mockResolvedValueOnce(
        jsonResponse(200, [
          { number: 42, head: { ref: 'i18n-sync/translation-only' } },
        ]),
      );

      const result = await translationOnly.findExistingPr({
        headBranch: 'i18n-sync/translation-only',
      });

      expect(result).toEqual({ number: 42 });
      const [url] = fetchFn.mock.calls[0];
      expect(String(url)).toContain(
        `${API_BASE_URL}/repos/${REPOSITORY}/pulls`,
      );
      // Without the `owner:` prefix GitHub silently ignores the `head` filter
      // and returns every open pull request -- which would later approve an
      // unrelated one.
      expect(String(url)).toContain(
        `head=${encodeURIComponent('growilabs:i18n-sync/translation-only')}`,
      );
      expect(String(url)).toContain('state=open');
    });

    it('returns null when the response carries only pull requests for another head branch', async () => {
      const { translationOnly, fetchFn } = buildPublishers();
      fetchFn.mockResolvedValueOnce(
        jsonResponse(200, [
          { number: 7, head: { ref: 'feat/something-unrelated' } },
        ]),
      );

      await expect(
        translationOnly.findExistingPr({
          headBranch: 'i18n-sync/translation-only',
        }),
      ).resolves.toBeNull();
    });

    it('returns null when no pull request is open for the branch', async () => {
      const { translationOnly, fetchFn } = buildPublishers();
      fetchFn.mockResolvedValueOnce(jsonResponse(200, []));

      await expect(
        translationOnly.findExistingPr({
          headBranch: 'i18n-sync/translation-only',
        }),
      ).resolves.toBeNull();
    });
  });

  describe('createPr', () => {
    it('opens the pull request against the base branch and requests no reviewers', async () => {
      const { translationOnly, fetchFn } = buildPublishers();
      fetchFn.mockResolvedValueOnce(jsonResponse(201, { number: 99 }));

      const result = await translationOnly.createPr({
        headBranch: 'i18n-sync/translation-only',
        title: 'title',
        body: 'body',
      });

      expect(result).toEqual({ number: 99 });
      const [url, init] = fetchFn.mock.calls[0];
      expect(String(url)).toBe(`${API_BASE_URL}/repos/${REPOSITORY}/pulls`);
      expect(init.method).toBe('POST');
      const sent = JSON.parse(init.body as string);
      expect(sent).toEqual({
        title: 'title',
        body: 'body',
        head: 'i18n-sync/translation-only',
        base: 'master',
      });
      // `.github/mergify.yml`'s "Automatic queue to merge" requires
      // `#review-requested = 0`, so requesting a reviewer would keep the PR
      // out of the queue.
      expect(sent).not.toHaveProperty('reviewers');
      expect(sent).not.toHaveProperty('team_reviewers');
    });
  });

  describe('updatePr', () => {
    it('patches only the body of the existing pull request', async () => {
      const { translationOnly, fetchFn } = buildPublishers();
      fetchFn.mockResolvedValueOnce(jsonResponse(200, { number: 42 }));

      await translationOnly.updatePr({
        pullRequest: { number: 42 },
        body: 'updated body',
      });

      const [url, init] = fetchFn.mock.calls[0];
      expect(String(url)).toBe(`${API_BASE_URL}/repos/${REPOSITORY}/pulls/42`);
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ body: 'updated body' });
    });
  });

  it('surfaces the status of a failed GitHub API call without echoing the token', async () => {
    const { translationOnly, fetchFn } = buildPublishers();
    fetchFn.mockResolvedValueOnce(
      jsonResponse(422, { message: 'Validation Failed' }),
    );

    await expect(
      translationOnly.createPr({
        headBranch: 'i18n-sync/translation-only',
        title: 't',
        body: 'b',
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining('422'),
      }),
    );
    await expect(
      translationOnly.createPr({
        headBranch: 'i18n-sync/translation-only',
        title: 't',
        body: 'b',
      }),
    ).rejects.toThrow(expect.not.stringContaining(PUBLISH_TOKEN));
  });
});

describe('createBaseRefResolver', () => {
  it('resolves the base ref once and hands the same commit to every publisher', async () => {
    const { translationOnly, structural, calls } = buildPublishers();

    // The real `main()` order: the translation-only branch is committed
    // first, then the structural one. If the structural publisher branched
    // off `HEAD` (or re-resolved it now), it would branch off the
    // translation-only commit and carry those files into the human-review
    // pull request.
    await translationOnly.publishBranch({
      headBranch: 'i18n-sync/translation-only',
      commitMessage: 'translation-only',
      filePaths: ['/repo/a.json'],
    });
    await structural.publishBranch({
      headBranch: 'i18n-sync/structural-review',
      commitMessage: 'structural',
      filePaths: ['/repo/b.json'],
    });

    const gitCalls = gitCallsOf(calls);
    const revParseCalls = gitCalls.filter((args) => args[0] === 'rev-parse');
    expect(revParseCalls).toHaveLength(1);

    const checkoutCalls = gitCalls.filter((args) => args[0] === 'checkout');
    expect(checkoutCalls).toEqual([
      ['checkout', '-B', 'i18n-sync/translation-only', BASE_SHA],
      ['checkout', '-B', 'i18n-sync/structural-review', BASE_SHA],
    ]);
  });
});

describe('createApprovalReviewer', () => {
  it('submits an APPROVE review on the given pull request', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse(200, { id: 1 }));
    const reviewer = createApprovalReviewer({
      approvalToken: APPROVAL_TOKEN,
      repository: REPOSITORY,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await reviewer.submitApprovalReview({ pullRequest: { number: 42 } });

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe(
      `${API_BASE_URL}/repos/${REPOSITORY}/pulls/42/reviews`,
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ event: 'APPROVE' });
  });

  it('exposes no capability other than submitting an approval review', () => {
    const reviewer: ApprovalReviewer = createApprovalReviewer({
      approvalToken: APPROVAL_TOKEN,
      repository: REPOSITORY,
      fetchFn: vi.fn() as unknown as typeof fetch,
    });

    // No method that could write repository content or change a pull
    // request's contents may exist on the approving identity's adapter —
    // the approval bot has no `contents: write`.
    expect(Object.keys(reviewer)).toEqual(['submitApprovalReview']);
  });
});

describe('approval token isolation', () => {
  it('sends the approval token only on the review call, and never sends the publish token there', async () => {
    const { runCommand, calls } = createRunCommandFake();
    const fetchFn = vi.fn();
    const resolveBaseRef = createBaseRefResolver({ runCommand });
    const publisher = createTranslationOnlyPrPublisher({
      publishToken: PUBLISH_TOKEN,
      repository: REPOSITORY,
      resolveBaseRef,
      runCommand,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const reviewer = createApprovalReviewer({
      approvalToken: APPROVAL_TOKEN,
      repository: REPOSITORY,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    fetchFn.mockResolvedValueOnce(jsonResponse(200, []));
    fetchFn.mockResolvedValueOnce(jsonResponse(201, { number: 42 }));
    fetchFn.mockResolvedValueOnce(jsonResponse(200, { number: 42 }));
    fetchFn.mockResolvedValueOnce(jsonResponse(200, { id: 1 }));

    await publisher.publishBranch({
      headBranch: 'i18n-sync/translation-only',
      commitMessage: 'msg',
      filePaths: ['/repo/a.json'],
    });
    await publisher.findExistingPr({
      headBranch: 'i18n-sync/translation-only',
    });
    await publisher.createPr({
      headBranch: 'i18n-sync/translation-only',
      title: 't',
      body: 'b',
    });
    await publisher.updatePr({ pullRequest: { number: 42 }, body: 'b' });
    await reviewer.submitApprovalReview({ pullRequest: { number: 42 } });

    const reviewCalls: unknown[][] = [];
    const nonReviewCalls: unknown[][] = [];
    for (const call of fetchFn.mock.calls) {
      (String(call[0]).endsWith('/reviews')
        ? reviewCalls
        : nonReviewCalls
      ).push(call);
    }

    expect(reviewCalls).toHaveLength(1);
    expect(nonReviewCalls).toHaveLength(3);

    // The approving identity, and only it, authorizes the review call.
    for (const [, init] of reviewCalls) {
      const authorization = headerOf(init as RequestInit, 'authorization');
      expect(authorization).toContain(APPROVAL_TOKEN);
      expect(authorization).not.toContain(PUBLISH_TOKEN);
    }
    // Nothing else in the run may carry the approval token.
    for (const [, init] of nonReviewCalls) {
      const authorization = headerOf(init as RequestInit, 'authorization');
      expect(authorization).toContain(PUBLISH_TOKEN);
      expect(authorization).not.toContain(APPROVAL_TOKEN);
    }
    // Nor may any local command -- no token belongs on a git command line
    // (where it would also leak into the process list and error output).
    const commandLines = JSON.stringify(calls);
    expect(commandLines).not.toContain(APPROVAL_TOKEN);
    expect(commandLines).not.toContain(PUBLISH_TOKEN);
  });
});

describe('createI18nLintGate', () => {
  it('runs the existing lint:i18n script and passes on exit code 0', async () => {
    const calls: { command: string; args: readonly string[] }[] = [];
    const runCommand: RunCommand = (command, args) => {
      calls.push({ command, args });
      return Promise.resolve(ok('all good'));
    };

    const result = await createI18nLintGate({ runCommand }).run();

    expect(result).toEqual({ ok: true });
    // The gate is the existing i18n CI gate, invoked as-is -- this feature
    // calls it and never reimplements it.
    expect(calls).toEqual([{ command: 'pnpm', args: ['run', 'lint:i18n'] }]);
  });

  it('fails with the captured output when the script exits non-zero', async () => {
    const runCommand: RunCommand = () =>
      Promise.resolve({
        exitCode: 1,
        stdout: 'missing key admin:foo',
        stderr: 'audit failed',
      });

    const result = await createI18nLintGate({ runCommand }).run();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('missing key admin:foo');
      expect(result.message).toContain('audit failed');
    }
  });
});
