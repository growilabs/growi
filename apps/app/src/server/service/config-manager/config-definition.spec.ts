import {
  CONFIG_DEFINITIONS,
  CONFIG_KEYS,
  ENV_ONLY_GROUPS,
} from './config-definition';

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

describe('config-definition suggest-path agentic keys', () => {
  describe('CONFIG_KEYS array', () => {
    it('contains aiTools:suggestPathEngine', () => {
      expect(CONFIG_KEYS).toContain('aiTools:suggestPathEngine');
    });

    it('contains aiTools:suggestPathAgenticSearchLimit', () => {
      expect(CONFIG_KEYS).toContain('aiTools:suggestPathAgenticSearchLimit');
    });

    it('contains aiTools:suggestPathAgenticTimeoutMs', () => {
      expect(CONFIG_KEYS).toContain('aiTools:suggestPathAgenticTimeoutMs');
    });

    it('contains aiTools:suggestPathAgenticChildListingLimit', () => {
      expect(CONFIG_KEYS).toContain(
        'aiTools:suggestPathAgenticChildListingLimit',
      );
    });

    it('contains ai:providerOptions:suggestPathAgent', () => {
      expect(CONFIG_KEYS).toContain('ai:providerOptions:suggestPathAgent');
    });
  });

  // envVarName is the externally documented operator contract for each key;
  // default values are deliberately NOT asserted here (they are tuning
  // constants, and mirroring them in tests only creates change-detectors).
  describe('CONFIG_DEFINITIONS env var names', () => {
    it.each([
      ['aiTools:suggestPathEngine', 'AI_TOOLS_SUGGEST_PATH_ENGINE'],
      [
        'aiTools:suggestPathAgenticSearchLimit',
        'AI_TOOLS_SUGGEST_PATH_AGENTIC_SEARCH_LIMIT',
      ],
      [
        'aiTools:suggestPathAgenticChildListingLimit',
        'AI_TOOLS_SUGGEST_PATH_AGENTIC_CHILD_LISTING_LIMIT',
      ],
      [
        'aiTools:suggestPathAgenticTimeoutMs',
        'AI_TOOLS_SUGGEST_PATH_AGENTIC_TIMEOUT_MS',
      ],
      [
        'ai:providerOptions:suggestPathAgent',
        'AI_SUGGEST_PATH_AGENT_PROVIDER_OPTIONS',
      ],
    ] as const)('%s has envVarName %s', (key, envVarName) => {
      expect(CONFIG_DEFINITIONS[key].envVarName).toBe(envVarName);
    });
  });
});

