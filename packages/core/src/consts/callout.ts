// Ref: https://github.com/Microflash/remark-callout-directives/blob/fabe4d8adc7738469f253836f0da346591ea2a2b/themes/github/index.js
// Ref: https://github.com/orgs/community/discussions/16925

/**
 * Callout (admonition) variant names — the single source of truth shared by the
 * renderer (the remark plugin in apps/app `features/callout`) and the editor
 * slash commands (`packages/editor` extended-elements). Adding or removing a
 * variant is a one-line change here that propagates to both.
 */
export const AllCallout = [
  'note',
  'tip',
  'important',
  'info',
  'warning',
  'danger',
  'caution',
] as const;
export type Callout = (typeof AllCallout)[number];
