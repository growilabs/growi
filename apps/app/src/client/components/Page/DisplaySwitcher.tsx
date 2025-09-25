import type { JSX } from 'react';

import dynamic from 'next/dynamic';

import { useHashChangedEffect } from '~/client/services/side-effects/hash-changed';
import { useIsEditable } from '~/stores-universal/context';
import { EditorMode, useEditorMode } from '~/stores-universal/ui';
import { useReservedNextCaretLine } from '~/stores/editor';
import { useIsLatestRevision } from '~/stores/page';

import { LazyRenderer } from '../Common/LazyRenderer';


const PageEditor = dynamic(() => import('../PageEditor'), { ssr: false });
const PageEditorReadOnly = dynamic(() => import('../PageEditor/PageEditorReadOnly').then(mod => mod.PageEditorReadOnly), { ssr: false });


export const DisplaySwitcher = (): JSX.Element => {

  const { data: editorMode = EditorMode.View } = useEditorMode();
  const { data: isEditable } = useIsEditable();
  const { data: isLatestRevision } = useIsLatestRevision();

  useHashChangedEffect();
  useReservedNextCaretLine();

  return (
    <LazyRenderer shouldRender={isEditable === true && editorMode === EditorMode.Editor}>
      { isLatestRevision
        ? <PageEditor />
        : <PageEditorReadOnly />
      }
    </LazyRenderer>
  );
};
