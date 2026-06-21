import type { GrowiPluginType, GrowiThemeMetadata } from '@growi/core';

import type { GrowiPluginDirective } from './growi-plugin-package-data';

export type GrowiPluginValidationData = {
  projectDirRoot: string;
  growiPlugin: GrowiPluginDirective;
  schemaVersion: number;
  expectedPluginType?: GrowiPluginType;
  actualPluginTypes?: GrowiPluginType[];
};

export type GrowiTemplatePluginValidationData = GrowiPluginValidationData & {
  supportingLocales: string[];
};

export type GrowiThemePluginValidationData = GrowiPluginValidationData & {
  themes: GrowiThemeMetadata[];
};
