const KeyMapMode = {
  default: 'default',
  vim: 'vim',
  emacs: 'emacs',
  vscode: 'vscode',
} as const;

export const DEFAULT_KEYMAP = 'default';
export const AllKeyMap = Object.values(KeyMapMode);
export type KeyMapMode = (typeof KeyMapMode)[keyof typeof KeyMapMode];
