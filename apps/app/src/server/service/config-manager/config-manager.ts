import type { IConfigManager, UpdateConfigOptions, RawConfigData } from '@growi/core/dist/interfaces';
import { ConfigSource } from '@growi/core/dist/interfaces';
import { parseISO } from 'date-fns/parseISO';

import loggerFactory from '~/utils/logger';

import type S2sMessage from '../../models/vo/s2s-message';
import type { S2sMessagingService } from '../s2s-messaging/base';
import type { S2sMessageHandlable } from '../s2s-messaging/handlable';

import type { ConfigKey, ConfigValues } from './config-definition';
import { ENV_ONLY_GROUPS } from './config-definition';
import { ConfigLoader } from './config-loader';
import type { ConfigManager as ConfigManagerLegacy } from './legacy/config-manager';

const logger = loggerFactory('growi:service:ConfigManager');

export type IConfigManagerForApp = IConfigManager<ConfigKey, ConfigValues>

export class ConfigManager implements IConfigManagerForApp, S2sMessageHandlable {

  private configManagerLegacy: ConfigManagerLegacy;

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
    }
    else if (options?.source === 'db') {
      this.dbConfig = await this.configLoader.loadFromDB();
    }
    else {
      this.envConfig = await this.configLoader.loadFromEnv();
      this.dbConfig = await this.configLoader.loadFromDB();
    }

    // Load legacy configs
    if (options == null) {
      this.configManagerLegacy = await import('./legacy/config-manager').then(m => m.configManager);
      await this.configManagerLegacy.loadConfigs();
    }

    this.lastLoadedAt = new Date();
  }

  getConfig<K extends ConfigKey>(key: K, source?: ConfigSource): ConfigValues[K] {
    const value = (() => {
      if (source === ConfigSource.env) {
        if (!this.envConfig) {
          throw new Error('Config is not loaded');
        }
        return this.envConfig[key]?.value;
      }
      if (source === ConfigSource.db) {
        if (!this.dbConfig) {
          throw new Error('Config is not loaded');
        }
        return this.dbConfig[key]?.value;
      }

      if (!this.envConfig || !this.dbConfig) {
        throw new Error('Config is not loaded');
      }

      return this.shouldUseEnvOnly(key)
        ? this.envConfig[key]?.value
        : (this.dbConfig[key] ?? this.envConfig[key])?.value;
    })() as ConfigValues[K];

    // check difference between new and legacy config managers
    if (this.configManagerLegacy != null) {
      this.checkDifference(key, value);
    }

    return value;
  }

  private checkDifference<K extends ConfigKey>(key: K, value: ConfigValues[K], source?: ConfigSource): void {
    const valueByLegacy = (() => {
      if (source === ConfigSource.env) {
        return this.configManagerLegacy.getConfigFromEnvVars('crowi', key);
      }
      if (source === ConfigSource.db) {
        return this.configManagerLegacy.getConfigFromDB('crowi', key);
      }
      return this.configManagerLegacy.getConfig('crowi', key);
    })();

    const isDifferent = (() => {
      if (Array.isArray(value)) {
        return value.length !== valueByLegacy.length || value.some((v, i) => v !== valueByLegacy[i]);
      }

      if (typeof value === 'object') {
        return JSON.stringify(value) !== JSON.stringify(valueByLegacy);
      }

      return value !== valueByLegacy;
    })();

    if (isDifferent) {
      if (!(value === undefined && valueByLegacy === null)) {
        logger.warn(
          `The value of the config key '${key}'${source != null ? ` (source: ${source})` : ''} is different between the new and legacy config managers:`,
          { value, valueByLegacy },
        );
      }
    }
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

  async updateConfig<K extends ConfigKey>(key: K, value: ConfigValues[K], options?: UpdateConfigOptions): Promise<void> {
    // Dynamic import to avoid loading database modules too early
    const { Config } = await import('../../models/config');

    await Config.updateOne(
      { key },
      { value: JSON.stringify(value) },
      { upsert: true },
    );

    await this.loadConfigs({ source: 'db' });

    if (!options?.skipPubsub) {
      await this.publishUpdateMessage();
    }
  }

  async updateConfigs(updates: Partial<{ [K in ConfigKey]: ConfigValues[K] }>, options?: UpdateConfigOptions): Promise<void> {
    // Dynamic import to avoid loading database modules too early
    const { Config } = await import('../../models/config');

    const operations = Object.entries(updates).map(([key, value]) => ({
      updateOne: {
        filter: { key },
        update: { value: JSON.stringify(value) },
        upsert: true,
      },
    }));

    await Config.bulkWrite(operations);
    await this.loadConfigs({ source: 'db' });

    if (!options?.skipPubsub) {
      await this.publishUpdateMessage();
    }
  }

  async removeConfigs(keys: ConfigKey[], options?: UpdateConfigOptions): Promise<void> {
    // Dynamic import to avoid loading database modules too early
    const { Config } = await import('../../models/config');

    const operations = keys.map(key => ({
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

    const s2sMessage = new S2sMessage('configUpdated', { updatedAt: new Date() });
    try {
      await this.s2sMessagingService?.publish(s2sMessage);
    }
    catch (e) {
      logger.error('Failed to publish update message with S2sMessagingService: ', e.message);
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
    return this.lastLoadedAt == null // loaded for the first time
      || !('updatedAt' in s2sMessage) // updatedAt is not included in the message
      || (typeof s2sMessage.updatedAt === 'string' && this.lastLoadedAt < parseISO(s2sMessage.updatedAt));
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
