import type { Extension } from '@codemirror/state';

export type ShortcutCategory = 'formatting' | 'structural' | 'navigation';

export interface KeymapResult {
  readonly extension: Extension;
  readonly precedence: (ext: Extension) => Extension;
  readonly overrides: readonly ShortcutCategory[];
}

export type KeymapFactory = (onSave?: () => void) => Promise<KeymapResult>;