describe('config-definition multi-provider ai keys', () => {
  describe('CONFIG_KEYS array', () => {
    it('contains ai:providers', () => {
      expect(CONFIG_KEYS).toContain('ai:providers');
    });

    it('contains ai:providerApiKeys', () => {
      expect(CONFIG_KEYS).toContain('ai:providerApiKeys');
    });

    it('contains ai:allowedModels', () => {
      expect(CONFIG_KEYS).toContain('ai:allowedModels');
    });

    // R7.1: the former single-provider keys are replaced (no migration — R7.2)
    it('does not contain the removed single-provider keys', () => {
      expect(CONFIG_KEYS).not.toContain('ai:provider');
      expect(CONFIG_KEYS).not.toContain('ai:apiKey');
      expect(CONFIG_KEYS).not.toContain('ai:azureOpenaiSettings');
    });
  });

  describe('CONFIG_DEFINITIONS', () => {
    describe('ai:providers', () => {
      it('has envVarName AI_PROVIDERS', () => {
        expect(CONFIG_DEFINITIONS['ai:providers'].envVarName).toBe(
          'AI_PROVIDERS',
        );
      });

      // A null default keeps "never configured" observable (R7.3: an install
      // that only has old-format values resolves to null = AI not configured)
      // while still selecting the loader's JSON-parse branch for the env var
      // (typeof null === 'object').
      it('has a default value of null', () => {
        expect(CONFIG_DEFINITIONS['ai:providers'].defaultValue).toBeNull();
      });

      it('is not marked as secret', () => {
        expect(CONFIG_DEFINITIONS['ai:providers'].isSecret).toBeFalsy();
      });
    });

    describe('ai:providerApiKeys', () => {
      it('has envVarName AI_PROVIDER_API_KEYS', () => {
        expect(CONFIG_DEFINITIONS['ai:providerApiKeys'].envVarName).toBe(
          'AI_PROVIDER_API_KEYS',
        );
      });

      it('has a default value of null', () => {
        expect(
          CONFIG_DEFINITIONS['ai:providerApiKeys'].defaultValue,
        ).toBeNull();
      });

      // R1.9: API keys are secret material — must be masked in managed env vars
      it('is marked as secret', () => {
        expect(CONFIG_DEFINITIONS['ai:providerApiKeys'].isSecret).toBe(true);
      });
    });

    describe('ai:allowedModels (kept)', () => {
      it('has envVarName AI_ALLOWED_MODELS', () => {
        expect(CONFIG_DEFINITIONS['ai:allowedModels'].envVarName).toBe(
          'AI_ALLOWED_MODELS',
        );
      });

      // An array default makes the loader treat env/DB values as JSON
      // (typeof defaultValue === 'object'), and getConfig falls back to [].
      it('has a default value of an empty array', () => {
        expect(CONFIG_DEFINITIONS['ai:allowedModels'].defaultValue).toEqual([]);
      });

      it('is not marked as secret', () => {
        expect(CONFIG_DEFINITIONS['ai:allowedModels'].isSecret).toBeFalsy();
      });
    });

    it('no longer defines the removed single-provider keys', () => {
      expect(CONFIG_DEFINITIONS).not.toHaveProperty('ai:provider');
      expect(CONFIG_DEFINITIONS).not.toHaveProperty('ai:apiKey');
      expect(CONFIG_DEFINITIONS).not.toHaveProperty('ai:azureOpenaiSettings');
    });

    // Picker-owned catalog refresh keys share the ai:* prefix but are out of
    // this spec's boundary — guard them against an accidental ai:* sweep.
    describe('model catalog refresh keys (picker-owned, preserved)', () => {
      it('keeps ai:modelCatalogRefreshOnStartup unchanged', () => {
        expect(
          CONFIG_DEFINITIONS['ai:modelCatalogRefreshOnStartup'].envVarName,
        ).toBe('AI_MODEL_CATALOG_REFRESH_ON_STARTUP');
        expect(
          CONFIG_DEFINITIONS['ai:modelCatalogRefreshOnStartup'].defaultValue,
        ).toBe(false);
      });

      it('keeps ai:modelCatalogRefreshCronSchedule unchanged', () => {
        expect(
          CONFIG_DEFINITIONS['ai:modelCatalogRefreshCronSchedule'].envVarName,
        ).toBe('AI_MODEL_CATALOG_REFRESH_CRON_SCHEDULE');
        expect(
          CONFIG_DEFINITIONS['ai:modelCatalogRefreshCronSchedule'].defaultValue,
        ).toBe('0 4 * * *');
      });
    });
  });

  describe('env-only group env:useOnlyEnvVars:ai', () => {
    const aiGroup = ENV_ONLY_GROUPS.find(
      (group) => group.controlKey === 'env:useOnlyEnvVars:ai',
    );

    it('is defined', () => {
      expect(aiGroup).toBeDefined();
    });

    // R5.2: env-only mode locks exactly the enable toggle + the two provider
    // connection keys. R5.3: ai:allowedModels stays OUT of the group so model
    // settings remain editable from the admin UI in env-only mode.
    it('targets exactly the enable toggle and the two provider connection keys', () => {
      expect(aiGroup?.targetKeys).toEqual([
        'app:aiEnabled',
        'ai:providers',
        'ai:providerApiKeys',
      ]);
    });

    it('does not target ai:allowedModels (model settings stay UI-editable)', () => {
      expect(aiGroup?.targetKeys).not.toContain('ai:allowedModels');
    });
  });
});
