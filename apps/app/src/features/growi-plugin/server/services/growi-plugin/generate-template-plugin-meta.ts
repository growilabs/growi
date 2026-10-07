import type { GrowiPluginValidationData } from '@growi/pluginkit';
import { scanAllTemplates } from '@growi/pluginkit/dist/v4/server/index.cjs';

import type {
  IGrowiPlugin,
  IGrowiTemplatePluginMeta,
} from '../../../interfaces';

export const generateTemplatePluginMeta = async (
  plugin: IGrowiPlugin,
  validationData: GrowiPluginValidationData,
): Promise<IGrowiTemplatePluginMeta> => {
  return {
    ...plugin.meta,
    templateSummaries: await scanAllTemplates(validationData.projectDirRoot, {
      pluginId: plugin.installedPath,
    }),
  };
};
