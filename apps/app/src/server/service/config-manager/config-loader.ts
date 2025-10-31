import type { IConfigLoader, RawConfigData } from '@growi/core/dist/interfaces';
import { toBoolean } from '@growi/core/dist/utils/env-utils';

import loggerFactory from '~/utils/logger';

import { Lang } from '@growi/core/dist/interfaces';
import { coerceToSupportedLang } from '../../util/locale-utils';

import type { ConfigKey, ConfigValues } from './config-definition';
import { CONFIG_DEFINITIONS } from './config-definition';

const logger = loggerFactory('growi:service:ConfigLoader');

export const sanitizeConfigValue = (key: ConfigKey, value: unknown): ConfigValues[ConfigKey] => {
  switch (key) {
    case 'app:globalLang':
      return coerceToSupportedLang(value, { fallback: Lang.en_US }) as ConfigValues[ConfigKey];
    case 'autoInstall:globalLang':
      return coerceToSupportedLang(value, { allowUndefined: true }) as ConfigValues[ConfigKey];
    default:
      return value as ConfigValues[ConfigKey];
  }
};

export class ConfigLoader implements IConfigLoader<ConfigKey, ConfigValues> {

  async loadFromEnv(): Promise<RawConfigData<ConfigKey, ConfigValues>> {
    const envConfig = {} as RawConfigData<ConfigKey, ConfigValues>;

    for (const [key, metadata] of Object.entries(CONFIG_DEFINITIONS)) {
      let configValue: unknown = metadata.defaultValue;

      if (metadata.envVarName != null) {
        const envVarValue = process.env[metadata.envVarName];
        if (envVarValue != null) {
          configValue = this.parseEnvValue(envVarValue, typeof metadata.defaultValue);
        }
      }

      const typedKey = key as ConfigKey;
      const sanitizedValue = sanitizeConfigValue(typedKey, configValue);

      envConfig[typedKey] = {
        definition: metadata,
        value: sanitizedValue,
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
      const typedKey = doc.key as ConfigKey;
      const parsedValue: unknown = doc.value != null ? (() => {
        try {
          return JSON.parse(doc.value);
        }
        catch {
          return null;
        }
      })() : null;
      const sanitizedValue = sanitizeConfigValue(typedKey, parsedValue);

      dbConfig[typedKey] = {
        definition: (doc.key in CONFIG_DEFINITIONS) ? CONFIG_DEFINITIONS[typedKey] : undefined,
        value: sanitizedValue,
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
        }
        catch {
          return null;
        }
      default:
        return value;
    }
  }

}
