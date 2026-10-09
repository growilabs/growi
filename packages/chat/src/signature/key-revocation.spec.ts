import { describe, expect, it } from 'vitest';

import { judgeKeyRevocation } from './key-revocation';

const NOW = '2026-09-01T00:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';
const FUTURE = '2026-09-01T00:10:00.000Z';

describe('judgeKeyRevocation', () => {
  it('rejects revoking the only valid key', () => {
    const result = judgeKeyRevocation(
      [{ keyId: 'key-a', validFrom: PAST, revokedAt: null }],
      'key-a',
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: 'would-leave-no-valid-key' });
  });

  it('allows revoking one of two valid keys', () => {
    const result = judgeKeyRevocation(
      [
        { keyId: 'key-a', validFrom: PAST, revokedAt: null },
        { keyId: 'key-b', validFrom: PAST, revokedAt: null },
      ],
      'key-a',
      NOW,
    );
    expect(result).toEqual({ ok: true });
  });

  it('allows revoking one of three valid keys, leaving two valid', () => {
    const result = judgeKeyRevocation(
      [
        { keyId: 'key-a', validFrom: PAST, revokedAt: null },
        { keyId: 'key-b', validFrom: PAST, revokedAt: null },
        { keyId: 'key-c', validFrom: PAST, revokedAt: null },
      ],
      'key-c',
      NOW,
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects revoking the last valid key when other keys in the list are already revoked', () => {
    const result = judgeKeyRevocation(
      [
        { keyId: 'key-a', validFrom: PAST, revokedAt: PAST },
        { keyId: 'key-b', validFrom: PAST, revokedAt: null },
      ],
      'key-b',
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: 'would-leave-no-valid-key' });
  });

  it('rejects revoking an unknown keyId', () => {
    const result = judgeKeyRevocation(
      [{ keyId: 'key-a', validFrom: PAST, revokedAt: null }],
      'key-does-not-exist',
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('rejects revoking an unknown keyId against an empty key list', () => {
    const result = judgeKeyRevocation([], 'key-a', NOW);
    expect(result).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('allows re-revoking an already-revoked key (idempotent, does not change the valid count)', () => {
    const result = judgeKeyRevocation(
      [
        { keyId: 'key-a', validFrom: PAST, revokedAt: PAST },
        { keyId: 'key-b', validFrom: PAST, revokedAt: null },
      ],
      'key-a',
      NOW,
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects revoking the only currently-active key when the other key is not yet active (future validFrom)', () => {
    // key-a is active now; key-b was registered for a rotation but its
    // validFrom is still in the future. From the verifier's perspective,
    // revoking key-a right now would leave zero usable keys until key-b
    // activates (design.md's 30s clock-skew tolerance means this window
    // is a real, expected occurrence -- not just a theoretical edge case).
    const result = judgeKeyRevocation(
      [
        { keyId: 'key-a', validFrom: PAST, revokedAt: null },
        { keyId: 'key-b', validFrom: FUTURE, revokedAt: null },
      ],
      'key-a',
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: 'would-leave-no-valid-key' });
  });

  it('allows revoking a key whose validFrom is exactly now (boundary is inclusive)', () => {
    const result = judgeKeyRevocation(
      [
        { keyId: 'key-a', validFrom: NOW, revokedAt: null },
        { keyId: 'key-b', validFrom: PAST, revokedAt: null },
      ],
      'key-a',
      NOW,
    );
    expect(result).toEqual({ ok: true });
  });

  it('allows cancelling a not-yet-active key while one active key remains', () => {
    // key-b is not yet active (validFrom is in the future), so it does not
    // count toward the currently-valid total. Revoking it cannot reduce
    // that total -- key-a stays valid throughout -- so this must be
    // accepted, the same way revoking an already-revoked key is.
    const result = judgeKeyRevocation(
      [
        { keyId: 'key-a', validFrom: PAST, revokedAt: null },
        { keyId: 'key-b', validFrom: FUTURE, revokedAt: null },
      ],
      'key-b',
      NOW,
    );
    expect(result).toEqual({ ok: true });
  });
});
