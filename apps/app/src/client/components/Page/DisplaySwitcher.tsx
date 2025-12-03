import type { JSX } from 'react';

import dynamic from 'next/dynamic';

import { useHashChangedEffect } from '~/client/services/side-effects/hash-changed';
import { usePageTransitionEffect } from '~/client/services/side-effects/page-transition';
import { useIsEditable, useIsLatestRevision } from '~/states/page';
import { EditorMode, useEditorMode, useReservedNextCaretLine } from '~/states/ui/editor';

import { LazyRenderer } from '../Common/LazyRenderer';

const PageEditor = dynamic(() => import('../PageEditor'), { ssr: false });
const PageEditorReadOnly = dynamic(() => import('../PageEditor/PageEditorReadOnly').then(mod => mod.PageEditorReadOnly), { ssr: false });

export const DisplaySwitcher = (): JSX.Element => {
  const { editorMode } = useEditorMode();
  const isEditable = useIsEditable();
  const isLatestRevision = useIsLatestRevision();

  usePageTransitionEffect();
  useHashChangedEffect();
  useReservedNextCaretLine();

  return (
    <LazyRenderer shouldRender={isEditable === true && editorMode === EditorMode.Editor}>
      { isLatestRevision !== false
        ? <PageEditor />
        : <PageEditorReadOnly />
      }
    </LazyRenderer>
  );
};
