import type { GrowiPluginType } from '@growi/core';

export type GrowiPluginDirective = {
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  [key: string]: any;
  schemaVersion: number;
  types: GrowiPluginType[];
};

export type GrowiPluginPackageData = {
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  [key: string]: any;
  growiPlugin: GrowiPluginDirective;
};
