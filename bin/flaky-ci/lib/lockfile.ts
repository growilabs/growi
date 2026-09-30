/**
 * Package-name extraction for the lockfile-overlap check (`detect-flaky-ci`'s
 * ① Cheap Suspicion Mining): does a `pnpm-lock.yaml` change already explain a
 * failure, because the failing stack trace runs through a package the diff
 * itself touched?
 *
 * Both `packagesInPatch` and `packagesInLog` mirror the two rule pairs the
 * procedure used to document by hand ("Package names from the lockfile
 * patch" / "Package names from the failure's stack trace"), so the same
 * input produces the same set of names as before (Requirement 1.3) — with
 * one deliberate fix, documented on `packagesInPatch` below.
 */

/**
 * A quoted or `/`-prefixed key is a version-carrying **header** line (a
 * `packages:` / `snapshots:` entry naming itself, e.g.
 * `'@codemirror/state@6.7.4'`) when what remains after stripping trailing
 * `(…)` groups still ends in `@<version>`. Otherwise the key is a plain
 * package name and the line is a **dependency-entry** (`'name': version`,
 * where the version lives in the value, not the key).
 *
 * The previous hand-applied procedure instead asked "is there nothing after
 * the colon" to tell the two apart, which mis-reads pnpm's single-line
 * leaf-package header shape `'@marijn/find-cluster-break@1.0.4': {}` (real
 * example from PR #11886) as a dependency-entry with value `{}`: the version
 * stays attached to the name, so `packagesInLog`'s log-side name for the same
 * package would never match it. Testing the key itself for an embedded
 * version, instead of what follows the colon, classifies this shape
 * correctly and needs no line-shape-specific special case.
 */
const HAS_EMBEDDED_VERSION = /@\d[\w.+-]*$/;

/**
 * Strips trailing balanced `(…)` groups, repeating until none remain. A
 * `snapshots:` header can chain several peer-resolution groups back to back
 * (`@tsed/platform-express@8.5.0(@tsed/core@8.5.0)(@tsed/di@8.5.0(…))…` in
 * the same real patch), so stripping only one leaves a corrupted name.
 */
const stripTrailingParenGroups = (key: string): string => {
  let result = key;
  while (result.endsWith(')')) {
    let depth = 0;
    let openIndex = -1;
    for (let i = result.length - 1; i >= 0; i -= 1) {
      if (result[i] === ')') {
        depth += 1;
      } else if (result[i] === '(') {
        depth -= 1;
        if (depth === 0) {
          openIndex = i;
          break;
        }
      }
    }
    // Unbalanced parentheses: not a shape this module documents. Stop rather
    // than strip an arbitrary prefix.
    if (openIndex === -1) {
      break;
    }
    result = result.slice(0, openIndex);
  }
  return result;
};

/** The raw key of a quoted (`'…'`) or unquoted (`/…:`) entry line, or `null`. */
const extractKeyToken = (trimmed: string): string | null => {
  const quoted = trimmed.match(/^'([^']+)':\s*.*$/);
  if (quoted != null) {
    return quoted[1] ?? null;
  }
  // Older pnpm lockfile versions wrote an unquoted header as `/name@version:`.
  const unquoted = trimmed.match(/^\/(.+):$/);
  return unquoted?.[1] ?? null;
};

/** The package name a single quoted/unquoted entry key resolves to. */
const nameFromKey = (rawKey: string): string => {
  const stripped = stripTrailingParenGroups(rawKey);
  if (!HAS_EMBEDDED_VERSION.test(stripped)) {
    // Dependency-entry shape: the key is already a plain package name.
    return stripped;
  }
  const lastAt = stripped.lastIndexOf('@');
  return stripped.slice(0, lastAt);
};

/**
 * Package names touched by a `pnpm-lock.yaml` unified diff (a single file's
 * `.patch` text, as returned by the GitHub "list pull request files" / "get
 * a commit" endpoints). Looks only at added/removed lines (`+`/`-`), never
 * hunk headers or unchanged context.
 */
export const packagesInPatch = (patch: string): Set<string> => {
  const names = new Set<string>();
  for (const line of patch.split('\n')) {
    const marker = line[0];
    if (marker !== '+' && marker !== '-') {
      continue;
    }
    // Diff file headers (`+++ b/pnpm-lock.yaml`), never present in a
    // single-file `.patch` value but excluded defensively.
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    const trimmed = line.slice(1).trim();
    const key = extractKeyToken(trimmed);
    if (key != null) {
      names.add(nameFromKey(key));
    }
  }
  return names;
};

/** One `.pnpm/<segment>/` store directory name, without the trailing slash. */
const PNPM_SEGMENT = /\.pnpm\/([^/]+)\//;
/** `node_modules/<segment>` when no `.pnpm/` layer is present in the frame. */
const PLAIN_NODE_MODULES_SEGMENT = /node_modules\/(@[^/]+\/[^/]+|[^/]+)\//;

/** pnpm's peer-suffixed `.pnpm/` store directory name → the bare package name. */
const nameFromPnpmSegment = (segment: string): string => {
  // pnpm appends the peers a package was resolved against, `_`-separated,
  // and hashes the tail when it gets long — cut at the *first* `_` so a
  // peer's own `@`s never leak into the split below.
  const withoutPeers = segment.split('_')[0] ?? segment;
  const lastAt = withoutPeers.lastIndexOf('@');
  const nameAndScope =
    lastAt === -1 ? withoutPeers : withoutPeers.slice(0, lastAt);
  // pnpm rewrites a scoped name's `/` to `+` in store directory names.
  return nameAndScope.replace('+', '/');
};

/**
 * Package names appearing in the stack-trace frames (`❯ …`) of a failure log
 * excerpt. Only frame lines are scanned — the two frame shapes below are the
 * ones the procedure documents; a `.pnpm/` frame takes priority over the
 * plain `node_modules/` rule when a frame carries both (the plain segment
 * nested inside a `.pnpm/` directory always names the same package the
 * `.pnpm/` segment itself does).
 */
export const packagesInLog = (excerpt: string): Set<string> => {
  const names = new Set<string>();
  for (const line of excerpt.split('\n')) {
    if (!line.includes('❯')) {
      continue;
    }
    const pnpmMatch = line.match(PNPM_SEGMENT);
    if (pnpmMatch?.[1] != null) {
      names.add(nameFromPnpmSegment(pnpmMatch[1]));
      continue;
    }
    const plainMatch = line.match(PLAIN_NODE_MODULES_SEGMENT);
    if (plainMatch?.[1] != null) {
      names.add(plainMatch[1]);
    }
  }
  return names;
};

/** Names present in both sets — the fact that suppresses ① for a failure. */
export const intersect = (
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): Set<string> => new Set([...a].filter((name) => b.has(name)));
