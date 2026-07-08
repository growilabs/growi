import {
  AllSupportedActions,
  isAuditlogSuggestionField,
  SupportedAction,
} from './activity';

describe('isAuditlogSuggestionField()', () => {
  it('should return true for "username"', () => {
    expect(isAuditlogSuggestionField('username')).toBe(true);
  });

  it('should return false for an unrecognized string', () => {
    expect(isAuditlogSuggestionField('foo')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isAuditlogSuggestionField('')).toBe(false);
  });

  it('should return false for null', () => {
    expect(isAuditlogSuggestionField(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isAuditlogSuggestionField(undefined)).toBe(false);
  });
});

describe('SupportedAction - GROWI Vault resilience constants', () => {
  it('exports ACTION_VAULT_RESILIENCE_BOOTSTRAP_STARTED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_BOOTSTRAP_STARTED).toBe(
      'vault.resilience.bootstrap-started',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_BOOTSTRAP_COMPLETED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_BOOTSTRAP_COMPLETED).toBe(
      'vault.resilience.bootstrap-completed',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_BOOTSTRAP_FAILED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_BOOTSTRAP_FAILED).toBe(
      'vault.resilience.bootstrap-failed',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_COMPLETENESS_CHECK_FAILED', () => {
    expect(
      SupportedAction.ACTION_VAULT_RESILIENCE_COMPLETENESS_CHECK_FAILED,
    ).toBe('vault.resilience.completeness-check-failed');
  });

  it('exports ACTION_VAULT_RESILIENCE_RETRY_SCHEDULED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_RETRY_SCHEDULED).toBe(
      'vault.resilience.retry-scheduled',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_RETRY_FAILED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_RETRY_FAILED).toBe(
      'vault.resilience.retry-failed',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_RETRY_ESCALATED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_RETRY_ESCALATED).toBe(
      'vault.resilience.retry-escalated',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_RETRY_ABORTED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_RETRY_ABORTED).toBe(
      'vault.resilience.retry-aborted',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_FORCE_WARNING_ACTIVE', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_FORCE_WARNING_ACTIVE).toBe(
      'vault.resilience.force-warning-active',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_STALE_RUNNING_DETECTED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_STALE_RUNNING_DETECTED).toBe(
      'vault.resilience.stale-running-detected',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_STARTED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_STARTED).toBe(
      'vault.resilience.drift-sweep-started',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_DRIFT_DETECTED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_DRIFT_DETECTED).toBe(
      'vault.resilience.drift-detected',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_DRIFT_REPAIRED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_DRIFT_REPAIRED).toBe(
      'vault.resilience.drift-repaired',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_FAILED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_FAILED).toBe(
      'vault.resilience.drift-sweep-failed',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_OUT_OF_SCOPE', () => {
    expect(
      SupportedAction.ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_OUT_OF_SCOPE,
    ).toBe('vault.resilience.drift-sweep-out-of-scope');
  });

  it('all 15 resilience constants are present in SupportedAction', () => {
    const keys = Object.keys(SupportedAction);
    const resilienceKeys = keys.filter((k) =>
      k.startsWith('ACTION_VAULT_RESILIENCE_'),
    );
    expect(resilienceKeys).toHaveLength(15);
  });
});

describe('SupportedAction - admin AI setting update action', () => {
  it('exports ACTION_ADMIN_AI_SETTING_UPDATE with the expected value', () => {
    expect(SupportedAction.ACTION_ADMIN_AI_SETTING_UPDATE).toBe(
      'ADMIN_AI_SETTING_UPDATE',
    );
  });

  it('includes the AI setting update action in AllSupportedActions', () => {
    expect(AllSupportedActions).toContain('ADMIN_AI_SETTING_UPDATE');
  });
});
