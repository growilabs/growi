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
    it('contains mastra:llmVendor', () => {
      expect(CONFIG_KEYS).toContain('mastra:llmVendor');
    });

    it('contains anthropic:apiKey', () => {
      expect(CONFIG_KEYS).toContain('anthropic:apiKey');
    });

    it('contains anthropic:assistantModel:mastraAgent', () => {
      expect(CONFIG_KEYS).toContain('anthropic:assistantModel:mastraAgent');
    });

    it('contains google:apiKey', () => {
      expect(CONFIG_KEYS).toContain('google:apiKey');
    });

    it('contains google:assistantModel:mastraAgent', () => {
      expect(CONFIG_KEYS).toContain('google:assistantModel:mastraAgent');
    });
  });

  describe('CONFIG_DEFINITIONS', () => {
    describe('mastra:llmVendor', () => {
      it('has envVarName MASTRA_LLM_VENDOR', () => {
        expect(CONFIG_DEFINITIONS['mastra:llmVendor'].envVarName).toBe(
          'MASTRA_LLM_VENDOR',
        );
      });

      it('has default value of undefined (no fallback vendor)', () => {
        expect(CONFIG_DEFINITIONS['mastra:llmVendor'].defaultValue).toBe(
          undefined,
        );
      });

      it('is not marked as secret', () => {
        expect(CONFIG_DEFINITIONS['mastra:llmVendor'].isSecret).toBeFalsy();
      });
    });

    describe('anthropic:apiKey', () => {
      it('has envVarName ANTHROPIC_API_KEY', () => {
        expect(CONFIG_DEFINITIONS['anthropic:apiKey'].envVarName).toBe(
          'ANTHROPIC_API_KEY',
        );
      });

      it('has default value of undefined', () => {
        expect(CONFIG_DEFINITIONS['anthropic:apiKey'].defaultValue).toBe(
          undefined,
        );
      });

      it('is marked as secret', () => {
        expect(CONFIG_DEFINITIONS['anthropic:apiKey'].isSecret).toBe(true);
      });
    });

    describe('anthropic:assistantModel:mastraAgent', () => {
      it('has envVarName ANTHROPIC_MASTRA_AGENT_MODEL', () => {
        expect(
          CONFIG_DEFINITIONS['anthropic:assistantModel:mastraAgent'].envVarName,
        ).toBe('ANTHROPIC_MASTRA_AGENT_MODEL');
      });

      it('has provisional default model claude-sonnet-4-5', () => {
        expect(
          CONFIG_DEFINITIONS['anthropic:assistantModel:mastraAgent']
            .defaultValue,
        ).toBe('claude-sonnet-4-5');
      });

      it('is not marked as secret', () => {
        expect(
          CONFIG_DEFINITIONS['anthropic:assistantModel:mastraAgent'].isSecret,
        ).toBeFalsy();
      });
    });

    describe('google:apiKey', () => {
      it('has envVarName GOOGLE_API_KEY', () => {
        expect(CONFIG_DEFINITIONS['google:apiKey'].envVarName).toBe(
          'GOOGLE_API_KEY',
        );
      });

      it('has default value of undefined', () => {
        expect(CONFIG_DEFINITIONS['google:apiKey'].defaultValue).toBe(
          undefined,
        );
      });

      it('is marked as secret', () => {
        expect(CONFIG_DEFINITIONS['google:apiKey'].isSecret).toBe(true);
      });
    });

    describe('google:assistantModel:mastraAgent', () => {
      it('has envVarName GOOGLE_MASTRA_AGENT_MODEL', () => {
        expect(
          CONFIG_DEFINITIONS['google:assistantModel:mastraAgent'].envVarName,
        ).toBe('GOOGLE_MASTRA_AGENT_MODEL');
      });

      it('has provisional default model gemini-2.5-flash', () => {
        expect(
          CONFIG_DEFINITIONS['google:assistantModel:mastraAgent'].defaultValue,
        ).toBe('gemini-2.5-flash');
      });

      it('is not marked as secret', () => {
        expect(
          CONFIG_DEFINITIONS['google:assistantModel:mastraAgent'].isSecret,
        ).toBeFalsy();
      });
    });
  });
});
