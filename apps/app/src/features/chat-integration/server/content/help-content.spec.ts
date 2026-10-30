import { COMMAND_NAMES } from '@growi/chat';

import { buildHelpContent } from './help-content';

describe('buildHelpContent', () => {
  it('includes exactly one entry per declared command name, each with a non-empty usage and description', () => {
    const commands = buildHelpContent();
    const declaredNames = Object.values(COMMAND_NAMES);

    // Data-driven against COMMAND_NAMES itself (not a hand-copied list of 5),
    // so adding a command name there without a HELP_COMMANDS entry fails this
    // test instead of silently shipping an incomplete help list.
    expect(commands.map((command) => command.name).sort()).toEqual(
      [...declaredNames].sort(),
    );

    for (const command of commands) {
      expect(command.usage.length).toBeGreaterThan(0);
      expect(command.description.length).toBeGreaterThan(0);
    }
  });

  it('returns the same static list on every call (no channel/actor narrowing at this layer)', () => {
    expect(buildHelpContent()).toEqual(buildHelpContent());
  });
});
