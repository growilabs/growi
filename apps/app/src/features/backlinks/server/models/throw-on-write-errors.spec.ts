import { throwOnWriteErrors } from './throw-on-write-errors';

// Every reply fixture below is a verbatim capture of what MongoDB returned for a
// `$runCommandRaw` write against the pagelinks collection — an invented shape would let
// the helper agree with the test while both disagree with the database. The sole
// exception is the last test, which deliberately constructs a shape MongoDB does not
// return, because that is the case it exists to cover.
//
// Assertions check what the message *tells the operator* (which call site, what MongoDB
// said, the code), not how it is punctuated: reformatting the message is a refactor, and
// a test that fails on it reports a regression that did not happen.

/** Fails loudly rather than returning a message when the call does not throw. */
const messageFrom = (call: () => void): string => {
  try {
    call();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected throwOnWriteErrors to throw, but it returned');
};

describe('throwOnWriteErrors', () => {
  describe('replies that reported no failure', () => {
    // Not throwing is the contract here, not an absent assertion: a false positive on a
    // clean reply would fail every backlink sync.
    it('accepts an update that upserted a row', () => {
      const reply = {
        n: 1,
        upserted: [{ index: 0, _id: { $oid: '6a990395c82a8dac0f6f31d1' } }],
        nModified: 0,
        ok: 1,
      };

      expect(() => throwOnWriteErrors(reply, 'ctx')).not.toThrow();
    });

    it('accepts a delete that removed a row', () => {
      expect(() => throwOnWriteErrors({ n: 1, ok: 1 }, 'ctx')).not.toThrow();
    });

    it('accepts a write that matched nothing', () => {
      expect(() =>
        throwOnWriteErrors({ n: 0, nModified: 0, ok: 1 }, 'ctx'),
      ).not.toThrow();
    });
  });

  describe('replies that reported a failure while still resolving with ok: 1', () => {
    it('throws for a duplicate key, naming the call site the reply cannot identify', () => {
      const reply = {
        n: 0,
        writeErrors: [
          {
            index: 0,
            code: 11000,
            errmsg:
              'E11000 duplicate key error collection: growi.pagelinks index: fromPage_1_toPath_1 dup key: { fromPage: ObjectId(\'6a99095574c3d607230d5b95\'), toPath: "/x" }',
            keyPattern: { fromPage: 1, toPath: 1 },
            keyValue: {
              fromPage: { $oid: '6a99095574c3d607230d5b95' },
              toPath: '/x',
            },
          },
        ],
        ok: 1,
      };

      const message = messageFrom(() =>
        throwOnWriteErrors(reply, 'replaceOutboundLinks upsert'),
      );

      // Four raw writes share this helper and the reply names none of them.
      expect(message).toContain('replaceOutboundLinks upsert');
      expect(message).toContain('E11000 duplicate key error');
      expect(message).toContain('fromPage_1_toPath_1');
    });

    it('throws for a rejected update operator', () => {
      const reply = {
        n: 0,
        writeErrors: [
          {
            index: 0,
            code: 9,
            errmsg:
              'Unknown modifier: $bogusOperator. Expected a valid update modifier or pipeline-style update specified as an array',
          },
        ],
        nModified: 0,
        ok: 1,
      };

      const message = messageFrom(() =>
        throwOnWriteErrors(reply, 'repointInboundLinks'),
      );

      expect(message).toContain('repointInboundLinks');
      expect(message).toContain('Unknown modifier: $bogusOperator');
    });

    it('reports every failed statement, not just the first', () => {
      // An unordered batch attempts every statement, so one reply can carry several.
      const reply = {
        n: 0,
        writeErrors: [
          {
            index: 0,
            code: 11000,
            errmsg:
              'E11000 duplicate key error collection: growi.pagelinks index: fromPage_1_toPath_1 dup key: { fromPage: ObjectId(\'6a99095574c3d607230d5b95\'), toPath: "/x" }',
            keyPattern: { fromPage: 1, toPath: 1 },
            keyValue: {
              fromPage: { $oid: '6a99095574c3d607230d5b95' },
              toPath: '/x',
            },
          },
          {
            index: 1,
            code: 11000,
            errmsg:
              'E11000 duplicate key error collection: growi.pagelinks index: fromPage_1_toPath_1 dup key: { fromPage: ObjectId(\'6a99095574c3d607230d5b95\'), toPath: "/y" }',
            keyPattern: { fromPage: 1, toPath: 1 },
            keyValue: {
              fromPage: { $oid: '6a99095574c3d607230d5b95' },
              toPath: '/y',
            },
          },
        ],
        ok: 1,
      };

      const message = messageFrom(() => throwOnWriteErrors(reply, 'ctx'));

      // Both rows, not just one: the two entries differ only by the path they name.
      expect(message).toContain('toPath: "/x"');
      expect(message).toContain('toPath: "/y"');
    });

    it('throws when the write applied but the replica set did not acknowledge it', () => {
      // n:1 and no writeErrors — the row IS written; only its durability is unconfirmed.
      const reply = {
        n: 1,
        upserted: [{ index: 0, _id: { $oid: '6a9906b31f14d8271b5fac04' } }],
        nModified: 0,
        writeConcernError: {
          code: 100,
          codeName: 'UnsatisfiableWriteConcern',
          errmsg: 'Not enough data-bearing nodes',
          errInfo: {
            writeConcern: { w: 5, wtimeout: 200, provenance: 'clientSupplied' },
          },
        },
        ok: 1,
      };

      const message = messageFrom(() => throwOnWriteErrors(reply, 'ctx'));

      // This errmsg does not repeat its own code, so it is the one fixture that can
      // prove the code reaches the operator rather than merely appearing inside a quote.
      expect(message).toContain('100');
      expect(message).toContain('Not enough data-bearing nodes');
    });

    it('reports a rejected statement and an unacknowledged write from the same reply', () => {
      // MongoDB really does return both at once: statements are assessed one by one, the
      // write concern once at the end. Diagnosing either alone hides half the failure.
      const reply = {
        n: 0,
        writeErrors: [
          {
            index: 0,
            code: 11000,
            errmsg:
              'E11000 duplicate key error collection: growi.pagelinks index: fromPage_1_toPath_1 dup key: { fromPage: ObjectId(\'6a99095574c3d607230d5b95\'), toPath: "/x" }',
            keyPattern: { fromPage: 1, toPath: 1 },
            keyValue: {
              fromPage: { $oid: '6a99095574c3d607230d5b95' },
              toPath: '/x',
            },
          },
        ],
        writeConcernError: {
          code: 100,
          codeName: 'UnsatisfiableWriteConcern',
          errmsg: 'Not enough data-bearing nodes',
          errInfo: {
            writeConcern: { w: 5, wtimeout: 200, provenance: 'clientSupplied' },
          },
        },
        ok: 1,
      };

      const message = messageFrom(() => throwOnWriteErrors(reply, 'ctx'));

      expect(message).toContain('E11000 duplicate key error');
      expect(message).toContain('Not enough data-bearing nodes');
    });
  });

  it('still reports a failure whose shape it does not recognise', () => {
    // Deliberately not a real reply: MongoDB always sends errmsg. Guards the fallback
    // against a future shape — an unreadable entry must surface, never be dropped as
    // "no failure".
    const reply = { n: 0, writeErrors: [{ index: 0, code: 11000 }], ok: 1 };

    const message = messageFrom(() => throwOnWriteErrors(reply, 'ctx'));

    expect(message).toContain('11000');
  });
});
