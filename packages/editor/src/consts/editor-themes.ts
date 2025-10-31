const EditorTheme = {
  defaultlight: 'defaultlight',
  eclipse: 'eclipse',
  basic: 'basic',
  ayu: 'ayu',
  rosepine: 'rosepine',
  defaultdark: 'defaultdark',
  material: 'material',
  nord: 'nord',
  cobalt: 'cobalt',
  kimbie: 'kimbie',
} as const;

export const DEFAULT_THEME = 'defaultlight';
export const AllEditorTheme = Object.values(EditorTheme);
export type EditorTheme = (typeof EditorTheme)[keyof typeof EditorTheme];
