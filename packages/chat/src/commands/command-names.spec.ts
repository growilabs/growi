import { describe, expect, it } from 'vitest';

import {
  COMMAND_NAMES,
  COMMAND_TRAITS,
  type CommandName,
  type CommandTargeting,
  isWriteCommand,
  targetingOf,
} from './command-names';

describe('command name vocabulary', () => {
  it('spells every command name exactly as both sides persist/match it', () => {
    // Both sides (GROWI admin UI persisting `commandName`, proxy matching it)
    // read these literals from here. A silent spelling drift would make
    // channel permissions stop taking effect (Requirement 11.1).
    expect(COMMAND_NAMES).toEqual({
      search: 'search',
      createPage: 'create-page',
      keep: 'keep',
      linkPreview: 'link-preview',
      help: 'help',
    });
  });
});

describe('command traits', () => {
  // The type system already refuses a command declared without traits
  // (`Record<CommandName, CommandTraits>`); this runtime assertion is the
  // guard that keeps holding once the type-level probe is gone, so a
  // command can never fall through to the dangerous "allowed from any
  // channel" side (Requirement 11.1).
  it('declares traits for every command name, with no extra entries', () => {
    expect(Object.keys(COMMAND_TRAITS).sort()).toEqual(
      [...Object.values(COMMAND_NAMES)].sort(),
    );
  });

  const cases: readonly [CommandName, boolean, CommandTargeting][] = [
    // Requirement 8.4: a command aimed at every GROWI fans out without asking.
    [COMMAND_NAMES.search, false, 'broadcast'],
    // Requirement 14.1: help reports what the channel can do, per GROWI.
    [COMMAND_NAMES.help, false, 'broadcast'],
    // Requirement 8.2: a single-target write makes the user pick when the
    // channel has several GROWIs linked. Requirement 11.1: it writes.
    [COMMAND_NAMES.createPage, true, 'single'],
    [COMMAND_NAMES.keep, true, 'single'],
    // Requirement 6.4: the target follows from the URL, never from a prompt.
    [COMMAND_NAMES.linkPreview, false, 'url-matched'],
  ];

  it.each(cases)('%s: writes=%s targeting=%s', (name, writes, targeting) => {
    expect(isWriteCommand(name)).toBe(writes);
    expect(targetingOf(name)).toBe(targeting);
    expect(COMMAND_TRAITS[name]).toEqual({ writes, targeting });
  });

  it('uses only the three ways a target can be decided', () => {
    const targetings = Object.values(COMMAND_TRAITS).map((t) => t.targeting);
    expect(new Set(targetings)).toEqual(
      new Set(['single', 'broadcast', 'url-matched']),
    );
  });
});
