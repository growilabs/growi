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
 * The "Primary language ... is missing N key(s)" line itself is omitted
 * from the CLI's output whenever that count is exactly 0 (observed once
 * task 7.3 brought this repo's `en_US` missing-key count to 0 — not just
 * the digit zeroed out, the whole line is absent), so its absence is
 * treated as 0 here. Unlike `parseLocaleMissingCount`'s task 1.5 fix (which
 * made one clause *within* an otherwise-still-required line optional), the
 * entire line is optional here.
 *
 * Concluding "0 missing" from the strict line's absence alone is not safe on
 * its own: a CLI wording change (the strict line reworded — with or without
 * the literal word "missing" — round 2 of this task's remediation found a
 * reviewer fixture that reworded it to avoid that word entirely) or a
 * truncated capture (the line's own would-be position never reached) both
 * also leave the strict pattern unmatched, and both must throw rather than
 * silently become "0". A vocabulary sniff (e.g. "does stdout mention the
 * word 'missing' anywhere") cannot catch a rewording that avoids that exact
 * word, so the check here is structural instead: it looks at the specific
 * *slot* in stdout where the strict line would have printed, and asks
 * whether that slot is empty (blank/whitespace only) or not — not whether
 * particular words appear in it.
 *
 * The strict line always comes right after the last secondary-locale
 * progress-bar line (see STATUS_STDOUT_NORMAL in the spec). This module's
 * caller (`run-audit.ts`) only ever hands this function the child process's
 * **stdout stream**; the CLI's terminal "✖ Error: ..." line is written to
 * **stderr** (verified against the real CLI: redirecting stdout/stderr
 * separately shows the structured report on stdout and the "✖ Error:"
 * summary on stderr), so a genuine stdout-only capture never contains it —
 * fixtures below include it anyway, purely for readability of a full
 * captured session, so the slot-boundary logic treats the first "✖ Error:"
 * occurrence (if any) as the end of the slot rather than as content inside it.
 *
 * The check proceeds in two steps once the strict line fails to match:
 *
 * 1. A Translation-Progress-completeness check confirming the captured
 *    stdout actually ran past the point where the strict line would have
 *    printed. What genuinely always ends up on stdout is the `"🌍 Locales:
 *    <primary>, <secondary>, ..."` header line, listing every configured
 *    locale, and one progress line per secondary locale. If any secondary
 *    locale's progress line is missing, the capture was cut short (or
 *    corrupted) before the determination point, so it throws instead of
 *    guessing 0.
 * 2. Once every secondary locale's progress line is confirmed present, the
 *    "slot" — the stdout region from the end of the last secondary locale's
 *    progress line up to the next "✖ Error:" occurrence (or end of string,
 *    if none) — is extracted and checked for emptiness. Blank/whitespace
 *    only means the strict line was genuinely never printed there (a true
 *    0), matching the real STATUS_STDOUT_ZERO_MISSING capture where the last
 *    progress line is immediately followed by "✖ Error:" with nothing but a
 *    newline between them. Any other, non-blank content in that slot means
 *    the CLI printed *something* there that this parser doesn't recognize —
 *    a format/wording change, regardless of which words it uses — so it
 *    throws rather than assuming 0.
 *
 * The `"✅ Primary Language:   <locale>"` report header remains required
 * up front as a basic sanity anchor that this is `status` output at all.
 *
 * @throws {Error} if the report header's primary-language line is not found,
 *   if the Translation Progress section is incomplete (truncated capture),
 *   or if the slot after the last progress line contains unrecognized,
 *   non-blank text instead of being genuinely empty.
 */
export const parseDefaultLanguageMissingCount = (stdout: string): number => {
  const primaryLanguageMatch = stdout.match(/✅ Primary Language:\s+(\S+)/);

  if (primaryLanguageMatch == null) {
    throw new Error(
      'Failed to parse default-language missing-key count: expected a ' +
        '"✅ Primary Language:   <locale>" line was not found in `status` output.',
    );
  }

  const strictMatch = stdout.match(
    /Primary language "[^"]+" is missing (\d+) key\(s\)/,
  );

  if (strictMatch != null) {
    return Number(strictMatch[1]);
  }

  const primaryLocale = primaryLanguageMatch[1];
  const localesHeaderMatch = stdout.match(/🌍 Locales:\s+(.+)/);

  if (localesHeaderMatch == null) {
    throw new Error(
      'Failed to parse default-language missing-key count: expected a ' +
        '"🌍 Locales:   <locale>, ..." line was not found, so the ' +
        "Translation Progress section's completeness cannot be confirmed.",
    );
  }

  const secondaryLocales = localesHeaderMatch[1]
    .split(',')
    .map((locale) => locale.trim())
    .filter((locale) => locale.length > 0 && locale !== primaryLocale);

  const incompleteLocales = secondaryLocales.filter((locale) => {
    const escapedLocale = locale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`- ${escapedLocale}: .*—`).test(stdout);
  });

  if (incompleteLocales.length > 0) {
    throw new Error(
      'Failed to parse default-language missing-key count: the Translation ' +
        'Progress section is missing a progress line for ' +
        `${incompleteLocales.join(', ')} — the capture looks truncated or ` +
        'corrupted, so a genuine 0 cannot be confirmed.',
    );
  }

  // Every secondary locale's progress line is present. Find where the last
  // one ends — that is where the strict "is missing N key(s)" line would
  // have printed, had it been non-zero. `matchAll` is not used here because
  // we need the *last* match's end index, and locale line order is expected
  // to follow the 🌍 Locales header (confirmed by real captures) but is not
  // load-bearing here — taking the max across all matches is order-agnostic.
  let sectionEndIndex =
    primaryLanguageMatch.index != null
      ? primaryLanguageMatch.index + primaryLanguageMatch[0].length
      : 0;

  for (const locale of secondaryLocales) {
    const escapedLocale = locale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineMatch = stdout.match(new RegExp(`^- ${escapedLocale}: .*$`, 'm'));

    if (lineMatch != null && lineMatch.index != null) {
      const lineEndIndex = lineMatch.index + lineMatch[0].length;
      sectionEndIndex = Math.max(sectionEndIndex, lineEndIndex);
    }
  }

  // A genuine stdout-only capture never contains the CLI's stderr-only
  // "✖ Error: ..." line (see the doc comment above), but the fixtures below
  // include it for readability of a full captured session — so treat its
  // first occurrence after the progress section as the end of the slot we
  // are inspecting, rather than as content inside that slot.
  const errorMarkerIndex = stdout.indexOf('✖ Error:', sectionEndIndex);
  const slotEndIndex =
    errorMarkerIndex === -1 ? stdout.length : errorMarkerIndex;
  const slot = stdout.slice(sectionEndIndex, slotEndIndex);

  if (slot.trim().length > 0) {
    throw new Error(
      'Failed to parse default-language missing-key count: found ' +
        'unrecognized text after the Translation Progress section, where ' +
        'the "Primary language \\"<locale>\\" is missing N key(s)" line ' +
        "would be — the CLI's wording may have changed.",
    );
  }

  return 0;
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
 * The "X untranslated," clause itself is omitted from the CLI's output
 * whenever the untranslated count is exactly 0 (observed on `ko_KR`, but not
 * specific to it — see tasks.md's task 1.5 note), so that clause is matched
 * as optional here; its absence does not affect the absent-count extraction.
 *
 * @throws {Error} if the expected summary line for `locale` is not found.
 */
export const parseLocaleMissingCount = (
  stdout: string,
  locale: string,
): number => {
  const escapedLocale = locale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `Summary: Found \\d+ incomplete translations for "${escapedLocale}" — (?:\\d+ untranslated, )?(\\d+) absent`,
  );
  const match = stdout.match(pattern);

  if (match == null) {
    throw new Error(
      `Failed to parse per-locale missing-key count for "${locale}": expected a ` +
        `"Summary: Found N incomplete translations for "${locale}" — [X untranslated,] N absent" ` +
        `line was not found in \`status ${locale}\` output.`,
    );
  }

  return Number(match[1]);
};
