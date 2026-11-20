import { Types } from 'mongoose';

import type { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';

import type { OverwriteFunction } from '../overwrite-function';
import { generateOverwriteParams as generateForCommentReactions } from './comment-reactions';
import { generateOverwriteParams } from './index';

const { ObjectId } = Types;

const HEX = '0123456789abcdef01234567';

const REFERENCE_FIELDS = ['comment', 'page', 'user'] as const;

// The converters never read the context
const convert = (fn: unknown, value: unknown): unknown => {
  if (typeof fn !== 'function') {
    throw new Error('expected an overwrite function');
  }
  return (fn as OverwriteFunction)(value, {
    document: {} as never,
    propertyName: 'x',
  });
};

describe('overwrite params for commentreactions', () => {
  describe.each(REFERENCE_FIELDS)('%s', (field) => {
    const params = generateForCommentReactions();

    it('turns a 24-digit hex string into an ObjectId with the same hex', () => {
      const result = convert(params[field], HEX);

      expect(result).toBeInstanceOf(ObjectId);
      expect((result as Types.ObjectId).toHexString()).toBe(HEX);
    });

    it('accepts uppercase hex', () => {
      const result = convert(params[field], HEX.toUpperCase());

      expect(result).toBeInstanceOf(ObjectId);
      expect((result as Types.ObjectId).toHexString()).toBe(HEX);
    });

    it('keeps a value that is already an ObjectId as an ObjectId', () => {
      const id = new ObjectId(HEX);

      const result = convert(params[field], id);

      expect(result).toBeInstanceOf(ObjectId);
      expect((result as Types.ObjectId).toHexString()).toBe(HEX);
    });

    it.each([
      ['non-hex 24-char string', 'zzzzzzzzzzzzzzzzzzzzzzzz'],
      ['12-char string that ObjectId would accept', 'abcdefghijkl'],
      ['too short hex', '0123'],
      ['empty string', ''],
      ['null', null],
      ['number', 42],
    ])('returns an invalid value as is: %s', (_label, value) => {
      expect(convert(params[field], value)).toBe(value);
    });
  });

  describe('emoji', () => {
    const params = generateForCommentReactions();

    it.each([
      ['an alias', 'unicode:thumbsup', 'unicode:+1'],
      [
        'an alias with a skin tone',
        'unicode:thumbsup::skin-tone-3',
        'unicode:+1::skin-tone-3',
      ],
      ['an already canonical key', 'unicode:+1', 'unicode:+1'],
    ])('normalizes %s', (_label, value, expected) => {
      expect(convert(params.emoji, value)).toBe(expected);
    });

    it.each([
      ['unknown emoji', 'unicode:no-such-emoji-xyz'],
      ['unsupported namespace', 'custom:thumbsup'],
      ['malformed key', 'thumbsup'],
      ['empty string', ''],
      ['null', null],
      ['number', 42],
    ])('returns a value that cannot be normalized as is: %s', (_l, value) => {
      expect(convert(params.emoji, value)).toBe(value);
    });
  });

  it('is what generateOverwriteParams returns for the commentreactions collection', () => {
    const params = generateOverwriteParams(
      'commentreactions',
      HEX,
      {} as GrowiArchiveImportOption,
    );

    expect(Object.keys(params).sort()).toEqual([
      'comment',
      'emoji',
      'page',
      'user',
    ]);
    for (const field of REFERENCE_FIELDS) {
      const result = convert(params[field], HEX);
      expect(result).toBeInstanceOf(ObjectId);
    }
  });
});
