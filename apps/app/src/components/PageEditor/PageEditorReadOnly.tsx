import react, { useMemo, useRef } from 'react';

import { GlobalCodeMirrorEditorKey } from '@growi/editor';
import { CodeMirrorEditorReadOnly } from '@growi/editor/dist/client';
import { throttle } from 'throttle-debounce';

import { useShouldExpandContent } from '~/client/services/layout';
import { useSWRxCurrentPage, useIsLatestRevision } from '~/stores/page';
import { usePreviewOptions } from '~/stores/renderer';

import { EditorNavbar } from './EditorNavbar';
import Preview from './Preview';
import { useScrollSync } from './ScrollSyncHelper';

type Props = {
  visibility?: boolean,
}

export const PageEditorReadOnly = react.memo(({ visibility }: Props): JSX.Element => {
  const previewRef = useRef<HTMLDivElement>(null);

  const { data: currentPage } = useSWRxCurrentPage();
  const { data: rendererOptions } = usePreviewOptions();
  const { data: isLatestRevision } = useIsLatestRevision();
  const shouldExpandContent = useShouldExpandContent(currentPage);

  const { scrollEditorHandler, scrollPreviewHandler } = useScrollSync(GlobalCodeMirrorEditorKey.READONLY, previewRef);
  const scrollEditorHandlerThrottle = useMemo(() => throttle(25, scrollEditorHandler), [scrollEditorHandler]);
  const scrollPreviewHandlerThrottle = useMemo(() => throttle(25, scrollPreviewHandler), [scrollPreviewHandler]);

  const revisionBody = currentPage?.revision?.body;

  if (rendererOptions == null || isLatestRevision) {
    return <></>;
  }

  return (
    <div id="page-editor" className={`flex-expand-vert ${visibility ? '' : 'd-none'}`}>
      <EditorNavbar />

      <div className="flex-expand-horiz">
        <div className="page-editor-editor-container flex-expand-vert border-end">
          <CodeMirrorEditorReadOnly
            markdown={revisionBody}
            onScroll={scrollEditorHandlerThrottle}
          />
        </div>
        <div
          ref={previewRef}
          onScroll={scrollPreviewHandlerThrottle}
          className="page-editor-preview-container flex-expand-vert overflow-y-auto d-none d-lg-flex"
        >
          <Preview
            markdown={revisionBody}
            pagePath={currentPage?.path}
            rendererOptions={rendererOptions}
            expandContentWidth={shouldExpandContent}
          />
        </div>
      </div>
    </div>
  );
});
