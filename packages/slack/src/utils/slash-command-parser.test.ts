import { InvalidGrowiCommandError } from '../models/errors';
import { parseSlashCommand } from './slash-command-parser';

describe('parseSlashCommand', () => {
  describe('without growiCommandType', () => {
    test('throws InvalidGrowiCommandError', () => {
      // setup
      const text = '';
      const slashCommand = { text };

      // when/then
      expect(() => {
        parseSlashCommand(slashCommand);
      }).toThrowError(InvalidGrowiCommandError);
    });
  });

  test('returns a GrowiCommand instance with empty growiCommandArgs', () => {
    // setup
    const text = 'search';
    const slashCommand = { text };

    // when
    const result = parseSlashCommand(slashCommand);

    // then
    expect(result.text).toBe(text);
    expect(result.growiCommandType).toBe('search');
    expect(result.growiCommandArgs).toStrictEqual([]);
  });

  test('returns a GrowiCommand instance with space growiCommandType', () => {
    // setup
    const text = '   search   ';
    const slashCommand = { text };

    // when
    const result = parseSlashCommand(slashCommand);

    // then
    expect(result.text).toBe(text);
    expect(result.growiCommandType).toBe('search');
    expect(result.growiCommandArgs).toStrictEqual([]);
  });

  test('returns a GrowiCommand instance with space growiCommandArgs', () => {
    // setup
    const text = '   search hoge   ';
    const slashCommand = { text };

    // when
    const result = parseSlashCommand(slashCommand);

    // then
    expect(result.text).toBe(text);
    expect(result.growiCommandType).toBe('search');
    expect(result.growiCommandArgs).toStrictEqual(['hoge']);
  });

  test('returns a GrowiCommand instance', () => {
    // setup
    const text = 'search keyword1 keyword2';
    const slashCommand = { text };

    // when
    const result = parseSlashCommand(slashCommand);

    // then
    expect(result.text).toBe(text);
    expect(result.growiCommandType).toBe('search');
    expect(result.growiCommandArgs).toStrictEqual(['keyword1', 'keyword2']);
  });
});
