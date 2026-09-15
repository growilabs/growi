import { describe, expect, it } from 'vitest';

import {
  parseByteSequenceDictionary,
  parseStringInnerListDictionary,
  serializeByteSequenceDictionary,
  serializeStringInnerList,
} from './structured-fields.js';

describe('serializeByteSequenceDictionary', () => {
  it('serializes a single member as `key=:base64:` (RFC 8941 Byte Sequence)', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03]);

    expect(serializeByteSequenceDictionary(new Map([['a-key', bytes]]))).toBe(
      `a-key=:${Buffer.from(bytes).toString('base64')}:`,
    );
  });

  it('keeps the insertion order of the members', () => {
    const dictionary = new Map([
      ['first', new Uint8Array([0x00])],
      ['second', new Uint8Array([0xff])],
    ]);

    // RFC 8941 section 4.1.2 separates Dictionary members with `, `.
    expect(serializeByteSequenceDictionary(dictionary)).toBe(
      'first=:AA==:, second=:/w==:',
    );
  });

  it('serializes only the bytes the view covers, not the whole backing buffer', () => {
    // A Node Buffer -- what `createHash().digest()` returns -- is often a view
    // into a shared pool, so a wrapper that hands the raw `.buffer` to the
    // library would base64 unrelated pool memory instead of the value itself.
    const backing = new ArrayBuffer(16);
    new Uint8Array(backing).fill(0xaa);
    const view = new Uint8Array(backing, 8, 4);

    expect(serializeByteSequenceDictionary(new Map([['k', view]]))).toBe(
      `k=:${Buffer.from([0xaa, 0xaa, 0xaa, 0xaa]).toString('base64')}:`,
    );
  });

  it('serializes an empty Byte Sequence as `key=::`', () => {
    expect(
      serializeByteSequenceDictionary(new Map([['k', new Uint8Array(0)]])),
    ).toBe('k=::');
  });
});

describe('serializeStringInnerList', () => {
  it('serializes the members as quoted Strings inside parentheses', () => {
    expect(
      serializeStringInnerList(['@method', 'content-type'], new Map()),
    ).toBe('("@method" "content-type")');
  });

  it('appends the parameters in the given order, Integers bare and Strings quoted', () => {
    expect(
      serializeStringInnerList(
        ['@method'],
        new Map<string, number | string>([
          ['created', 1618884473],
          ['keyid', 'test-key'],
        ]),
      ),
    ).toBe('("@method");created=1618884473;keyid="test-key"');
  });

  it('serializes an empty member list as `()`', () => {
    expect(
      serializeStringInnerList([], new Map([['created', 1618884473]])),
    ).toBe('();created=1618884473');
  });
});

describe('parseByteSequenceDictionary', () => {
  it('reads back what `serializeByteSequenceDictionary` wrote', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03]);

    const parsed = parseByteSequenceDictionary(
      serializeByteSequenceDictionary(new Map([['sig1', bytes]])),
    );

    expect(parsed?.get('sig1')).toStrictEqual(bytes);
  });

  it('returns null instead of throwing for a value that is not this shape', () => {
    // Header values arrive from the network, so every rejection has to be a
    // return value -- `verify` must never throw (requirement 10.2).
    for (const value of [
      'not a structured field ((',
      'sig1="a string"',
      'sig1=("inner" "list")',
      'sig1=42',
    ]) {
      expect(parseByteSequenceDictionary(value)).toBeNull();
    }
  });

  it('reads an empty header value as an empty dictionary', () => {
    // RFC 8941 allows it; whether an empty dictionary is enough is the
    // caller's judgement, not this wrapper's.
    expect(parseByteSequenceDictionary('')?.size).toBe(0);
  });
});

describe('parseStringInnerListDictionary', () => {
  it('reads back the members and the parameters, in the order they were sent', () => {
    const parsed = parseStringInnerListDictionary(
      'sig1=("@method" "content-type");keyid="k";created=1618884473',
    );

    expect(parsed?.get('sig1')?.members).toStrictEqual([
      '@method',
      'content-type',
    ]);
    expect([...(parsed?.get('sig1')?.parameters ?? [])]).toStrictEqual([
      ['keyid', 'k'],
      ['created', 1618884473],
    ]);
  });

  it('returns null instead of throwing for a value that is not this shape', () => {
    for (const value of [
      'not a structured field ((',
      'sig1=42',
      'sig1="a string"',
      'sig1=(1 2)',
      'sig1=("@method");created=?1',
    ]) {
      expect(parseStringInnerListDictionary(value)).toBeNull();
    }
  });

  it('reads an empty header value as an empty dictionary', () => {
    expect(parseStringInnerListDictionary('')?.size).toBe(0);
  });
});
