import {
  assertIsArray,
  normalizeAggregateRaw,
  toRawDate,
  toRawObjectId,
} from './prisma-raw-normalize';

describe('normalizeAggregateRaw', () => {
  describe('$oid wrapper', () => {
    it('converts { "$oid": "24-hex-string" } to the hex string', () => {
      const input = { $oid: '507f1f77bcf86cd799439011' };
      const result = normalizeAggregateRaw(input);
      expect(result).toBe('507f1f77bcf86cd799439011');
    });

    it('produces a plain string, not an object', () => {
      const result = normalizeAggregateRaw({
        $oid: 'aabbccddeeff001122334455',
      });
      expect(typeof result).toBe('string');
    });
  });

  describe('$date ISO string wrapper', () => {
    it('converts { "$date": "<ISO>" } to a Date with the correct time', () => {
      const iso = '2024-03-15T10:30:00.000Z';
      const result = normalizeAggregateRaw({ $date: iso });
      expect(result).toBeInstanceOf(Date);
      expect((result as Date).toISOString()).toBe(iso);
    });

    it('preserves millisecond precision', () => {
      const iso = '2023-12-31T23:59:59.999Z';
      const result = normalizeAggregateRaw({ $date: iso });
      expect((result as Date).getTime()).toBe(new Date(iso).getTime());
    });
  });

  describe('$date $numberLong wrapper', () => {
    it('converts { "$date": { "$numberLong": "<ms>" } } to a Date at the correct millisecond', () => {
      const ms = '1710494400000';
      const result = normalizeAggregateRaw({ $date: { $numberLong: ms } });
      expect(result).toBeInstanceOf(Date);
      expect((result as Date).getTime()).toBe(Number(ms));
    });

    it('handles timestamp 0 (epoch)', () => {
      const result = normalizeAggregateRaw({ $date: { $numberLong: '0' } });
      expect((result as Date).getTime()).toBe(0);
    });
  });

  describe('primitive pass-through', () => {
    it('passes string through unchanged', () => {
      expect(normalizeAggregateRaw('hello')).toBe('hello');
    });

    it('passes number through unchanged', () => {
      expect(normalizeAggregateRaw(42)).toBe(42);
    });

    it('passes boolean through unchanged', () => {
      expect(normalizeAggregateRaw(true)).toBe(true);
    });

    it('passes null through unchanged', () => {
      expect(normalizeAggregateRaw(null)).toBeNull();
    });
  });

  describe('recursive normalization in plain objects', () => {
    it('normalizes $oid values nested inside a plain object', () => {
      const input = {
        userId: { $oid: '507f1f77bcf86cd799439011' },
        name: 'Alice',
      };
      const result = normalizeAggregateRaw(input) as Record<string, unknown>;
      expect(result.userId).toBe('507f1f77bcf86cd799439011');
      expect(result.name).toBe('Alice');
    });

    it('normalizes $date values nested inside a plain object', () => {
      const iso = '2024-01-01T00:00:00.000Z';
      const input = { createdAt: { $date: iso }, label: 'test' };
      const result = normalizeAggregateRaw(input) as Record<string, unknown>;
      expect(result.createdAt).toBeInstanceOf(Date);
      expect((result.createdAt as Date).toISOString()).toBe(iso);
    });

    it('normalizes $date $numberLong values nested inside a plain object', () => {
      const ms = '1704067200000';
      const input = { updatedAt: { $date: { $numberLong: ms } } };
      const result = normalizeAggregateRaw(input) as Record<string, unknown>;
      expect((result.updatedAt as Date).getTime()).toBe(Number(ms));
    });
  });

  describe('recursive normalization in arrays', () => {
    it('normalizes each element of an array', () => {
      const iso = '2024-06-01T12:00:00.000Z';
      const input = [
        { $oid: '507f1f77bcf86cd799439011' },
        { $date: iso },
        'plain',
        99,
      ];
      const result = normalizeAggregateRaw(input) as unknown[];
      expect(result[0]).toBe('507f1f77bcf86cd799439011');
      expect(result[1]).toBeInstanceOf(Date);
      expect((result[1] as Date).toISOString()).toBe(iso);
      expect(result[2]).toBe('plain');
      expect(result[3]).toBe(99);
    });
  });

  describe('full aggregate document normalization', () => {
    it('normalizes a complete document shaped like an aggregateRaw result', () => {
      const iso = '2024-05-20T08:00:00.000Z';
      const input = {
        _id: { $oid: '507f1f77bcf86cd799439011' },
        createdAt: { $date: iso },
        user: {
          _id: { $oid: 'aabbccddeeff001122334455' },
          name: 'Bob',
        },
        count: 5,
        tags: [{ $oid: '111111111111111111111111' }, 'static-tag'],
      };

      const result = normalizeAggregateRaw(input) as Record<string, unknown>;

      expect(result._id).toBe('507f1f77bcf86cd799439011');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect((result.createdAt as Date).toISOString()).toBe(iso);

      const user = result.user as Record<string, unknown>;
      expect(user._id).toBe('aabbccddeeff001122334455');
      expect(user.name).toBe('Bob');

      expect(result.count).toBe(5);

      const tags = result.tags as unknown[];
      expect(tags[0]).toBe('111111111111111111111111');
      expect(tags[1]).toBe('static-tag');
    });
  });

  describe('unexpected BSON wrapper — throws with context', () => {
    it('throws for { "$numberDecimal": "1.5" }', () => {
      expect(() => normalizeAggregateRaw({ $numberDecimal: '1.5' })).toThrow(
        '$numberDecimal',
      );
    });

    it('throws for { "$binary": "..." }', () => {
      expect(() =>
        normalizeAggregateRaw({ $binary: { base64: 'abc', subType: '00' } }),
      ).toThrow('$binary');
    });

    it('throws for an arbitrary unknown wrapper key', () => {
      expect(() => normalizeAggregateRaw({ $unknown: 1 })).toThrow('$unknown');
    });

    it('thrown error message includes the wrapper key name as context', () => {
      expect(() =>
        normalizeAggregateRaw({ $timestamp: { t: 1, i: 1 } }),
      ).toThrow(/\$timestamp/);
    });

    it('throws when an unexpected wrapper is nested inside an object', () => {
      expect(() =>
        normalizeAggregateRaw({
          good: { $oid: '507f1f77bcf86cd799439011' },
          bad: { $numberDecimal: '99.9' },
        }),
      ).toThrow('$numberDecimal');
    });
  });

  describe('multi-key objects are NOT treated as wrappers', () => {
    it('recurses into a plain object that has a $-prefixed key among others', () => {
      // An object with multiple keys (even if one starts with $) is a plain object,
      // not a BSON wrapper. Recurse into its values normally.
      const iso = '2024-01-01T00:00:00.000Z';
      const input = {
        $meta: 'some metadata',
        createdAt: { $date: iso },
        count: 3,
      };
      const result = normalizeAggregateRaw(input) as Record<string, unknown>;
      expect(result.$meta).toBe('some metadata');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.count).toBe(3);
    });
  });
});

