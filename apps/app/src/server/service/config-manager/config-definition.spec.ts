import { CONFIG_DEFINITIONS, CONFIG_KEYS } from './config-definition';

describe('config-definition resilience keys', () => {
  describe('CONFIG_KEYS array', () => {
    it('contains app:vaultBootstrapRetryMax', () => {
      expect(CONFIG_KEYS).toContain('app:vaultBootstrapRetryMax');
    });

    it('contains app:vaultBootstrapRetryBaseMs', () => {
      expect(CONFIG_KEYS).toContain('app:vaultBootstrapRetryBaseMs');
    });

    it('contains app:vaultBootstrapRetryMaxMs', () => {
      expect(CONFIG_KEYS).toContain('app:vaultBootstrapRetryMaxMs');
    });

    it('contains app:vaultBootstrapHeartbeatIntervalMs', () => {
      expect(CONFIG_KEYS).toContain('app:vaultBootstrapHeartbeatIntervalMs');
    });

    it('contains app:vaultBootstrapHeartbeatStaleMs', () => {
      expect(CONFIG_KEYS).toContain('app:vaultBootstrapHeartbeatStaleMs');
    });

    it('contains app:vaultBootstrapRetryDisabled', () => {
      expect(CONFIG_KEYS).toContain('app:vaultBootstrapRetryDisabled');
    });

    it('contains app:vaultDriftDetectionIntervalMs', () => {
      expect(CONFIG_KEYS).toContain('app:vaultDriftDetectionIntervalMs');
    });

    it('contains app:vaultDriftMaxPagesPerTick', () => {
      expect(CONFIG_KEYS).toContain('app:vaultDriftMaxPagesPerTick');
    });

    it('contains app:vaultDriftDetectionDisabled', () => {
      expect(CONFIG_KEYS).toContain('app:vaultDriftDetectionDisabled');
    });
  });

  describe('CONFIG_DEFINITIONS defaults', () => {
    describe('app:vaultBootstrapOnStart', () => {
      it('has default value of "false" (string)', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapOnStart'].defaultValue,
        ).toBe('false');
      });

      it('has envVarName VAULT_BOOTSTRAP_ON_START', () => {
        expect(CONFIG_DEFINITIONS['app:vaultBootstrapOnStart'].envVarName).toBe(
          'VAULT_BOOTSTRAP_ON_START',
        );
      });
    });

    describe('app:vaultBootstrapRetryMax', () => {
      it('has default value of 5', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapRetryMax'].defaultValue,
        ).toBe(5);
      });

      it('has envVarName VAULT_BOOTSTRAP_RETRY_MAX', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapRetryMax'].envVarName,
        ).toBe('VAULT_BOOTSTRAP_RETRY_MAX');
      });
    });

    describe('app:vaultBootstrapRetryBaseMs', () => {
      it('has default value of 30000', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapRetryBaseMs'].defaultValue,
        ).toBe(30_000);
      });

      it('has envVarName VAULT_BOOTSTRAP_RETRY_BASE_MS', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapRetryBaseMs'].envVarName,
        ).toBe('VAULT_BOOTSTRAP_RETRY_BASE_MS');
      });
    });

    describe('app:vaultBootstrapRetryMaxMs', () => {
      it('has default value of 1800000 (30 minutes)', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapRetryMaxMs'].defaultValue,
        ).toBe(1_800_000);
      });

      it('has envVarName VAULT_BOOTSTRAP_RETRY_MAX_MS', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapRetryMaxMs'].envVarName,
        ).toBe('VAULT_BOOTSTRAP_RETRY_MAX_MS');
      });
    });

    describe('app:vaultBootstrapHeartbeatIntervalMs', () => {
      it('has default value of 10000', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapHeartbeatIntervalMs']
            .defaultValue,
        ).toBe(10_000);
      });

      it('has envVarName VAULT_BOOTSTRAP_HEARTBEAT_INTERVAL_MS', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapHeartbeatIntervalMs']
            .envVarName,
        ).toBe('VAULT_BOOTSTRAP_HEARTBEAT_INTERVAL_MS');
      });
    });

    describe('app:vaultBootstrapHeartbeatStaleMs', () => {
      it('has default value of 60000', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapHeartbeatStaleMs'].defaultValue,
        ).toBe(60_000);
      });

      it('has envVarName VAULT_BOOTSTRAP_HEARTBEAT_STALE_MS', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapHeartbeatStaleMs'].envVarName,
        ).toBe('VAULT_BOOTSTRAP_HEARTBEAT_STALE_MS');
      });
    });

    describe('app:vaultBootstrapRetryDisabled', () => {
      it('has default value of false', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapRetryDisabled'].defaultValue,
        ).toBe(false);
      });

      it('has envVarName VAULT_BOOTSTRAP_RETRY_DISABLED', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultBootstrapRetryDisabled'].envVarName,
        ).toBe('VAULT_BOOTSTRAP_RETRY_DISABLED');
      });
    });

    describe('app:vaultDriftDetectionIntervalMs', () => {
      it('has default value of 300000 (5 minutes)', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultDriftDetectionIntervalMs'].defaultValue,
        ).toBe(300_000);
      });

      it('has envVarName VAULT_DRIFT_DETECTION_INTERVAL_MS', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultDriftDetectionIntervalMs'].envVarName,
        ).toBe('VAULT_DRIFT_DETECTION_INTERVAL_MS');
      });
    });

    describe('app:vaultDriftMaxPagesPerTick', () => {
      it('has default value of 10000', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultDriftMaxPagesPerTick'].defaultValue,
        ).toBe(10_000);
      });

      it('has envVarName VAULT_DRIFT_MAX_PAGES_PER_TICK', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultDriftMaxPagesPerTick'].envVarName,
        ).toBe('VAULT_DRIFT_MAX_PAGES_PER_TICK');
      });
    });

    describe('app:vaultDriftDetectionDisabled', () => {
      it('has default value of false', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultDriftDetectionDisabled'].defaultValue,
        ).toBe(false);
      });

      it('has envVarName VAULT_DRIFT_DETECTION_DISABLED', () => {
        expect(
          CONFIG_DEFINITIONS['app:vaultDriftDetectionDisabled'].envVarName,
        ).toBe('VAULT_DRIFT_DETECTION_DISABLED');
      });
    });
  });
});

