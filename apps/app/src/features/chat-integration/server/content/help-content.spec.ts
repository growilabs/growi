import { COMMAND_NAMES } from '@growi/chat';

import { buildHelpContent } from './help-content';

describe('buildHelpContent', () => {
  it('lists every command in the vocabulary when GROWI AI is available, each with a usage and a description', () => {
    const commands = buildHelpContent({ aiReady: true });

    expect(commands.map((command) => command.name).sort()).toEqual(
      Object.values(COMMAND_NAMES).sort(),
    );
    for (const command of commands) {
      expect(command.usage.length).toBeGreaterThan(0);
      expect(command.description.length).toBeGreaterThan(0);
    }
  });

  it('leaves out agent, and only agent, when GROWI AI is unavailable (Requirement 14.6)', () => {
    const commands = buildHelpContent({ aiReady: false });

    expect(commands.map((command) => command.name).sort()).toEqual(
      Object.values(COMMAND_NAMES)
        .filter((name) => name !== COMMAND_NAMES.agent)
        .sort(),
    );
  });

  it('shows agent as a mention, since it is not a slash command', () => {
    const agent = buildHelpContent({ aiReady: true }).find(
      (command) => command.name === COMMAND_NAMES.agent,
    );

    expect(agent?.usage).toMatch(/^@GROWI agent /);
  });
});
