import loggerFactory from '~/utils/logger';

const PluginUtils = require('./plugin-utils');

const logger = loggerFactory('growi:plugins:PluginService');

class PluginService {

  constructor(crowi, app) {
    this.crowi = crowi;
    this.app = app;
    this.pluginUtils = new PluginUtils();
  }

  autoDetectAndLoadPlugins() {
    const isEnabledPlugins = this.crowi.configManager.getConfig('crowi', 'plugin:isEnabledPlugins');

    // import plugins
    if (isEnabledPlugins) {
      logger.debug('Plugins are enabled');
      this.loadPlugins(this.pluginUtils.listPluginNames(this.crowi.rootDir));
    }

  }

  /**
   * load plugins
   *
   * @memberOf PluginService
   */
  loadPlugins(pluginNames) {
    pluginNames
      .map((name) => {
        return this.pluginUtils.generatePluginDefinition(name);
      })
      .forEach((definition) => {
        this.loadPlugin(definition);
      });
  }

  loadPlugin(definition) {
    const meta = definition.meta;

    switch (meta.pluginSchemaVersion) {
      // v1 is deprecated
      case 1:
        logger.warn('pluginSchemaVersion 1 is deprecated', definition);
        break;
      // v2 is deprecated
      case 2:
        logger.warn('pluginSchemaVersion 2 is deprecated', definition);
        break;
      case 3:
        logger.info(`load plugin '${definition.name}'`);
        definition.entries.forEach((entryPath) => {
          const entry = require(entryPath);
          entry(this.crowi, this.app);
        });
        break;
      default:
        logger.warn('Unsupported schema version', meta.pluginSchemaVersion);
    }
  }

}

module.exports = PluginService;
