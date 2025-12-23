import type { IConfigLoader, RawConfigData } from '@growi/core/dist/interfaces';
import { toBoolean } from '@growi/core/dist/utils/env-utils';

import loggerFactory from '~/utils/logger';

import type { ConfigKey, ConfigValues } from './config-definition';
import { CONFIG_DEFINITIONS } from './config-definition';

const logger = loggerFactory('growi:service:ConfigLoader');

export class ConfigLoader implements IConfigLoader<ConfigKey, ConfigValues> {
  async loadFromEnv(): Promise<RawConfigData<ConfigKey, ConfigValues>> {
    const envConfig = {} as RawConfigData<ConfigKey, ConfigValues>;

    for (const [key, metadata] of Object.entries(CONFIG_DEFINITIONS)) {
      let configValue = metadata.defaultValue;

      if (metadata.envVarName != null) {
        const envVarValue = process.env[metadata.envVarName];
        if (envVarValue != null) {
          configValue = this.parseEnvValue(
            envVarValue,
            typeof metadata.defaultValue,
          ) as ConfigValues[ConfigKey];
        }
      }

      envConfig[key as ConfigKey] = {
        definition: metadata,
        value: configValue,
      };
    }

    logger.debug('loadFromEnv', envConfig);

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

    logger.debug('loadFromDB', dbConfig);
    return dbConfig;
  }

  private parseEnvValue(value: string, type: string): unknown {
    switch (type) {
      case 'number':
        return parseInt(value, 10);
      case 'boolean':
        return toBoolean(value);
      case 'string':
        return value;
      case 'object':
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      default:
        return value;
    }
  }
}
