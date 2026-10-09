// The list of commands this GROWI version's chat integration actually
// supports (design.md `HelpContent` -- Requirement 14.2).
//
// Requirement 14.2 is deliberately narrow: "その GROWI が実際に提供しているコマンドと
// その使い方を返す" -- what THIS version provides, not what a particular channel
// is allowed to run. Per-channel permission narrowing (Requirement 14.4) is
// the proxy's job, reading `@growi/chat`'s `permission/channel-permission.ts`
// against this same command list -- this module has no channel/actor
// parameter to narrow with, on purpose.
//
// A static list is correct here because every command in `COMMAND_NAMES` is
// unconditionally available in this version -- there is no feature flag or
// config toggle that removes one of them. If a future command becomes
// conditionally available, this module gains a parameter for that condition
// then; it is not invented ahead of need now.

import { COMMAND_NAMES, type CommandName } from '@growi/chat';

/** One entry of the `help` response's `commands` list. */
export interface HelpCommandEntry {
  readonly name: CommandName;
  readonly usage: string;
  readonly description: string;
}

const HELP_COMMANDS: ReadonlyArray<HelpCommandEntry> = [
  {
    name: COMMAND_NAMES.search,
    usage: '/growi search [keyword]',
    description: 'Search pages across every GROWI linked to this channel.',
  },
  {
    name: COMMAND_NAMES.createPage,
    usage: '/growi create-page',
    description: 'Create a new GROWI page from this channel.',
  },
  {
    name: COMMAND_NAMES.keep,
    usage: '/growi keep',
    description:
      "Import a range of this channel's conversation as a new GROWI page.",
  },
  {
    name: COMMAND_NAMES.linkPreview,
    usage: 'Paste a GROWI page URL',
    description:
      "Posting a linked GROWI page's URL attaches a summary of that page.",
  },
  {
    name: COMMAND_NAMES.help,
    usage: '/growi help',
    description: 'Show this list of commands.',
  },
];

/** Every command this GROWI version's chat integration provides (Requirement 14.2). */
export const buildHelpContent = (): ReadonlyArray<HelpCommandEntry> =>
  HELP_COMMANDS;
