import type { GrowiPluginValidationData } from '@growi/pluginkit';

import type { IGrowiPlugin, IGrowiThemePluginMeta } from '../../../interfaces';

export const generateThemePluginMeta = async (
  plugin: IGrowiPlugin,
  validationData: GrowiPluginValidationData,
): Promise<IGrowiThemePluginMeta> => {
  // TODO: validate as a theme plugin

  return {
    ...plugin.meta,
    themes: validationData.growiPlugin.themes,
  };
};
