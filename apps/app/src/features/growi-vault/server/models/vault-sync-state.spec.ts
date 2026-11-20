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

  // ---------------------------------------------------------------------------
  // 7-state bootstrapState enum (requirements 1.11, 1.12)
  // ---------------------------------------------------------------------------

  it('bootstrapState enum contains all 7 values', () => {
    const path = VaultSyncState.schema.path('bootstrapState');
    expect(path).toBeDefined();
    const enumValues = (path as unknown as { enumValues: string[] }).enumValues;
    expect(enumValues).toEqual(
      expect.arrayContaining([
        'pending',
        'running',
        'verifying',
        'done',
        'failed',
        'retrying',
        'escalated',
      ]),
    );
    expect(enumValues).toHaveLength(7);
  });

  // ---------------------------------------------------------------------------
  // 14 new fields declared in schema (requirements 3.5, 5.1, 5.2, 5.3)
  // ---------------------------------------------------------------------------

  const newFields = [
    'bootstrapInstanceId',
    'bootstrapHeartbeatAt',
    'bootstrapLastTriggerSource',
    'bootstrapRetryAttempts',
    'bootstrapRetryNextAt',
    'bootstrapRetryAborted',
    'bootstrapCompletenessLastCheckedAt',
    'bootstrapCompletenessLastResult',
    'bootstrapStreamSnapshotMaxId',
    'driftLastWatermark',
    'driftLastSweepAt',
    'driftDetectedSinceBoot',
    'driftRepairsEmittedSinceBoot',
    'driftLastError',
  ] as const;

  it.each(newFields)('declares the new field "%s"', (field) => {
    expect(VaultSyncState.schema.path(field)).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Default value assertions for each new field
  // ---------------------------------------------------------------------------

  it('bootstrapInstanceId defaults to null', () => {
    const path = VaultSyncState.schema.path('bootstrapInstanceId');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('bootstrapHeartbeatAt defaults to null', () => {
    const path = VaultSyncState.schema.path('bootstrapHeartbeatAt');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('bootstrapLastTriggerSource is a String defaulting to null', () => {
    const path = VaultSyncState.schema.path('bootstrapLastTriggerSource');
    expect(path).toBeDefined();
    expect(path.instance).toBe('String');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('bootstrapRetryAttempts is a Number defaulting to 0', () => {
    const path = VaultSyncState.schema.path('bootstrapRetryAttempts');
    expect(path).toBeDefined();
    expect(path.instance).toBe('Number');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(0);
  });

  it('bootstrapRetryNextAt defaults to null', () => {
    const path = VaultSyncState.schema.path('bootstrapRetryNextAt');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('bootstrapRetryAborted is a Boolean defaulting to false', () => {
    const path = VaultSyncState.schema.path('bootstrapRetryAborted');
    expect(path).toBeDefined();
    expect(path.instance).toBe('Boolean');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(
      false,
    );
  });

  it('bootstrapCompletenessLastCheckedAt defaults to null', () => {
    const path = VaultSyncState.schema.path(
      'bootstrapCompletenessLastCheckedAt',
    );
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('bootstrapCompletenessLastResult defaults to null', () => {
    const path = VaultSyncState.schema.path('bootstrapCompletenessLastResult');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('bootstrapStreamSnapshotMaxId defaults to null', () => {
    const path = VaultSyncState.schema.path('bootstrapStreamSnapshotMaxId');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('driftLastWatermark defaults to null', () => {
    const path = VaultSyncState.schema.path('driftLastWatermark');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('driftLastSweepAt defaults to null', () => {
    const path = VaultSyncState.schema.path('driftLastSweepAt');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('driftDetectedSinceBoot is a Number defaulting to 0', () => {
    const path = VaultSyncState.schema.path('driftDetectedSinceBoot');
    expect(path).toBeDefined();
    expect(path.instance).toBe('Number');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(0);
  });

  it('driftRepairsEmittedSinceBoot is a Number defaulting to 0', () => {
    const path = VaultSyncState.schema.path('driftRepairsEmittedSinceBoot');
    expect(path).toBeDefined();
    expect(path.instance).toBe('Number');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(0);
  });

  it('driftLastError defaults to null', () => {
    const path = VaultSyncState.schema.path('driftLastError');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });
});
