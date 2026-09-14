/**
 * The real GitHub-side adapters behind `pull-translations.ts`'s injected
 * collaborator interfaces: implements `TranslationOnlyPrPublisher` /
 * `ApprovalReviewer` / `StructuralPrPublisher` / `I18nLintGate`.
 *
 * **Two mechanisms, chosen per operation, not per taste.**
 * - Pull request read/write and the approving review go through the GitHub
 *   REST API with an **explicitly passed** token. That explicitness is the
 *   point: the approving identity must be a different, content-write-less
 *   identity than the one that authors the pull request, and a REST call
 *   carries its token in its own `Authorization` header, so "which token
 *   authorized this call" is a value a unit test can read back. The `gh` CLI
 *   authenticates ambiently (a `GH_TOKEN` environment variable or stored
 *   login state), which would make that separation an unverifiable
 *   convention.
 * - Branch publishing and the lint gate shell out, because they genuinely are
 *   local commands: `git` operating on the Actions checkout, and the existing
 *   `pnpm run lint:i18n` gate this feature only ever *calls*.
 *
 * **Identity separation is structural here, not conventional.**
 * `createApprovalReviewer` accepts an `approvalToken` and nothing else that
 * could authorize a write; the publisher factories accept a `publishToken`
 * and have no field an approval token could be passed through. Neither
 * options type can express the other's token, so wiring the same token to
 * both roles cannot happen by a typo in this file — only by the caller
 * passing one value twice, which `pull-translations.ts`'s `main()` rejects
 * outright before constructing anything.
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type {
  ApprovalReviewer,
  I18nLintGate,
  LintGateResult,
  PullRequestRef,
  StructuralPrPublisher,
  TranslationOnlyPrPublisher,
} from './pull-translations.ts';

const execFileAsync = promisify(execFile);

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const DEFAULT_API_BASE_URL = 'https://api.github.com';

/**
 * The branch every sync pull request targets. GROWI's default branch, and
 * the only branch `.github/mergify.yml`'s "Automatic queue to merge" rule is
 * exercised against.
 */
const DEFAULT_BASE_BRANCH = 'master';

/**
 * Commit authorship for the sync commits. This identifies the *commit
 * author*, which is independent of the identity that opens the pull request
 * (the `publishToken`'s) and of the approving identity.
 */
const DEFAULT_GIT_AUTHOR_NAME = 'github-actions[bot]';
const DEFAULT_GIT_AUTHOR_EMAIL =
  '41898282+github-actions[bot]@users.noreply.github.com';

export interface RunCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a local command and reports its outcome as data rather than by
 * throwing, so both callers in this file can decide for themselves what a
 * non-zero exit means: a failed `git` command aborts the run, while a failed
 * `lint:i18n` is an expected, reportable gate result.
 *
 * Injectable so tests exercise the adapters without spawning anything.
 */
export type RunCommand = (
  command: string,
  args: readonly string[],
) => Promise<RunCommandResult>;

const defaultRunCommand: RunCommand = async (command, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      cwd: APP_ROOT,
      // The i18n audit prints one line per finding; the default 1 MiB cap is
      // easy to exceed on a large regression, and truncating the gate's own
      // diagnostics is worse than holding them in memory.
      maxBuffer: 32 * 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message: string;
    };
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message,
    };
  }
};

/** Injectable `fetch`, so the REST adapters are testable without a network. */
export type FetchFn = typeof fetch;

// ---------------------------------------------------------------------------
// Base ref resolution
// ---------------------------------------------------------------------------

/**
 * Resolves — **once per run, shared by every publisher** — the commit both
 * sync branches are cut from.
 *
 * This is load-bearing for keeping the two sync pull requests independent.
 * `main()` publishes the translation-only branch first and the structural
 * branch second, so by the time the structural publisher runs, `HEAD` is the
 * translation-only commit. A publisher that branched off `HEAD` (or resolved
 * its own base ref lazily at that point) would carry the translation-only
 * locale files into the human-review pull request, and — worse in the other
 * direction — make the two pull requests share content that only one of them
 * was classified for. Memoizing a single resolution and handing it to both
 * publishers keeps each branch rooted at the checkout's original commit.
 *
 * Resolution is deferred until the first `publishBranch` (rather than
 * computed eagerly at wiring time) so a run with nothing to publish never
 * shells out at all.
 */
