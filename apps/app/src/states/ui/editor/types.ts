export const EditorMode = {
  View: 'view',
  Editor: 'editor',
} as const;
export type EditorMode = (typeof EditorMode)[keyof typeof EditorMode];

export const EditorModeHash = {
  View: '',
  Edit: '#edit',
} as const;
export type EditorModeHash =
  (typeof EditorModeHash)[keyof typeof EditorModeHash];

export type UseEditorModeReturn = {
  editorMode: EditorMode;
  setEditorMode: (mode: EditorMode) => void;
  getClassNamesByEditorMode: () => string[];
};
