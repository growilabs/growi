import { describe, expect, it } from 'vitest';

import { encodePktLine, parseWantSection } from './vault-pkt-line.js';

/** Builds a pkt-line the way a git client would, for use as test input. */
const pkt = (payload: string): Buffer => encodePktLine(payload);
const FLUSH = Buffer.from('0000');
const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);

describe('encodePktLine', () => {
  it('prefixes the payload with its total length in 4 hex digits', () => {
    // "want <40 hex>\n" is 46 bytes, so the pkt-line is 50 bytes => 0x0032.
    expect(encodePktLine(`want ${OID_A}\n`).toString('utf8')).toBe(
      `0032want ${OID_A}\n`,
    );
  });

  it('counts bytes rather than characters for multi-byte payloads', () => {
    // 'あ' is 3 bytes in UTF-8, so the line is 3 + 4 = 7 bytes => 0x0007.
    expect(encodePktLine('あ').subarray(0, 4).toString('ascii')).toBe('0007');
  });
});

describe('parseWantSection', () => {
  describe('a complete want section', () => {
    it('returns the requested OID', () => {
      const buf = Buffer.concat([pkt(`want ${OID_A}\n`), FLUSH]);

      expect(parseWantSection(buf)).toEqual({
        status: 'complete',
        wants: [OID_A],
        filters: [],
      });
    });

    it('ignores the capability list that git appends to the first want', () => {
      const buf = Buffer.concat([
        pkt(
          `want ${OID_A} multi_ack_detailed side-band-64k agent=git/2.49.0\n`,
        ),
        FLUSH,
      ]);

      expect(parseWantSection(buf)).toEqual({
        status: 'complete',
        wants: [OID_A],
        filters: [],
      });
    });

    it('returns every OID when the client asks for more than one', () => {
      const buf = Buffer.concat([
        pkt(`want ${OID_A} side-band-64k\n`),
        pkt(`want ${OID_B}\n`),
        FLUSH,
      ]);

      expect(parseWantSection(buf)).toEqual({
        status: 'complete',
        wants: [OID_A, OID_B],
        filters: [],
      });
    });

    it('skips lines that carry no decision for the guard (shallow / deepen)', () => {
      const buf = Buffer.concat([
        pkt(`want ${OID_A} side-band-64k\n`),
        pkt(`shallow ${OID_B}\n`),
        pkt('deepen 1\n'),
        FLUSH,
      ]);

      expect(parseWantSection(buf)).toEqual({
        status: 'complete',
        wants: [OID_A],
        filters: [],
      });
    });

    it('returns the partial-clone filter the client asked for', () => {
      // The guard has to decide on the filter too: an unserved one is refused
      // before upload-pack runs, rather than failing the client's checkout later.
      const buf = Buffer.concat([
        pkt(`want ${OID_A} side-band-64k filter\n`),
        pkt('filter blob:none\n'),
        FLUSH,
      ]);

      expect(parseWantSection(buf)).toEqual({
        status: 'complete',
        wants: [OID_A],
        filters: ['blob:none'],
      });
    });

    it('returns each filter when the client sends more than one line', () => {
      const buf = Buffer.concat([
        pkt(`want ${OID_A}\n`),
        pkt(`filter sparse:oid=${OID_B}\n`),
        pkt('filter tree:0\n'),
        FLUSH,
      ]);

      expect(parseWantSection(buf)).toEqual({
        status: 'complete',
        wants: [OID_A],
        filters: [`sparse:oid=${OID_B}`, 'tree:0'],
      });
    });

    it('does not mistake the `filter` capability on the first want for a filter line', () => {
      // git announces the capability in the want line whenever it *could* use a
      // filter; only a `filter <spec>` line actually asks for one.
      const buf = Buffer.concat([
        pkt(`want ${OID_A} multi_ack_detailed filter\n`),
        FLUSH,
      ]);

      expect(parseWantSection(buf)).toEqual({
        status: 'complete',
        wants: [OID_A],
        filters: [],
      });
    });

    it('accepts a section that carries no want at all', () => {
      const buf = Buffer.concat([pkt('deepen 1\n'), FLUSH]);

      expect(parseWantSection(buf)).toEqual({
        status: 'complete',
        wants: [],
        filters: [],
      });
    });

    it('stops at the first flush and ignores whatever follows it', () => {
      const buf = Buffer.concat([
        pkt(`want ${OID_A}\n`),
        FLUSH,
        pkt(`have ${OID_B}\n`),
        pkt('done\n'),
      ]);

      expect(parseWantSection(buf)).toEqual({
        status: 'complete',
        wants: [OID_A],
        filters: [],
      });
    });

    it('accepts a 64-hex OID so a sha256 repository is not rejected outright', () => {
      const sha256 = 'c'.repeat(64);
      const buf = Buffer.concat([pkt(`want ${sha256}\n`), FLUSH]);

      expect(parseWantSection(buf)).toEqual({
        status: 'complete',
        wants: [sha256],
        filters: [],
      });
    });
  });

  describe('an incomplete want section', () => {
    it('asks for more when the flush has not arrived', () => {
      const buf = pkt(`want ${OID_A}\n`);

      expect(parseWantSection(buf)).toEqual({ status: 'need-more' });
    });

    it('asks for more when a pkt-line is cut in the middle', () => {
      const full = Buffer.concat([pkt(`want ${OID_A}\n`), FLUSH]);

      expect(parseWantSection(full.subarray(0, 20))).toEqual({
        status: 'need-more',
      });
    });

    it('asks for more when even the length prefix is incomplete', () => {
      expect(parseWantSection(Buffer.from('00'))).toEqual({
        status: 'need-more',
      });
    });
  });

  describe('a request that must not be forwarded to upload-pack', () => {
    it('rejects a length prefix that is not hexadecimal', () => {
      const buf = Buffer.concat([Buffer.from('zzzz'), FLUSH]);

      expect(parseWantSection(buf)).toMatchObject({ status: 'invalid' });
    });

    it('rejects the protocol v2 delimiter, which this parser does not cover', () => {
      // A v2 request starts with "command=fetch" and uses 0001 as a delimiter.
      const buf = Buffer.concat([
        pkt('command=fetch\n'),
        Buffer.from('0001'),
        pkt(`want ${OID_A}\n`),
        FLUSH,
      ]);

      expect(parseWantSection(buf)).toMatchObject({ status: 'invalid' });
    });

    it('rejects a want whose OID is not a plain object name', () => {
      const buf = Buffer.concat([pkt('want refs/heads/main\n'), FLUSH]);

      expect(parseWantSection(buf)).toMatchObject({ status: 'invalid' });
    });

    it('rejects a want section that never ends, instead of buffering forever', () => {
      // 2000 want lines is ~100 KB, past the cap a real client never reaches.
      const buf = Buffer.concat(
        Array.from({ length: 2000 }, () => pkt(`want ${OID_A}\n`)),
      );

      expect(parseWantSection(buf)).toMatchObject({ status: 'invalid' });
    });
  });
});
