import type { ColorScheme } from '../interfaces/color-scheme';
import { GrowiThemeSchemeType } from '../interfaces/growi-theme-metadata';

export const getForcedColorScheme = (
  growiThemeSchemeType?: GrowiThemeSchemeType,
): ColorScheme | undefined => {
  return growiThemeSchemeType == null ||
    growiThemeSchemeType === GrowiThemeSchemeType.BOTH
    ? undefined
    : (growiThemeSchemeType as ColorScheme);
};
