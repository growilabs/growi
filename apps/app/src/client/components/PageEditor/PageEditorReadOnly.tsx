import react, { type JSX, useMemo, useRef } from 'react';
import { GlobalCodeMirrorEditorKey } from '@growi/editor';
import { CodeMirrorEditorReadOnly } from '@growi/editor/dist/client/components/CodeMirrorEditorReadOnly.js';
import { throttle } from 'throttle-debounce';

import { useShouldExpandContent } from '~/services/layout/use-should-expand-content.js';
import { useCurrentPageData } from '~/states/page/index.js';
import { useSWRxIsLatestRevision } from '~/stores/page.js';
import { usePreviewOptions } from '~/stores/renderer.js';

import { EditorNavbar } from './EditorNavbar/index.js';
import Preview from './Preview.js';
import { useScrollSync } from './ScrollSyncHelper.js';

type Props = {
  visibility?: boolean;
};

export const PageEditorReadOnly = react.memo(
  ({ visibility }: Props): JSX.Element => {
    const previewRef = useRef<HTMLDivElement>(null);

    const currentPage = useCurrentPageData();
    const { data: rendererOptions } = usePreviewOptions();
    const { data: isLatestRevision } = useSWRxIsLatestRevision();
    const shouldExpandContent = useShouldExpandContent(currentPage);

    const { scrollEditorHandler, scrollPreviewHandler } = useScrollSync(
      GlobalCodeMirrorEditorKey.READONLY,
      previewRef,
    );
    const scrollEditorHandlerThrottle = useMemo(
      () => throttle(25, scrollEditorHandler),
      [scrollEditorHandler],
    );
    const scrollPreviewHandlerThrottle = useMemo(
      () => throttle(25, scrollPreviewHandler),
      [scrollPreviewHandler],
    );

    const revisionBody = currentPage?.revision?.body;

    // Show read-only editor only when viewing an old revision
    if (rendererOptions == null || isLatestRevision !== false) {
      return <></>;
    }

    return (
      <div
        id="page-editor"
        className={`flex-expand-vert ${visibility ? '' : 'd-none'}`}
      >
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
  },
);
