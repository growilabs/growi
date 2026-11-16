import { COMMAND_NAMES } from '@growi/chat';

import { buildHelpContent } from './help-content';

// Listed by hand while the protocol still declares `keep`, which GROWI no
// longer offers (tasks.md 6.1 removes it from the protocol).
const OFFERED_COMMANDS = [
  COMMAND_NAMES.search,
  COMMAND_NAMES.createPage,
  COMMAND_NAMES.agent,
  COMMAND_NAMES.linkPreview,
  COMMAND_NAMES.help,
];

describe('buildHelpContent', () => {
  it('lists every command this GROWI offers when GROWI AI is available, each with a usage and a description', () => {
    const commands = buildHelpContent({ aiReady: true });

    expect(commands.map((command) => command.name).sort()).toEqual(
      [...OFFERED_COMMANDS].sort(),
    );
    for (const command of commands) {
      expect(command.usage.length).toBeGreaterThan(0);
      expect(command.description.length).toBeGreaterThan(0);
    }
  });

  it('leaves out agent, and only agent, when GROWI AI is unavailable (Requirement 14.6)', () => {
    const commands = buildHelpContent({ aiReady: false });

    expect(commands.map((command) => command.name).sort()).toEqual(
      OFFERED_COMMANDS.filter((name) => name !== COMMAND_NAMES.agent).sort(),
    );
  });

  it('shows agent as a mention, since it is not a slash command', () => {
    const agent = buildHelpContent({ aiReady: true }).find(
      (command) => command.name === COMMAND_NAMES.agent,
    );

    expect(agent?.usage).toMatch(/^@GROWI agent /);
  });
});
