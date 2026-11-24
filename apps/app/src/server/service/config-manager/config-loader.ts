import type { IConfigLoader, RawConfigData } from '@growi/core/dist/interfaces';

import loggerFactory from '~/utils/logger';

import type { ConfigKey, ConfigValues } from './config-definition';
import { CONFIG_DEFINITIONS } from './config-definition';
import { parseEnvValue } from './parse-env-value';
import { resolveEnvVarType } from './resolve-env-var-type';

const logger = loggerFactory('growi:service:ConfigLoader');

// The env var of 'app:checkConfigurationValueStrictly'
const STRICT_MODE_ENV_VAR_NAME = 'CHECK_CONFIGURATION_VALUE_STRICTLY';

type InvalidEnvVar = {
  readonly envVarName: string;
  readonly reason: string;
};

/**
 * Read before the main loop because it decides how every other value is parsed.
 * An invalid value keeps strict mode on so the loop reports it instead of
 * silently disabling the check.
 */
const isStrictMode = (): boolean => {
  const value = process.env[STRICT_MODE_ENV_VAR_NAME];
  if (value == null || value === '') {
    return true;
  }
  const result = parseEnvValue(value, 'boolean');
  return result.ok ? result.value === true : true;
};

// The value itself is never included: many credentials are not flagged isSecret.
const formatInvalidEnvVars = (invalidEnvVars: InvalidEnvVar[]): string =>
  [
    'Invalid environment variable value(s):',
    ...invalidEnvVars.map(
      ({ envVarName, reason }) => `  - ${envVarName}: ${reason}`,
    ),
    `Fix the value(s), or set ${STRICT_MODE_ENV_VAR_NAME}=false to fall back to the default values.`,
  ].join('\n');

export class ConfigLoader implements IConfigLoader<ConfigKey, ConfigValues> {
  async loadFromEnv(): Promise<RawConfigData<ConfigKey, ConfigValues>> {
    const strict = isStrictMode();
    const envConfig = {} as RawConfigData<ConfigKey, ConfigValues>;
    const invalidEnvVars: InvalidEnvVar[] = [];

    for (const [key, metadata] of Object.entries(CONFIG_DEFINITIONS)) {
      let configValue: unknown = metadata.defaultValue;
      const { envVarName } = metadata;

      if (envVarName != null) {
        // Resolved even when the env var is unset, so a wrong definition fails every boot
        const envVarType = resolveEnvVarType(key, metadata);
        const envVarValue = process.env[envVarName];
        // An empty value cannot be a valid number/boolean/JSON, so it means "unset"
        const isEmptyNonString = envVarValue === '' && envVarType !== 'string';

        if (envVarValue != null && !isEmptyNonString) {
          const result = parseEnvValue(envVarValue, envVarType);
          if (result.ok) {
            configValue = result.value;
          } else {
            invalidEnvVars.push({ envVarName, reason: result.reason });
          }
        }
      }

      envConfig[key as ConfigKey] = {
        definition: metadata,
        value: configValue as ConfigValues[ConfigKey],
      };
    }

    if (invalidEnvVars.length > 0) {
      const message = formatInvalidEnvVars(invalidEnvVars);
      if (strict) {
        throw new Error(message);
      }
      logger.warn(`${message}\nUsing the default values instead.`);
    }

    logger.debug({ envConfig }, 'loadFromEnv');

    return envConfig;
  }

  async loadFromDB(): Promise<RawConfigData<ConfigKey, ConfigValues>> {
    const dbConfig = {} as RawConfigData<ConfigKey, ConfigValues>;

    // Dynamic import to avoid loading database modules too early
    const { Config } = await import('../../models/config');
    const docs = await Config.find().exec();

    for (const doc of docs) {
      dbConfig[doc.key as ConfigKey] = {
        definition:
          doc.key in CONFIG_DEFINITIONS
            ? CONFIG_DEFINITIONS[doc.key as ConfigKey]
            : undefined,
        value:
          doc.value != null
            ? (() => {
                try {
                  return JSON.parse(doc.value);
                } catch {
                  return null;
                }
              })()
            : null,
      };
    }

    logger.debug({ dbConfig }, 'loadFromDB');
    return dbConfig;
  }
}
