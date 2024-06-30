import path from 'path';

import type { ColorScheme } from '@growi/core';
import { getForcedColorScheme } from '@growi/core/dist/utils';
import { DefaultThemeMetadata, PresetThemesMetadatas, manifestPath } from '@growi/preset-themes';
import uglifycss from 'uglifycss';

import { growiPluginService } from '~/features/growi-plugin/server/services';
import loggerFactory from '~/utils/logger';

import S2sMessage from '../models/vo/s2s-message';


import type { ConfigManager } from './config-manager';
import type { S2sMessageHandlable } from './s2s-messaging/handlable';


const logger = loggerFactory('growi:service:CustomizeService');


/**
 * the service class of CustomizeService
 */
class CustomizeService implements S2sMessageHandlable {

  configManager: ConfigManager;

  s2sMessagingService: any;

  appService: any;

  lastLoadedAt?: Date;

  customCss?: string;

  customTitleTemplate!: string;

  theme: string;

  themeHref: string;

  forcedColorScheme?: ColorScheme;

  constructor(crowi) {
    this.configManager = crowi.configManager;
    this.s2sMessagingService = crowi.s2sMessagingService;
    this.appService = crowi.appService;
  }

  /**
   * @inheritdoc
   */
  shouldHandleS2sMessage(s2sMessage) {
    const { eventName, updatedAt } = s2sMessage;
    if (eventName !== 'customizeServiceUpdated' || updatedAt == null) {
      return false;
    }

    return this.lastLoadedAt == null || this.lastLoadedAt < new Date(s2sMessage.updatedAt);
  }

  /**
   * @inheritdoc
   */
  async handleS2sMessage(s2sMessage) {
    const { configManager } = this;

    logger.info('Reset customized value by pubsub notification');
    await configManager.loadConfigs();
    this.initCustomCss();
    this.initCustomTitle();
    this.initGrowiTheme();
  }

  async publishUpdatedMessage() {
    const { s2sMessagingService } = this;

    if (s2sMessagingService != null) {
      const s2sMessage = new S2sMessage('customizeServiceUpdated', { updatedAt: new Date() });

      try {
        await s2sMessagingService.publish(s2sMessage);
      }
      catch (e) {
        logger.error('Failed to publish update message with S2sMessagingService: ', e.message);
      }
    }
  }

  /**
   * initialize custom css strings
   */
  initCustomCss() {
    const rawCss = this.configManager.getConfig('crowi', 'customize:css') || '';

    // uglify and store
    this.customCss = uglifycss.processString(rawCss);

    this.lastLoadedAt = new Date();
  }

  getCustomCss() {
    return this.customCss;
  }

  getCustomScript() {
    return this.configManager.getConfig('crowi', 'customize:script');
  }

  getCustomNoscript() {
    return this.configManager.getConfig('crowi', 'customize:noscript');
  }

  initCustomTitle() {
    let configValue = this.configManager.getConfig('crowi', 'customize:title');

    if (configValue == null || configValue.trim().length === 0) {
      configValue = '{{pagename}} - {{sitename}}';
    }

    this.customTitleTemplate = configValue;

    this.lastLoadedAt = new Date();
  }

  async initGrowiTheme(): Promise<void> {
    const theme = this.configManager.getConfig('crowi', 'customize:theme');

    this.theme = theme;

    const resultForThemePlugin = await growiPluginService.findThemePlugin(theme);

    if (resultForThemePlugin != null) {
      this.forcedColorScheme = getForcedColorScheme(resultForThemePlugin.themeMetadata.schemeType);
      this.themeHref = resultForThemePlugin.themeHref;
    }
    // retrieve preset theme
    else {
      // import preset-themes manifest
      const presetThemesManifest = await import(path.join('@growi/preset-themes', manifestPath)).then(imported => imported.default);

      const themeMetadata = PresetThemesMetadatas.find(p => p.name === theme);
      this.forcedColorScheme = getForcedColorScheme(themeMetadata?.schemeType);

      const manifestKey = themeMetadata?.manifestKey ?? DefaultThemeMetadata.manifestKey;
      if (themeMetadata == null || !(themeMetadata.manifestKey in presetThemesManifest)) {
        logger.warn(`Use default theme because the key for '${theme} does not exist in preset-themes manifest`);
      }
      this.themeHref = `/static/preset-themes/${presetThemesManifest[manifestKey].file}`; // configured by express.static
    }

  }

}

module.exports = CustomizeService;