export const createBaseRefResolver = (options?: {
  readonly runCommand?: RunCommand;
}): (() => Promise<string>) => {
  const runCommand = options?.runCommand ?? defaultRunCommand;
  let pending: Promise<string> | undefined;

  return () => {
    pending ??= (async () => {
      const result = await runCommand('git', ['rev-parse', 'HEAD']);
      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to resolve the base commit (git rev-parse HEAD exited with ${result.exitCode}): ${result.stderr}`,
        );
      }
      return result.stdout.trim();
    })();
    return pending;
  };
};

// ---------------------------------------------------------------------------
// GitHub REST helpers
// ---------------------------------------------------------------------------

interface GitHubRequestOptions {
  readonly fetchFn: FetchFn;
  readonly apiBaseUrl: string;
  readonly token: string;
  readonly repository: string;
  readonly method: 'GET' | 'POST' | 'PATCH';
  /** Path below `/repos/{repository}`, e.g. `/pulls/42/reviews`. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: Readonly<Record<string, unknown>>;
}

/**
 * One GitHub REST call, authorized by the token passed in — never by an
 * ambient credential. A non-2xx response throws, so `runPull` aggregates it
 * as a run failure; the message carries the status and the response body,
 * and deliberately never the token.
 */
const githubRequest = async (
  options: GitHubRequestOptions,
): Promise<unknown> => {
  const { repository, path } = options;
  const url = new URL(`${options.apiBaseUrl}/repos/${repository}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await options.fetchFn(url, {
    method: options.method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${options.token}`,
      'x-github-api-version': '2022-11-28',
      ...(options.body != null ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(
      `GitHub API ${options.method} /repos/${repository}${path} failed with status ${response.status}: ${detail}`,
    );
  }

  return response.json();
};

// ---------------------------------------------------------------------------
// Pull request publishers
// ---------------------------------------------------------------------------

export interface PrPublisherOptions {
  /**
   * The identity that authors the sync pull requests. **Never the approval
   * token** — GitHub refuses a self-approval, so a run wired with one token
   * for both roles cannot merge anything.
   */
  readonly publishToken: string;
  /** `owner/repo`, as GitHub Actions exposes it in `GITHUB_REPOSITORY`. */
  readonly repository: string;
  /** The branch the pull requests target. Defaults to `master`. */
  readonly baseBranch?: string;
  /** The shared, memoized base-ref resolver — see `createBaseRefResolver`. */
  readonly resolveBaseRef: () => Promise<string>;
  readonly apiBaseUrl?: string;
  readonly fetchFn?: FetchFn;
  readonly runCommand?: RunCommand;
  readonly gitAuthorName?: string;
  readonly gitAuthorEmail?: string;
}

interface PullRequestApiItem {
  readonly number: number;
  readonly head?: { readonly ref?: string };
}

/**
 * The shared implementation behind both publisher factories. The two
 * interfaces are structurally identical today but deliberately distinct
 * types (see `StructuralPrPublisher`'s doc comment), so this is exposed
 * through two separately-typed factories rather than one — a later
 * divergence in either policy stays expressible.
 */
const createPrPublisher = (options: PrPublisherOptions) => {
  const {
    publishToken,
    repository,
    resolveBaseRef,
    baseBranch = DEFAULT_BASE_BRANCH,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    fetchFn = fetch,
    runCommand = defaultRunCommand,
    gitAuthorName = DEFAULT_GIT_AUTHOR_NAME,
    gitAuthorEmail = DEFAULT_GIT_AUTHOR_EMAIL,
  } = options;

  const owner = repository.split('/')[0];

  const git = async (args: readonly string[]): Promise<string> => {
    const result = await runCommand('git', args);
    if (result.exitCode !== 0) {
      throw new Error(
        `git ${args[0]} exited with ${result.exitCode}: ${result.stderr || result.stdout}`,
      );
    }
    return result.stdout;
  };

  const request = (
    method: GitHubRequestOptions['method'],
    path: string,
    extra?: Pick<GitHubRequestOptions, 'query' | 'body'>,
  ): Promise<unknown> =>
    githubRequest({
      fetchFn,
      apiBaseUrl,
      token: publishToken,
      repository,
      method,
      path,
      ...extra,
    });

  return {
    async publishBranch(input: {
      readonly headBranch: string;
      readonly commitMessage: string;
      readonly filePaths: readonly string[];
    }): Promise<void> {
      const baseRef = await resolveBaseRef();

      // `-B <branch> <baseRef>` recreates the branch at the checkout's
      // original commit every run. That is what makes a re-run converge to
      // the current POEditor state rather than stacking one commit per run,
      // the same reasoning as `sync_terms=1` on the push side.
      await git(['checkout', '-B', input.headBranch, baseRef]);
      // Only the caller's paths, with `--` so a path can never be read as a
      // revision. Staging the working tree wholesale would sweep the other
      // group's locale files into this pull request.
      await git(['add', '--', ...input.filePaths]);
      // Authorship is set per-invocation rather than by mutating the
      // repository's git config, so this adapter leaves no state behind.
      //
      // The trailing pathspec is not redundant with the `git add` above: a
      // bare `git commit` commits whatever the index holds, whoever staged
      // it. If a previous publishBranch left entries staged (its `add`
      // succeeded but its `commit` did not -- `runPull` reports that failure
      // and carries on to the other group), a bare commit here would sweep
      // the other group's locale files into this pull request. Naming the
      // paths makes the commit contain exactly them.
      await git([
        '-c',
        `user.name=${gitAuthorName}`,
        '-c',
        `user.email=${gitAuthorEmail}`,
        'commit',
        '-m',
        input.commitMessage,
        '--',
        ...input.filePaths,
      ]);
      // Force is required precisely because the branch was recreated from
      // the base commit: the remote branch from a previous run is a sibling,
      // not an ancestor. Both sync branches are owned exclusively by this
      // workflow, so nothing else can lose work here.
      await git(['push', '--force', 'origin', input.headBranch]);
    },

    async findExistingPr(input: {
      readonly headBranch: string;
    }): Promise<PullRequestRef | null> {
      // The `head` filter is only honored in `owner:branch` form; a bare
      // branch name is silently ignored and GitHub returns *every* open pull
      // request. The `head.ref` re-check below is the belt to that
      // suspenders: a mismatch here would later approve an unrelated pull
      // request.
      const listed = (await request('GET', '/pulls', {
        query: { head: `${owner}:${input.headBranch}`, state: 'open' },
      })) as readonly PullRequestApiItem[];

      const match = listed.find((item) => item.head?.ref === input.headBranch);
      return match == null ? null : { number: match.number };
    },

    async createPr(input: {
      readonly headBranch: string;
      readonly title: string;
      readonly body: string;
    }): Promise<PullRequestRef> {
      // No `reviewers` / `team_reviewers`: `.github/mergify.yml`'s
      // "Automatic queue to merge" requires `#review-requested = 0`, so
      // requesting a reviewer would keep the pull request out of the queue.
      const created = (await request('POST', '/pulls', {
        body: {
          title: input.title,
          body: input.body,
          head: input.headBranch,
          base: baseBranch,
        },
      })) as PullRequestApiItem;
      return { number: created.number };
    },

    async updatePr(input: {
      readonly pullRequest: PullRequestRef;
      readonly body: string;
    }): Promise<void> {
      await request('PATCH', `/pulls/${input.pullRequest.number}`, {
        body: { body: input.body },
      });
    },
  };
};

export const createTranslationOnlyPrPublisher = (
  options: PrPublisherOptions,
): TranslationOnlyPrPublisher => createPrPublisher(options);

export const createStructuralPrPublisher = (
  options: PrPublisherOptions,
): StructuralPrPublisher => createPrPublisher(options);

// ---------------------------------------------------------------------------
// Approval reviewer
// ---------------------------------------------------------------------------

export interface ApprovalReviewerOptions {
  /**
   * The approving bot's token (`secrets.I18N_SYNC_APPROVAL_TOKEN`). This is
   * the only credential this adapter is given, and submitting an approving
   * review is the only thing it can do with it — this identity holds no
   * `contents: write`.
   */
  readonly approvalToken: string;
  /** `owner/repo`, as GitHub Actions exposes it in `GITHUB_REPOSITORY`. */
  readonly repository: string;
  readonly apiBaseUrl?: string;
  readonly fetchFn?: FetchFn;
}

/**
 * Submits the approving review that satisfies
 * `.github/mergify.yml`'s "Automatic queue to merge" condition
 * `#approved-reviews-by >= 1`, under an identity distinct from the pull
 * request's author (GitHub refuses a self-approval).
 *
 * Approving only puts the pull request into the merge queue; the queue's own
 * `queue_conditions` / `merge_conditions` still require
 * `check-success ~= ci-app-lint` before anything merges, so this adds no
 * route around the i18n CI gate.
 *
 * The returned object has exactly one method on purpose: there is no code
 * path from this adapter to repository content, so the approval token cannot
 * be spent on anything but an approval even if a future change misuses this
 * object.
 */
export const createApprovalReviewer = (
  options: ApprovalReviewerOptions,
): ApprovalReviewer => {
  const {
    approvalToken,
    repository,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    fetchFn = fetch,
  } = options;

  return {
    async submitApprovalReview(input: {
      readonly pullRequest: PullRequestRef;
    }): Promise<void> {
      await githubRequest({
        fetchFn,
        apiBaseUrl,
        token: approvalToken,
        repository,
        method: 'POST',
        path: `/pulls/${input.pullRequest.number}/reviews`,
        body: { event: 'APPROVE' },
      });
    },
  };
};

// ---------------------------------------------------------------------------
// i18n lint gate
// ---------------------------------------------------------------------------

export interface I18nLintGateOptions {
  readonly runCommand?: RunCommand;
}

/**
 * Runs the repository's existing i18n CI gate as-is
 * (`pnpm run lint:i18n` → `apps/app/tools/i18n-audit/`) — this feature calls
 * the gate and never touches its detection logic. Maps the exit code: 0
 * passes, anything else fails and carries the captured output so a
 * maintainer can see *why* from the workflow log.
 */
export const createI18nLintGate = (
  options: I18nLintGateOptions = {},
): I18nLintGate => {
  const runCommand = options.runCommand ?? defaultRunCommand;

  return {
    async run(): Promise<LintGateResult> {
      const result = await runCommand('pnpm', ['run', 'lint:i18n']);
      if (result.exitCode === 0) {
        return { ok: true };
      }
      return {
        ok: false,
        message: `pnpm run lint:i18n exited with ${result.exitCode}.\n${result.stdout}\n${result.stderr}`,
      };
    },
  };
};
