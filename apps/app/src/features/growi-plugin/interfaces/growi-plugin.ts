import type {
  GrowiPluginType,
  GrowiThemeMetadata,
  HasObjectId,
} from '@growi/core';
import type { TemplateSummary } from '@growi/pluginkit/dist/v4';

export type IGrowiPluginOrigin = {
  url: string;
  ghBranch?: string;
  ghTag?: string;
};

export type IGrowiPlugin<M extends IGrowiPluginMeta = IGrowiPluginMeta> = {
  isEnabled: boolean;
  installedPath: string;
  organizationName: string;
  origin: IGrowiPluginOrigin;
  meta: M;
};

export type IGrowiPluginMeta = {
  name: string;
  types: GrowiPluginType[];
  desc?: string;
  author?: string;
};

export type IGrowiThemePluginMeta = IGrowiPluginMeta & {
  themes: GrowiThemeMetadata[];
};

export type IGrowiTemplatePluginMeta = IGrowiPluginMeta & {
  templateSummaries: TemplateSummary[];
};

export type IGrowiPluginMetaByType<T extends GrowiPluginType = any> =
  T extends 'theme'
    ? IGrowiThemePluginMeta
    : T extends 'template'
      ? IGrowiTemplatePluginMeta
      : IGrowiPluginMeta;

export type IGrowiPluginHasId = IGrowiPlugin & HasObjectId;
