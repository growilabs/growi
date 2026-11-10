import type { PlatformName } from '../contract/common.js';

/**
 * `contract/common.ts` declares `PlatformName` as a plain string-literal
 * union, not a `COMMAND_NAMES`/`OP_NAMES`-style const object, so there is no
 * existing runtime array to reuse here. Keep this list in sync with that
 * union by hand -- there are only 4 platforms and adding one is rare enough
 * that a compile-time-enforced link (like `Object.values(COMMAND_NAMES)`)
 * isn't worth the indirection.
 */
export const PLATFORM_NAMES: ReadonlyArray<PlatformName> = [
  'slack',
  'discord',
  'teams',
  'mattermost',
];
