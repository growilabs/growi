import type { Callout } from '@growi/core/dist/consts';

/**
 * The visually-distinct callout types offered in the slash menu.
 *
 * GROWI's renderer (apps/app `CalloutViewer`'s `CALLOUT_TO_TYPE`) renders `info`
 * identically to `important` and `danger` identically to `caution`, so only these
 * five are visually distinct. The alias names are exposed as filter keywords below
 * (e.g. `/info` reaches `important`, `/danger` reaches `caution`) rather than as
 * duplicate menu entries.
 *
 * `@growi/core`'s `AllCallout` keeps all seven names as valid directives for the
 * parser/renderer; this list is only the slash-menu subset. Keep it in sync with
 * the renderer's `CALLOUT_TO_TYPE` aliasing. Typed as `Callout[]` so a typo is
 * caught against the shared `@growi/core` definition.
 */
const DISTINCT_CALLOUTS: readonly Callout[] = [
  'note',
  'tip',
  'important',
  'warning',
  'caution',
];

/**
 * Extra filter aliases per distinct type (the type name itself is added below).
 * `info` / `danger` are the alias directive names that render as `important` /
 * `caution` respectively, so they filter to those commands.
 */
const KEYWORDS: Partial<Record<Callout, readonly string[]>> = {
  tip: ['hint'],
  important: ['info', 'information'],
  warning: ['warn'],
  caution: ['danger'],
};

export interface CalloutVariant {
  readonly type: Callout;
  readonly keywords: readonly string[];
}

/**
 * callout variants for the slash menu: one command per visually-distinct type,
 * with alias directive names folded in as filter keywords.
 */
export const CALLOUT_VARIANTS: readonly CalloutVariant[] =
  DISTINCT_CALLOUTS.map((type) => ({
    type,
    keywords: [type, ...(KEYWORDS[type] ?? [])],
  }));