describe('config-definition multi-llm-provider keys', () => {
  describe('CONFIG_KEYS array', () => {
    it('contains ai:provider', () => {
      expect(CONFIG_KEYS).toContain('ai:provider');
    });

    it('contains ai:apiKey', () => {
      expect(CONFIG_KEYS).toContain('ai:apiKey');
    });

    it('contains ai:model', () => {
      expect(CONFIG_KEYS).toContain('ai:model');
    });

    it('contains ai:providerOptions', () => {
      expect(CONFIG_KEYS).toContain('ai:providerOptions');
    });
  });

  describe('CONFIG_DEFINITIONS', () => {
    describe('ai:provider', () => {
      it('has envVarName AI_PROVIDER', () => {
        expect(CONFIG_DEFINITIONS['ai:provider'].envVarName).toBe(
          'AI_PROVIDER',
        );
      });

      it('has no default value (provider is required)', () => {
        expect(CONFIG_DEFINITIONS['ai:provider'].defaultValue).toBe(undefined);
      });

      it('is not marked as secret', () => {
        expect(CONFIG_DEFINITIONS['ai:provider'].isSecret).toBeFalsy();
      });
    });

    describe('ai:apiKey', () => {
      it('has envVarName AI_API_KEY', () => {
        expect(CONFIG_DEFINITIONS['ai:apiKey'].envVarName).toBe('AI_API_KEY');
      });

      it('has default value of undefined', () => {
        expect(CONFIG_DEFINITIONS['ai:apiKey'].defaultValue).toBe(undefined);
      });

      it('is marked as secret', () => {
        expect(CONFIG_DEFINITIONS['ai:apiKey'].isSecret).toBe(true);
      });
    });

    describe('ai:model', () => {
      it('has envVarName AI_MODEL', () => {
        expect(CONFIG_DEFINITIONS['ai:model'].envVarName).toBe('AI_MODEL');
      });

      it('has no default value (model is required)', () => {
        expect(CONFIG_DEFINITIONS['ai:model'].defaultValue).toBe(undefined);
      });

      it('is not marked as secret', () => {
        expect(CONFIG_DEFINITIONS['ai:model'].isSecret).toBeFalsy();
      });
    });

    describe('ai:providerOptions', () => {
      it('has envVarName AI_PROVIDER_OPTIONS', () => {
        expect(CONFIG_DEFINITIONS['ai:providerOptions'].envVarName).toBe(
          'AI_PROVIDER_OPTIONS',
        );
      });

      it('has no default value (unset means no provider options)', () => {
        expect(CONFIG_DEFINITIONS['ai:providerOptions'].defaultValue).toBe(
          undefined,
        );
      });

      it('is not marked as secret', () => {
        expect(CONFIG_DEFINITIONS['ai:providerOptions'].isSecret).toBeFalsy();
      });
    });
  });
});
