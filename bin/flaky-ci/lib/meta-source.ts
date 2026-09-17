/**
 * Classifying the `# Source` section of a `.meta.md` fixture-sidecar file.
 *
 * `bin/flaky-ci/fixtures/**\/*.meta.md` records, per fixture, whether its
 * data is a real captured GitHub API response, hand-built synthetic data, or
 * something else (derived/constructed from real data, or written in a
 * format this module does not recognize). This module answers only one
 * question: given the full text of one `.meta.md` file, which of those three
 * buckets does it fall into, and — for the real-checkable case — which
 * `gh api -X GET` call would re-fetch it.
 *
 * Design decision (research.md Decision 1): `.meta.md` is free-form prose,
 * and writing a general-purpose parser for it would be over-investment (and
 * risks silently treating a `-q`-filtered value as "the response shape",
 * which would violate Requirement 1.3 — only shape, never value, is
 * compared). So this module recognizes exactly one narrow, literal form and
 * calls everything else `unrecognized` rather than guessing:
 *
 *   `gh api -X GET repos/growilabs/growi/<path>[?query][ --paginate][ -f k=v ...]`
 *
 * with no `-q` anywhere. `-X GET` must appear literally (a real fixture can
 * be fetched with plain `gh api <path>`, which is still a GET by default,
 * but that form is deliberately left `unrecognized` rather than inferred —
 * see design.md's `check-runs` example).
 *
 * `**Synthetic.**` at the start of a bullet is the other explicit signal
 * (Requirement 1.4): hand-built data that must never be re-fetched. A
 * synthetic fixture's prose sometimes *mentions* an unrelated `gh api -X GET`
 * command (e.g. describing how a similar real issue was searched for) — that
 * does not make it real-checkable, because the command's path is not the
 * fixture's own `repos/growilabs/growi/...` source.
 *
 * This is a pure function: it never calls `gh` or the network, and it never
 * throws — anything it cannot confidently classify becomes `unrecognized`
 * with a `reason`, never a guess (design.md meta-source.ts Postconditions).
 */

export type MetaSource =
  | {
      readonly kind: 'real-checkable';
      readonly path: string;
      readonly params: Readonly<Record<string, string | number>>;
      readonly paginate: boolean;
    }
  | { readonly kind: 'synthetic' }
  | { readonly kind: 'unrecognized'; readonly reason: string };

/**
 * Matches the first backtick-quoted `gh api -X GET repos/growilabs/growi/...`
 * command in the text. Group 1 is everything after that fixed prefix, up to
 * the closing backtick — the path plus any trailing flags, unparsed.
 */
const REAL_CHECKABLE_COMMAND_RE =
  /`gh api -X GET repos\/growilabs\/growi\/([^`]+)`/;

/**
 * The fixed prefix `REAL_CHECKABLE_COMMAND_RE`'s capture group deliberately
 * excludes (so the regex itself stays readable). It must be prepended back
 * onto `parseCommandTail`'s `path` before returning a `MetaSource`, because
 * every downstream consumer (`lib/gh.ts`'s `GhApi.get`/`getAll`, via
 * `scripts/check-fixture-drift.ts`) passes `path` straight into
 * `gh api -X GET <path>` — a prefix-less path like `issues` resolves to a
 * different, unrelated GitHub endpoint (the authenticated user's own issues,
 * not this repo's) instead of 404ing, so the mistake fails silently rather
 * than loudly. See task 2.1 regression fix (found during task 4.1 review).
 */
const REPO_API_PATH_PREFIX = 'repos/growilabs/growi/';

/** `**Synthetic.**` at the start of a bullet line (Requirement 1.4). */
const SYNTHETIC_MARKER_RE = /^-\s+\*\*Synthetic\.\*\*/m;

const INTEGER_RE = /^-?\d+$/;

type RealCheckableFields = {
  readonly path: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly paginate: boolean;
};

/**
 * Parses the tail of a `gh api -X GET repos/growilabs/growi/` command (the
 * path plus any trailing tokens) into its typical-form fields. Returns
 * `null` the moment a token outside the typical form's vocabulary appears
 * (most commonly `-q`, but also any other unrecognized flag) — that is the
 * signal to the caller that this command does not qualify as `real-checkable`.
 */
const parseCommandTail = (commandTail: string): RealCheckableFields | null => {
  const tokens = commandTail.split(/\s+/).filter((token) => token.length > 0);
  const path = tokens[0];
  if (path == null || path.length === 0) {
    return null;
  }

  let paginate = false;
  const params: Record<string, string | number> = {};

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === '--paginate') {
      paginate = true;
      continue;
    }

    if (token === '-f') {
      const keyValue = tokens[i + 1];
      const eqIndex = keyValue == null ? -1 : keyValue.indexOf('=');
      if (keyValue == null || eqIndex <= 0) {
        return null;
      }
      const key = keyValue.slice(0, eqIndex);
      const rawValue = keyValue.slice(eqIndex + 1);
      params[key] = INTEGER_RE.test(rawValue) ? Number(rawValue) : rawValue;
      i += 1;
      continue;
    }

    // Anything else — most notably `-q` — disqualifies the typical form.
    return null;
  }

  return { path: `${REPO_API_PATH_PREFIX}${path}`, params, paginate };
};

/**
 * Classifies one `.meta.md` file's `# Source` section as `real-checkable`,
 * `synthetic`, or `unrecognized`. See the module doc comment for the exact
 * rules; never throws.
 */
export const parseMetaSource = (metaMdText: string): MetaSource => {
  const commandMatch = metaMdText.match(REAL_CHECKABLE_COMMAND_RE);
  if (commandMatch != null) {
    const commandTail = commandMatch[1] as string;
    const fields = parseCommandTail(commandTail);
    if (fields != null) {
      return { kind: 'real-checkable', ...fields };
    }
    return {
      kind: 'unrecognized',
      reason: `gh api command does not match the typical form (likely a -q filter or unexpected flag): ${commandTail}`,
    };
  }

  if (SYNTHETIC_MARKER_RE.test(metaMdText)) {
    return { kind: 'synthetic' };
  }

  return {
    kind: 'unrecognized',
    reason:
      'no `gh api -X GET repos/growilabs/growi/...` command found in the typical form',
  };
};
