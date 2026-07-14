import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { createEditorCompletionExtension } from './use-default-extensions.js';

/**
 * WHY the cast: `TFunction` is a large overloaded interface with no reasonable
 * non-cast construction; the builder only depends on its `(key) => string` shape
 * (it passes `t` straight to `resolveSlashCommands`). The cast is confined to the
 * call site so the spy stays typed for assertions.
 */

describe('createEditorCompletionExtension', () => {
  it('returns a defined completion extension without throwing', () => {
    const t = vi.fn((key: string) => key);

    let extension: unknown;
    expect(() => {
      extension = createEditorCompletionExtension(t as unknown as TFunction);
    }).not.toThrow();

    // Contract: the wiring produces a usable CodeMirror extension.
    expect(extension).toBeTruthy();
  });

  it('resolves slash-command labels via the provided t (slash source is wired in)', () => {
    const t = vi.fn((key: string) => key);

    createEditorCompletionExtension(t as unknown as TFunction);

    // The unified completion must resolve slash-command display strings through t;
    // this proves the slash source is composed in alongside the emoji source, so a
    // regression that drops the slash source would surface here.
    expect(t).toHaveBeenCalledWith(expect.stringMatching(/^slash_command\./));
  });
});
