import { describe, expect, it } from 'vitest';

import { serializeByteSequenceDictionary } from './structured-fields.js';

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
