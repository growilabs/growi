import type {
  IConfigManager,
  RawConfigData,
  UpdateConfigOptions,
} from '@growi/core/dist/interfaces';
import { ConfigSource } from '@growi/core/dist/interfaces';
import { parseISO } from 'date-fns/parseISO';

import loggerFactory from '~/utils/logger';

import type S2sMessage from '../../models/vo/s2s-message';
import type { S2sMessagingService } from '../s2s-messaging/base';
import type { S2sMessageHandlable } from '../s2s-messaging/handlable';
import type { ConfigKey, ConfigValues } from './config-definition';
import { ENV_ONLY_GROUPS } from './config-definition';
import { ConfigLoader } from './config-loader';

const logger = loggerFactory('growi:service:ConfigManager');

export type IConfigManagerForApp = IConfigManager<ConfigKey, ConfigValues>;

export class ConfigManager
  implements IConfigManagerForApp, S2sMessageHandlable
{
  private configLoader: ConfigLoader;

  private s2sMessagingService?: S2sMessagingService;

  private envConfig?: RawConfigData<ConfigKey, ConfigValues>;

  private dbConfig?: RawConfigData<ConfigKey, ConfigValues>;

  private lastLoadedAt?: Date;

  private keyToGroupMap: Map<ConfigKey, ConfigKey>;

  constructor() {
    this.configLoader = new ConfigLoader();
    this.keyToGroupMap = this.initKeyToGroupMap();
  }

  private initKeyToGroupMap(): Map<ConfigKey, ConfigKey> {
    const map = new Map<ConfigKey, ConfigKey>();
    for (const group of ENV_ONLY_GROUPS) {
      for (const targetKey of group.targetKeys) {
        map.set(targetKey, group.controlKey);
      }
    }
    return map;
  }

  async loadConfigs(options?: { source?: ConfigSource }): Promise<void> {
    if (options?.source === 'env') {
      this.envConfig = await this.configLoader.loadFromEnv();
    } else if (options?.source === 'db') {
      this.dbConfig = await this.configLoader.loadFromDB();
    } else {
      this.envConfig = await this.configLoader.loadFromEnv();
      this.dbConfig = await this.configLoader.loadFromDB();
    }

    this.lastLoadedAt = new Date();
  }

  getConfig<K extends ConfigKey>(
    key: K,
    source?: ConfigSource,
  ): ConfigValues[K] {
    if (source === ConfigSource.env) {
      if (!this.envConfig) {
        throw new Error('Config is not loaded');
      }
      return this.envConfig[key]?.value as ConfigValues[K];
    }
    if (source === ConfigSource.db) {
      if (!this.dbConfig) {
        throw new Error('Config is not loaded');
      }
      return this.dbConfig[key]?.value as ConfigValues[K];
    }

    if (!this.envConfig || !this.dbConfig) {
      throw new Error('Config is not loaded');
    }

    return (
      this.shouldUseEnvOnly(key)
        ? this.envConfig[key]?.value
        : (this.dbConfig[key]?.value ?? this.envConfig[key]?.value)
    ) as ConfigValues[K];
  }

  /**
   * @deprecated
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getConfigLegacy<T = any>(key: string, source?: ConfigSource): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.getConfig(key as any, source) as T;
  }

  private shouldUseEnvOnly(key: ConfigKey): boolean {
    const controlKey = this.keyToGroupMap.get(key);
    if (!controlKey) {
      return false;
    }

    // Control keys should be read directly from envConfig to avoid recursion
    if (!this.envConfig) {
      throw new Error('Config is not loaded');
    }
    return this.envConfig[controlKey].value === true;
  }

  async updateConfig<K extends ConfigKey>(
    key: K,
    value: ConfigValues[K],
    options?: UpdateConfigOptions,
  ): Promise<void> {
    // Dynamic import to avoid loading database modules too early
    const { Config } = await import('../../models/config');

    if (options?.removeIfUndefined && value === undefined) {
      // remove the config if the value is undefined and removeIfUndefined is true
      await Config.deleteOne({ key });
    } else {
      await Config.updateOne(
        { key },
        { value: JSON.stringify(value) },
        { upsert: true },
      );
    }

    await this.loadConfigs({ source: 'db' });

    if (!options?.skipPubsub) {
      await this.publishUpdateMessage();
    }
  }

  async updateConfigs(
    updates: Partial<{ [K in ConfigKey]: ConfigValues[K] }>,
    options?: UpdateConfigOptions,
  ): Promise<void> {
    // Dynamic import to avoid loading database modules too early
    const { Config } = await import('../../models/config');

    const operations = Object.entries(updates).map(([key, value]) => {
      return options?.removeIfUndefined && value === undefined
        ? // remove the config if the value is undefined
          { deleteOne: { filter: { key } } }
        : // update
          {
            updateOne: {
              filter: { key },
              update: { value: JSON.stringify(value) },
              upsert: true,
            },
          };
    });

    await Config.bulkWrite(operations);
    await this.loadConfigs({ source: 'db' });

    if (!options?.skipPubsub) {
      await this.publishUpdateMessage();
    }
  }

  async removeConfigs(
    keys: ConfigKey[],
    options?: UpdateConfigOptions,
  ): Promise<void> {
    // Dynamic import to avoid loading database modules too early
    const { Config } = await import('../../models/config');

    const operations = keys.map((key) => ({
      deleteOne: {
        filter: { key },
      },
    }));

    await Config.bulkWrite(operations);
    await this.loadConfigs({ source: 'db' });

    if (!options?.skipPubsub) {
      await this.publishUpdateMessage();
    }
  }

  getManagedEnvVars(showSecretValues = false): Record<string, string> {
    if (!this.envConfig) {
      throw new Error('Config is not loaded');
    }

    const envVars = {} as Record<string, string>;

    for (const { definition } of Object.values(this.envConfig)) {
      // continue when the envVarName is not defined
      if (definition?.envVarName == null) {
        continue;
      }

      const { envVarName, isSecret } = definition;
      const value = process.env[envVarName];

      // continue when the value is not defined
      if (value === undefined) {
        continue;
      }

      const shouldBeMasked = isSecret && !showSecretValues;

      envVars[envVarName] = shouldBeMasked ? '***' : value;
    }

    return envVars;
  }

  /**
   * Set S2sMessagingServiceDelegator instance
   * @param s2sMessagingService
   */
  setS2sMessagingService(s2sMessagingService: S2sMessagingService): void {
    this.s2sMessagingService = s2sMessagingService;
  }

  async publishUpdateMessage(): Promise<void> {
    const { default: S2sMessage } = await import('../../models/vo/s2s-message');

    const s2sMessage = new S2sMessage('configUpdated', {
      updatedAt: new Date(),
    });
    try {
      await this.s2sMessagingService?.publish(s2sMessage);
    } catch (e) {
      logger.error(
        'Failed to publish update message with S2sMessagingService: ',
        e.message,
      );
    }
  }

  /**
   * @inheritdoc
   */
  shouldHandleS2sMessage(s2sMessage: S2sMessage): boolean {
    const { eventName } = s2sMessage;
    if (eventName !== 'configUpdated') {
      return false;
    }
    return (
      this.lastLoadedAt == null || // loaded for the first time
      !('updatedAt' in s2sMessage) || // updatedAt is not included in the message
      (typeof s2sMessage.updatedAt === 'string' &&
        this.lastLoadedAt < parseISO(s2sMessage.updatedAt))
    );
  }

  /**
   * @inheritdoc
   */
  async handleS2sMessage(): Promise<void> {
    logger.info('Reload configs by pubsub notification');
    return this.loadConfigs();
  }
}

// Export singleton instance
export const configManager = new ConfigManager();
