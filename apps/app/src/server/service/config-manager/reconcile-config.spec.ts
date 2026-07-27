import { CONFIG_DEFINITIONS, CONFIG_KEYS } from './config-definition';

describe('config-definition reconcile keys', () => {
  describe('CONFIG_KEYS array', () => {
    it('contains app:vaultReconcileMaxPagesPerUserRequest', () => {
      expect(CONFIG_KEYS).toContain('app:vaultReconcileMaxPagesPerUserRequest');
    });

    it('contains app:vaultReconcileMaxPagesPerAdminRequest', () => {
      expect(CONFIG_KEYS).toContain(
        'app:vaultReconcileMaxPagesPerAdminRequest',
      );
    });

    it('contains app:vaultReconcileMaxConcurrentPerUser', () => {
      expect(CONFIG_KEYS).toContain('app:vaultReconcileMaxConcurrentPerUser');
    });

    it('contains app:vaultReconcileMaxConcurrentSystem', () => {
      expect(CONFIG_KEYS).toContain('app:vaultReconcileMaxConcurrentSystem');
    });

    it('contains app:vaultReconcileChunkSize', () => {
      expect(CONFIG_KEYS).toContain('app:vaultReconcileChunkSize');
    });

    it('contains app:vaultReconcileHistoryRetentionDays', () => {
      expect(CONFIG_KEYS).toContain('app:vaultReconcileHistoryRetentionDays');
    });

    it('contains app:vaultReconcileRejectWhenBootstrapNotDone', () => {
      expect(CONFIG_KEYS).toContain(
        'app:vaultReconcileRejectWhenBootstrapNotDone',
      );
    });

    it('contains app:vaultReconcileAdminBypassCapacityLimit', () => {
      expect(CONFIG_KEYS).toContain(
        'app:vaultReconcileAdminBypassCapacityLimit',
      );
    });
  });

  describe('CONFIG_DEFINITIONS defaults', () => {
    describe('app:vaultReconcileMaxPagesPerUserRequest', () => {
      it('has default value of 1000', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileMaxPagesPerUserRequest']
            .defaultValue,
        ).toBe(1000);
      });

      it('has envVarName VAULT_RECONCILE_MAX_PAGES_PER_USER_REQUEST', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileMaxPagesPerUserRequest']
            .envVarName,
        ).toBe('VAULT_RECONCILE_MAX_PAGES_PER_USER_REQUEST');
      });
    });

    describe('app:vaultReconcileMaxPagesPerAdminRequest', () => {
      it('has default value of 1000', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileMaxPagesPerAdminRequest']
            .defaultValue,
        ).toBe(1000);
      });

      it('has envVarName VAULT_RECONCILE_MAX_PAGES_PER_ADMIN_REQUEST', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileMaxPagesPerAdminRequest']
            .envVarName,
        ).toBe('VAULT_RECONCILE_MAX_PAGES_PER_ADMIN_REQUEST');
      });
    });

    describe('app:vaultReconcileMaxConcurrentPerUser', () => {
      it('has default value of 1', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileMaxConcurrentPerUser']
            .defaultValue,
        ).toBe(1);
      });

      it('has envVarName VAULT_RECONCILE_MAX_CONCURRENT_PER_USER', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileMaxConcurrentPerUser']
            .envVarName,
        ).toBe('VAULT_RECONCILE_MAX_CONCURRENT_PER_USER');
      });
    });

    describe('app:vaultReconcileMaxConcurrentSystem', () => {
      it('has default value of 3', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileMaxConcurrentSystem']
            .defaultValue,
        ).toBe(3);
      });

      it('has envVarName VAULT_RECONCILE_MAX_CONCURRENT_SYSTEM', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileMaxConcurrentSystem']
            .envVarName,
        ).toBe('VAULT_RECONCILE_MAX_CONCURRENT_SYSTEM');
      });
    });

    describe('app:vaultReconcileChunkSize', () => {
      it('has default value of 100', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileChunkSize'].defaultValue,
        ).toBe(100);
      });

      it('has envVarName VAULT_RECONCILE_CHUNK_SIZE', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileChunkSize'].envVarName,
        ).toBe('VAULT_RECONCILE_CHUNK_SIZE');
      });
    });

    describe('app:vaultReconcileHistoryRetentionDays', () => {
      it('has default value of 30', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileHistoryRetentionDays']
            .defaultValue,
        ).toBe(30);
      });

      it('has envVarName VAULT_RECONCILE_HISTORY_RETENTION_DAYS', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileHistoryRetentionDays']
            .envVarName,
        ).toBe('VAULT_RECONCILE_HISTORY_RETENTION_DAYS');
      });
    });

    describe('app:vaultReconcileRejectWhenBootstrapNotDone', () => {
      it('has default value of true', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileRejectWhenBootstrapNotDone']
            .defaultValue,
        ).toBe(true);
      });

      it('has envVarName VAULT_RECONCILE_REJECT_WHEN_BOOTSTRAP_NOT_DONE', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileRejectWhenBootstrapNotDone']
            .envVarName,
        ).toBe('VAULT_RECONCILE_REJECT_WHEN_BOOTSTRAP_NOT_DONE');
      });
    });

    describe('app:vaultReconcileAdminBypassCapacityLimit', () => {
      it('has default value of false', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileAdminBypassCapacityLimit']
            .defaultValue,
        ).toBe(false);
      });

      it('has envVarName VAULT_RECONCILE_ADMIN_BYPASS_CAPACITY_LIMIT', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultReconcileAdminBypassCapacityLimit']
            .envVarName,
        ).toBe('VAULT_RECONCILE_ADMIN_BYPASS_CAPACITY_LIMIT');
      });
    });
  });
});
