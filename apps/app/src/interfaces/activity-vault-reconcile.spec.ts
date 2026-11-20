/**
 * Test: vault.reconcile.* audit action constants
 *
 * Verifies that the 5 new constants are exported from activity.ts
 * and have the correct string values per design.md §Audit Events.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTION_VAULT_RECONCILE_COMPLETED,
  ACTION_VAULT_RECONCILE_FAILED,
  ACTION_VAULT_RECONCILE_PARTIAL_ACL_FILTERED,
  ACTION_VAULT_RECONCILE_REJECTED,
  ACTION_VAULT_RECONCILE_STARTED,
  SupportedAction,
} from './activity';

describe('vault.reconcile.* audit action constants', () => {
  it('ACTION_VAULT_RECONCILE_STARTED has the correct string value', () => {
    expect(ACTION_VAULT_RECONCILE_STARTED).toBe('vault.reconcile.started');
  });

  it('ACTION_VAULT_RECONCILE_COMPLETED has the correct string value', () => {
    expect(ACTION_VAULT_RECONCILE_COMPLETED).toBe('vault.reconcile.completed');
  });

  it('ACTION_VAULT_RECONCILE_FAILED has the correct string value', () => {
    expect(ACTION_VAULT_RECONCILE_FAILED).toBe('vault.reconcile.failed');
  });

  it('ACTION_VAULT_RECONCILE_REJECTED has the correct string value', () => {
    expect(ACTION_VAULT_RECONCILE_REJECTED).toBe('vault.reconcile.rejected');
  });

  it('ACTION_VAULT_RECONCILE_PARTIAL_ACL_FILTERED has the correct string value', () => {
    expect(ACTION_VAULT_RECONCILE_PARTIAL_ACL_FILTERED).toBe(
      'vault.reconcile.partial-acl-filtered',
    );
  });

  it('all 5 constants are present in SupportedAction union', () => {
    const values = Object.values(SupportedAction) as string[];
    expect(values).toContain('vault.reconcile.started');
    expect(values).toContain('vault.reconcile.completed');
    expect(values).toContain('vault.reconcile.failed');
    expect(values).toContain('vault.reconcile.rejected');
    expect(values).toContain('vault.reconcile.partial-acl-filtered');
  });
});
