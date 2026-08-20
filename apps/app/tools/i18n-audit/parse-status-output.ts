/**
 * Pure functions that interpret `i18next-cli`'s human-readable stdout text
 * into structured counts. This module never runs a command itself (that is
 * the Audit Orchestrator's job, task 2.1) — it only parses strings that were
 * already captured elsewhere, and never mutates translation files.
 *
 * Regexes here are coupled to `i18next-cli` 1.71.0's exact stdout wording
 * (pinned in package.json for this reason — see design.md's Risks note).
 * If the CLI's output format changes, these functions should throw rather
 * than silently return 0, per the design's error-handling policy: a parse
 * failure must never be treated as a passing ("0 issues") result.
 */

/**
 * Extracts the number of translation keys that are referenced in code but
 * missing from the primary (default) language file, from plain `status`
 * stdout.
 *
 * @throws {Error} if the expected summary line is not found.
 */
export const parseDefaultLanguageMissingCount = (stdout: string): number => {
  const match = stdout.match(
    /Primary language "[^"]+" is missing (\d+) key\(s\)/,
  );

  if (match == null) {
    throw new Error(
      'Failed to parse default-language missing-key count: expected a ' +
        '"Primary language ... is missing N key(s)" line was not found in `status` output.',
    );
  }

  return Number(match[1]);
};

/**
 * Extracts the number of translation keys with no static reference in code,
 * from `status --unused` stdout.
 *
 * @throws {Error} if the expected summary line is not found.
 */
export const parseUnusedCount = (stdout: string): number => {
  const match = stdout.match(/Summary: Found (\d+) unused key\(s\)/);

  if (match == null) {
    throw new Error(
      'Failed to parse unused-key count: expected a "Summary: Found N unused key(s)" ' +
        'line was not found in `status --unused` output.',
    );
  }

  return Number(match[1]);
};

/**
 * Extracts the number of keys that exist in the primary language but are
 * absent from the given locale's translation file, from `status <locale>`
 * stdout.
 *
 * Deliberately reads the "absent" count, not the "untranslated" count: per
 * requirements.md Requirement 3, the tracked metric is keys missing from the
 * locale file entirely, which `i18next-cli` reports separately from keys
 * present but not yet translated.
 *
 * @throws {Error} if the expected summary line for `locale` is not found.
 */
export const parseLocaleMissingCount = (
  stdout: string,
  locale: string,
): number => {
  const escapedLocale = locale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `Summary: Found \\d+ incomplete translations for "${escapedLocale}" — \\d+ untranslated, (\\d+) absent`,
  );
  const match = stdout.match(pattern);

  if (match == null) {
    throw new Error(
      `Failed to parse per-locale missing-key count for "${locale}": expected a ` +
        `"Summary: Found N incomplete translations for "${locale}" — X untranslated, N absent" ` +
        `line was not found in \`status ${locale}\` output.`,
    );
  }

  return Number(match[1]);
};
