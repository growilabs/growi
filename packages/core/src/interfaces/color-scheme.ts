export const ColorScheme = {
  LIGHT: 'light',
  DARK: 'dark',
} as const;
export type ColorScheme = (typeof ColorScheme)[keyof typeof ColorScheme];
