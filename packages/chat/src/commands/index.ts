// Public barrel for `commands/` -- the command-name vocabulary and traits
// both sides must use so a name added without a declared trait cannot
// silently fall through as "allowed from any channel" (design.md
// "コマンド名の語彙"). Client-safe: re-exported from the top-level
// `src/index.ts`.

export type {
  CommandName,
  CommandTargeting,
  CommandTraits,
} from './command-names.js';
export {
  COMMAND_NAMES,
  COMMAND_TRAITS,
  isWriteCommand,
  targetingOf,
} from './command-names.js';
