// Ref: https://github.com/Microflash/remark-callout-directives/blob/fabe4d8adc7738469f253836f0da346591ea2a2b/themes/github/index.js
// Ref: https://github.com/orgs/community/discussions/16925

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
