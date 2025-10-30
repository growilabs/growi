export const GlobalCodeMirrorEditorKey = {
  MAIN: 'main',
  COMMENT_NEW: 'comment_new',
  DIFF: 'diff',
  READONLY: 'readonly',
} as const;
export type GlobalCodeMirrorEditorKey =
  (typeof GlobalCodeMirrorEditorKey)[keyof typeof GlobalCodeMirrorEditorKey];
