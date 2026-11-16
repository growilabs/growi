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
// The one condition that narrows the list is whether GROWI AI can be used
// (Requirement 14.6): an entry declares that it needs AI, and the list is
// filtered on that declaration rather than on a command name.

import { COMMAND_NAMES, type CommandName } from '@growi/chat';

/** One entry of the `help` response's `commands` list. */
export interface HelpCommandEntry {
  readonly name: CommandName;
  readonly usage: string;
  readonly description: string;
}

interface HelpCommandDeclaration extends HelpCommandEntry {
  readonly requiresAi: boolean;
}

const HELP_COMMANDS: ReadonlyArray<HelpCommandDeclaration> = [
  {
    name: COMMAND_NAMES.search,
    usage: '/growi search [keyword]',
    description: 'Search pages across every GROWI linked to this channel.',
    requiresAi: false,
  },
  {
    name: COMMAND_NAMES.createPage,
    usage: '/growi create-page',
    description: 'Create a new GROWI page from this channel.',
    requiresAi: false,
  },
  {
    name: COMMAND_NAMES.agent,
    usage: '@GROWI agent [request]',
    description:
      'Ask GROWI AI a question, or ask it to summarize this conversation into a page.',
    requiresAi: true,
  },
  {
    name: COMMAND_NAMES.linkPreview,
    usage: 'Paste a GROWI page URL',
    description:
      "Posting a linked GROWI page's URL attaches a summary of that page.",
    requiresAi: false,
  },
  {
    name: COMMAND_NAMES.help,
    usage: '/growi help',
    description: 'Show this list of commands.',
    requiresAi: false,
  },
];

/** Every command this GROWI version's chat integration provides right now (Requirements 14.2, 14.6). */
export const buildHelpContent = (conditions: {
  readonly aiReady: boolean;
}): ReadonlyArray<HelpCommandEntry> =>
  HELP_COMMANDS.filter(
    (command) => conditions.aiReady || !command.requiresAi,
  ).map(({ name, usage, description }) => ({ name, usage, description }));
