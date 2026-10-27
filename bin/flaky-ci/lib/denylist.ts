/**
 * The infrastructure-noise denylist `detect-flaky-ci/SKILL.md` Step 2 matches
 * a failure against before anything is tracked as flaky, as data plus the
 * matching rule.
 *
 * This module is the **single definition** of the list: after task 3.2 the
 * procedure no longer carries a copy of it, so there is nothing to drift
 * against. Widening the list stays a judgment — the procedure's rule is
 * "keep it small and additive; extend it when a genuine false positive is
 * found, never broaden matches speculatively" — so a new entry is a
 * deliberate edit here, reviewed like any other code change.
 *
 * One entry the procedure lists in prose is deliberately **not** encoded:
 * "generic `curl` retry exhaustion (`--retry 60` blocks timing out)". It
 * names no literal string a log can be matched against, and inventing one
 * (`curl`, or an exit-code number) would match ordinary product failures
 * that merely mention curl. That failure shape stays a reader's judgment
 * rather than becoming a silent over-match.
 */
import { isSharedSetupHookBlock } from './job-log.ts';

export type DenylistPattern = {
  /** How the match is reported — the procedure quotes this in its report. */
  readonly name: string;
  /** Case-insensitive substrings; any one of them matches the pattern. */
  readonly needles: readonly string[];
};

/**
 * How far a match reaches. `failure` drops that one failure; `job` means
 * every failure in the same job log is noise, because the failure that
 * matched is a hook registered under `test/setup/**` that ran before all of
 * them. Nothing else in a job log has that reach.
 */
export type DenylistScope = 'job' | 'failure';

export type DenylistMatch = {
  readonly pattern: string;
  readonly needle: string;
  readonly scope: DenylistScope;
};

/** The procedure's list, in the order it is written there. */
export const INFRA_NOISE_PATTERNS: readonly DenylistPattern[] = [
  { name: 'ECONNREFUSED', needles: ['ECONNREFUSED'] },
  { name: 'getaddrinfo ENOTFOUND', needles: ['getaddrinfo ENOTFOUND'] },
  { name: 'No space left on device', needles: ['No space left on device'] },
  { name: 'OOM-killed', needles: ['SIGKILL', 'exit code 137'] },
  {
    name: 'runner lost',
    needles: [
      'runner has received a shutdown signal',
      'lost communication with the server',
    ],
  },
  {
    name: 'docker daemon error',
    needles: ['docker: Error response from daemon'],
  },
  {
    // A test that downloads a real file from github.com over the public
    // network (the plugin-install integ test, #11708) — the public network
    // going missing says nothing about the product's determinism.
    name: 'Failed to download file.',
    needles: ['Failed to download file.'],
  },
];

/**
 * Matches one failure's own excerpt — its FAIL block plus the error and stack
 * lines under it — against the denylist, and says how far the match reaches.
 *
 * The excerpt, not the whole job log, is the unit on purpose: searching the
 * whole log would discard every failure in the job on the strength of one
 * unrelated line (measured: 96 unrelated failures would have gone with one
 * real infra failure).
 *
 * `patterns` is a parameter so a caller — or a test — can match against its
 * own list instead of the declared one.
 */
export const match = (
  block: string,
  patterns: readonly DenylistPattern[] = INFRA_NOISE_PATTERNS,
): DenylistMatch | null => {
  const haystack = block.toLowerCase();
  for (const pattern of patterns) {
    for (const needle of pattern.needles) {
      if (haystack.includes(needle.toLowerCase())) {
        return {
          pattern: pattern.name,
          needle,
          scope: isSharedSetupHookBlock(block) ? 'job' : 'failure',
        };
      }
    }
  }
  return null;
};
