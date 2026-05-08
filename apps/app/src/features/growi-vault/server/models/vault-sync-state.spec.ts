import { describe, expect, it } from 'vitest';

import { VaultSyncState } from './vault-sync-state';

/**
 * Schema-level regression tests.
 *
 * The bootstrapper writes failure details to the singleton document; if the
 * field is missing from the schema Mongoose silently drops the value under
 * default strict mode, which made requirement 5.4 ("record lastError on
 * failure") undetectable from observation. These tests assert that each
 * apps/app-owned field is part of the schema so a future removal fails
 * mechanically rather than silently.
 */
describe('VaultSyncState schema', () => {
  const ownedByGateway = [
    'bootstrapState',
    'bootstrapCursor',
    'bootstrapStartedAt',
    'bootstrapCompletedAt',
    'bootstrapTotalEstimated',
    'bootstrapProcessed',
    'bootstrapLastError',
  ] as const;

  it.each(ownedByGateway)('declares the apps/app-owned field "%s"', (field) => {
    expect(VaultSyncState.schema.path(field)).toBeDefined();
  });

  it('declares bootstrapLastError as a String defaulting to null', () => {
    const path = VaultSyncState.schema.path('bootstrapLastError');
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
    // `defaultValue` is exposed at runtime by Mongoose but absent from the
    // public typings; cast to read it for the regression assertion.
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });
});
