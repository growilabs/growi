import { describe, expect, it } from 'vitest';

import {
  RECONCILE_LOG_TTL_SECONDS,
  VaultReconcileLog,
} from './vault-reconcile-log';

/**
 * Schema-level unit tests for vault_reconcile_log.
 *
 * Verifies:
 * - All required fields are declared in the schema
 * - Enum values for targetType and status
 * - Default values for nullable fields
 * - Index definitions (unique, TTL, compound x2)
 *
 * Requirements: 5.1
 */
describe('VaultReconcileLog schema', () => {
  // ---------------------------------------------------------------------------
  // Field declarations
  // ---------------------------------------------------------------------------

  const allFields = [
    'reconcileId',
    'triggeredAt',
    'triggeredBy.userId',
    'triggeredBy.isAdmin',
    'targetType',
    'targetPath',
    'descendantCount',
    'processedCount',
    'status',
    'rejectReason',
    'startedAt',
    'completedAt',
    'lastError',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(VaultReconcileLog.schema.path(field)).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // plannedPageCount must NOT be in the schema (it is a derived value)
  // ---------------------------------------------------------------------------

  it('does NOT declare plannedPageCount (it is a derived value)', () => {
    expect(VaultReconcileLog.schema.path('plannedPageCount')).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Field types
  // ---------------------------------------------------------------------------

  it('reconcileId is a String', () => {
    const path = VaultReconcileLog.schema.path('reconcileId');
    expect(path.instance).toBe('String');
  });

  it('triggeredAt is a Date', () => {
    const path = VaultReconcileLog.schema.path('triggeredAt');
    expect(path.instance).toBe('Date');
  });

  it('triggeredBy.userId is an ObjectId', () => {
    const path = VaultReconcileLog.schema.path('triggeredBy.userId');
    // Mongoose 6.x reports 'ObjectID' (capital D) for the ObjectId SchemaType.
    expect(path.instance.toLowerCase()).toBe('objectid');
  });

  it('triggeredBy.isAdmin is a Boolean', () => {
    const path = VaultReconcileLog.schema.path('triggeredBy.isAdmin');
    expect(path.instance).toBe('Boolean');
  });

  it('targetType is a String (enum)', () => {
    const path = VaultReconcileLog.schema.path('targetType');
    expect(path.instance).toBe('String');
  });

  it('targetPath is a String', () => {
    const path = VaultReconcileLog.schema.path('targetPath');
    expect(path.instance).toBe('String');
  });

  it('descendantCount is a Number', () => {
    const path = VaultReconcileLog.schema.path('descendantCount');
    expect(path.instance).toBe('Number');
  });

  it('processedCount is a Number', () => {
    const path = VaultReconcileLog.schema.path('processedCount');
    expect(path.instance).toBe('Number');
  });

  it('status is a String (enum)', () => {
    const path = VaultReconcileLog.schema.path('status');
    expect(path.instance).toBe('String');
  });

  // ---------------------------------------------------------------------------
  // Enum values
  // ---------------------------------------------------------------------------

  it('targetType enum contains exactly page and sub-tree', () => {
    const path = VaultReconcileLog.schema.path('targetType');
    const enumValues = (path as unknown as { enumValues: string[] }).enumValues;
    expect(enumValues).toEqual(expect.arrayContaining(['page', 'sub-tree']));
    expect(enumValues).toHaveLength(2);
  });

  it('status enum contains all 5 values', () => {
    const path = VaultReconcileLog.schema.path('status');
    const enumValues = (path as unknown as { enumValues: string[] }).enumValues;
    expect(enumValues).toEqual(
      expect.arrayContaining([
        'pending',
        'running',
        'completed',
        'failed',
        'rejected',
      ]),
    );
    expect(enumValues).toHaveLength(5);
  });

  // ---------------------------------------------------------------------------
  // Default values for nullable / optional fields
  // ---------------------------------------------------------------------------

  it('descendantCount defaults to null', () => {
    const path = VaultReconcileLog.schema.path('descendantCount');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('processedCount defaults to 0', () => {
    const path = VaultReconcileLog.schema.path('processedCount');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(0);
  });

  it('rejectReason defaults to null', () => {
    const path = VaultReconcileLog.schema.path('rejectReason');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('startedAt defaults to null', () => {
    const path = VaultReconcileLog.schema.path('startedAt');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('completedAt defaults to null', () => {
    const path = VaultReconcileLog.schema.path('completedAt');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  it('lastError defaults to null', () => {
    const path = VaultReconcileLog.schema.path('lastError');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Index definitions
  // ---------------------------------------------------------------------------

  /**
   * Helper to extract all index descriptors from the schema.
   * Mongoose stores schema-level indexes in schema.indexes() which returns
   * an array of [fields, options] tuples.
   */
  const getIndexes = () => VaultReconcileLog.schema.indexes();

  it('declares a unique index on reconcileId', () => {
    const indexes = getIndexes() as unknown as ReadonlyArray<
      [unknown, unknown]
    >;
    const uniqueOnReconcileId = indexes.find(([fields, options]) => {
      const f = fields as Record<string, unknown>;
      const o = options as Record<string, unknown>;
      return (
        Object.keys(f).length === 1 &&
        f.reconcileId !== undefined &&
        o.unique === true
      );
    });
    expect(uniqueOnReconcileId).toBeDefined();
  });

  it('declares a TTL index on triggeredAt', () => {
    const indexes = getIndexes() as unknown as ReadonlyArray<
      [unknown, unknown]
    >;
    const ttlOnTriggeredAt = indexes.find(([fields, options]) => {
      const f = fields as Record<string, unknown>;
      const o = options as Record<string, unknown>;
      return (
        Object.keys(f).length === 1 &&
        f.triggeredAt !== undefined &&
        typeof o.expireAfterSeconds === 'number'
      );
    });
    expect(ttlOnTriggeredAt).toBeDefined();
  });

  it('TTL expireAfterSeconds equals RECONCILE_LOG_TTL_SECONDS constant', () => {
    const indexes = getIndexes() as unknown as ReadonlyArray<
      [unknown, unknown]
    >;
    const ttlIndex = indexes.find(([fields, options]) => {
      const f = fields as Record<string, unknown>;
      const o = options as Record<string, unknown>;
      return (
        Object.keys(f).length === 1 &&
        f.triggeredAt !== undefined &&
        typeof o.expireAfterSeconds === 'number'
      );
    });
    expect(ttlIndex).toBeDefined();
    if (ttlIndex == null) return;
    const options = ttlIndex[1] as Record<string, unknown>;
    expect(options.expireAfterSeconds).toBe(RECONCILE_LOG_TTL_SECONDS);
  });

  it('RECONCILE_LOG_TTL_SECONDS equals 30 days in seconds', () => {
    expect(RECONCILE_LOG_TTL_SECONDS).toBe(30 * 86400);
  });

  it('declares a compound index on { status, triggeredAt }', () => {
    const indexes = getIndexes() as unknown as ReadonlyArray<
      [unknown, unknown]
    >;
    const compoundStatusTriggeredAt = indexes.find((idx) => {
      const keys = Object.keys(idx[0] as Record<string, unknown>);
      return (
        keys.length === 2 &&
        keys.includes('status') &&
        keys.includes('triggeredAt')
      );
    });
    expect(compoundStatusTriggeredAt).toBeDefined();
  });

  it('declares a compound index on { triggeredBy.userId, triggeredAt }', () => {
    const indexes = getIndexes() as unknown as ReadonlyArray<
      [unknown, unknown]
    >;
    const compoundUserIdTriggeredAt = indexes.find((idx) => {
      const keys = Object.keys(idx[0] as Record<string, unknown>);
      return (
        keys.length === 2 &&
        keys.includes('triggeredBy.userId') &&
        keys.includes('triggeredAt')
      );
    });
    expect(compoundUserIdTriggeredAt).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // collection name
  // ---------------------------------------------------------------------------

  it('uses collection name vault_reconcile_log', () => {
    // Mongoose stores the collection name in the model's collection.
    // Access via schema options is the most reliable approach in tests.
    const collectionName = (
      VaultReconcileLog.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('vault_reconcile_log');
  });
});
