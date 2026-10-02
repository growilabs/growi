import type { ColorScheme } from '../interfaces/color-scheme.js';
import { GrowiThemeSchemeType } from '../interfaces/growi-theme-metadata.js';

export const getForcedColorScheme = (
  growiThemeSchemeType?: GrowiThemeSchemeType,
): ColorScheme | undefined => {
  return growiThemeSchemeType == null ||
    growiThemeSchemeType === GrowiThemeSchemeType.BOTH
    ? undefined
    : (growiThemeSchemeType as ColorScheme);
};
