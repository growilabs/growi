export const GrowiPluginType = {
  Template: 'template',
  Style: 'style',
  Theme: 'theme',
  Script: 'script',
} as const;
export type GrowiPluginType =
  (typeof GrowiPluginType)[keyof typeof GrowiPluginType];