describe('toRawObjectId', () => {
  it('wraps a hex ID string in the MongoDB Extended JSON $oid form', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(toRawObjectId(id)).toEqual({ $oid: id });
  });

  it('round-trips through normalizeAggregateRaw back to the same ID string', () => {
    // Regression: a raw ObjectId instance or bare string in an aggregateRaw
    // $match serializes to a plain JSON string, which does NOT match a
    // stored BSON ObjectId field -- the query silently matches zero
    // documents. Only the { $oid } form matches correctly (verified against
    // a real MongoDB replica set). This test guards the wire-format contract:
    // whatever toRawObjectId produces must normalize back to the same ID.
    const id = 'aabbccddeeff001122334455';
    expect(normalizeAggregateRaw(toRawObjectId(id))).toBe(id);
  });
});

describe('toRawDate', () => {
  it('wraps a Date in the MongoDB Extended JSON $date form (ISO string)', () => {
    const date = new Date('2025-11-01T00:00:00.000Z');
    expect(toRawDate(date)).toEqual({ $date: '2025-11-01T00:00:00.000Z' });
  });

  it('round-trips through normalizeAggregateRaw back to an equal Date', () => {
    // Regression: a plain Date instance (or its ISO string) in an
    // aggregateRaw $match range comparison ($gte/$lte) serializes to a bare
    // JSON string, which does NOT compare correctly against a stored BSON
    // Date field -- the query silently matches zero documents. Only the
    // { $date } form compares correctly (verified against a real MongoDB
    // replica set).
    const date = new Date('2025-11-01T12:34:56.789Z');
    const normalized = normalizeAggregateRaw(toRawDate(date));
    expect(normalized).toBeInstanceOf(Date);
    expect((normalized as Date).getTime()).toBe(date.getTime());
  });
});

describe('assertIsArray', () => {
  it('does not throw for an array', () => {
    expect(() => assertIsArray([1, 2, 3], 'test context')).not.toThrow();
  });

  it('does not throw for an empty array', () => {
    expect(() => assertIsArray([], 'test context')).not.toThrow();
  });

  it('throws with the given context when the value is not an array', () => {
    // Regression: aggregate-user-activities.ts / aggregate-contributions.ts
    // used to cast an unvalidated aggregateRaw result straight to the
    // expected array type. A silently-wrong pipeline (e.g. a broken $facet)
    // then produced an empty-looking result indistinguishable from "no
    // matching activities" -- exactly the failure mode that let the
    // toRawObjectId/toRawDate regressions go undetected. This guards that a
    // structurally wrong result now fails loudly instead.
    expect(() => assertIsArray({}, 'user-activities $facet.docs')).toThrow(
      /user-activities \$facet\.docs/,
    );
    expect(() => assertIsArray(undefined, 'test context')).toThrow(
      /test context/,
    );
  });
});
