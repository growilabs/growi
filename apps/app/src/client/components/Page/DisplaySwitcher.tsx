import type { JSX } from 'react';
import dynamic from 'next/dynamic';

import { useHashChangedEffect } from '~/client/services/side-effects/hash-changed.js';
import { useIsEditable, useRevisionIdFromUrl } from '~/states/page/index.js';
import {
  EditorMode,
  useEditorMode,
  useReservedNextCaretLine,
} from '~/states/ui/editor/index.js';

import { LazyRenderer } from '../Common/LazyRenderer.js';

const PageEditor = dynamic(() => import('../PageEditor/index.js'), { ssr: false });
const PageEditorReadOnly = dynamic(
  () =>
    import('../PageEditor/PageEditorReadOnly.js').then(
      (mod) => mod.PageEditorReadOnly,
    ),
  { ssr: false },
);

export const DisplaySwitcher = (): JSX.Element => {
  const { editorMode } = useEditorMode();
  const isEditable = useIsEditable();
  const revisionIdFromUrl = useRevisionIdFromUrl();

  useHashChangedEffect();
  useReservedNextCaretLine();

  return (
    <LazyRenderer
      shouldRender={isEditable === true && editorMode === EditorMode.Editor}
    >
      {/* Display <PageEditorReadOnly /> when the user is intentionally viewing a specific (past) revision. */}
      {revisionIdFromUrl == null ? <PageEditor /> : <PageEditorReadOnly />}
    </LazyRenderer>
  );
};
