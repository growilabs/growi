import { describe, expectTypeOf, it } from 'vitest';

import type { CodeMirrorEditorProps } from './CodeMirrorEditor.js';

describe('CodeMirrorEditorProps', () => {
  it('exposes hideToolbar so callers such as CodeMirrorEditorComment can pass it through', () => {
    // This assignment must type-check: CodeMirrorEditorProps must have an
    // optional `hideToolbar: boolean` field on its public surface.
    const props: CodeMirrorEditorProps = {
      hideToolbar: true,
    };

    expectTypeOf(props.hideToolbar).toEqualTypeOf<boolean | undefined>();
  });
});
