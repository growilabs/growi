import type { GrowiThemeMetadata } from '@growi/core';

export type IResLayoutSetting = {
  isContainerFluid: boolean;
};

export type IResGrowiTheme = {
  currentTheme: string;
  pluginThemesMetadatas: GrowiThemeMetadata[];
};
