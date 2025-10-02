export const PrismThemes = {
  OneLight: 'one-light',
} as const;
export type PrismThemes = (typeof PrismThemes)[keyof typeof PrismThemes];
