import { ColorScheme } from './color-scheme';

export const GrowiThemeSchemeType = {
  ...ColorScheme,
  BOTH: 'both',
} as const;
export type GrowiThemeSchemeType =
  (typeof GrowiThemeSchemeType)[keyof typeof GrowiThemeSchemeType];

export type GrowiThemeMetadata = {
  name: string;
  manifestKey: string;
  schemeType: GrowiThemeSchemeType;
  lightBg: string;
  darkBg: string;
  lightSidebar: string;
  darkSidebar: string;
  lightIcon: string;
  darkIcon: string;
  createBtn: string;
  isPresetTheme?: boolean;
};

export const isGrowiThemeMetadata = (
  obj: unknown,
): obj is GrowiThemeMetadata => {
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  const objAny = obj as any;

  return (
    objAny != null &&
    typeof objAny === 'object' &&
    Array.isArray(objAny) === false &&
    'name' in objAny &&
    typeof objAny.name === 'string' &&
    'manifestKey' in objAny &&
    typeof objAny.manifestKey === 'string' &&
    'schemeType' in objAny &&
    typeof objAny.schemeType === 'string' &&
    'lightBg' in objAny &&
    typeof objAny.lightBg === 'string' &&
    'darkBg' in objAny &&
    typeof objAny.darkBg === 'string' &&
    'lightSidebar' in objAny &&
    typeof objAny.lightSidebar === 'string' &&
    'darkSidebar' in objAny &&
    typeof objAny.darkSidebar === 'string' &&
    'lightIcon' in objAny &&
    typeof objAny.lightIcon === 'string' &&
    'darkIcon' in objAny &&
    typeof objAny.darkIcon === 'string' &&
    'createBtn' in objAny &&
    typeof objAny.createBtn === 'string'
  );
};
