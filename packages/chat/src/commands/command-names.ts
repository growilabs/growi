// The command vocabulary shared by both sides of the integration, plus the
// traits each command carries.

/**
 * **Both sides use these constants.** If the `commandName` the GROWI admin
 * screen persists is spelled differently from the name the proxy matches on,
 * channel permissions silently stop taking effect (Requirement 11.1).
 */
export const COMMAND_NAMES = {
  search: 'search',
  createPage: 'create-page',
  keep: 'keep',
  linkPreview: 'link-preview',
  help: 'help',
} as const;

export type CommandName = (typeof COMMAND_NAMES)[keyof typeof COMMAND_NAMES];

/**
 * **Traits belong to the command's own declaration.** Keeping a hand-listed
 * set somewhere else means that adding a write command to `COMMAND_NAMES` and
 * forgetting the set falls to the dangerous side -- **allowed from any
 * channel**. With this shape, a command without traits cannot be declared at
 * all: `Record<CommandName, CommandTraits>` makes the missing entry a
 * compile error.
 */
export type CommandTargeting =
  /** Exactly one target GROWI; if several are linked, the user picks (Requirement 8.2). */
  | 'single'
  /** Fan out to every linked GROWI (Requirement 8.4). */
  | 'broadcast'
  /** Target decided by URL match; the user is never asked (Requirement 6.4). */
  | 'url-matched';

export interface CommandTraits {
  /** Denied by default unless the channel allows it (Requirement 11.1). */
  readonly writes: boolean;
  readonly targeting: CommandTargeting;
}

export const COMMAND_TRAITS: Readonly<Record<CommandName, CommandTraits>> = {
  [COMMAND_NAMES.search]: { writes: false, targeting: 'broadcast' },
  [COMMAND_NAMES.help]: { writes: false, targeting: 'broadcast' },
  [COMMAND_NAMES.createPage]: { writes: true, targeting: 'single' },
  [COMMAND_NAMES.keep]: { writes: true, targeting: 'single' },
  [COMMAND_NAMES.linkPreview]: { writes: false, targeting: 'url-matched' },
};

export const isWriteCommand = (name: CommandName): boolean =>
  COMMAND_TRAITS[name].writes;

export const targetingOf = (name: CommandName): CommandTargeting =>
  COMMAND_TRAITS[name].targeting;
