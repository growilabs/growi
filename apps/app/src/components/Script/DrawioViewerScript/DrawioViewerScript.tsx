import { useCallback, type JSX } from 'react';

import type { IGraphViewerGlobal } from '@growi/remark-drawio';
import Head from 'next/head';

import { useViewerMinJsUrl } from './use-viewer-min-js-url';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var GraphViewer: IGraphViewerGlobal;
}

type Props = {
  drawioUri: string;
}

export const DrawioViewerScript = ({ drawioUri }: Props): JSX.Element => {
  const viewerMinJsSrc = useViewerMinJsUrl(drawioUri);

  const loadedHandler = useCallback(() => {
    // disable useResizeSensor and checkVisibleState
    //   for preventing resize event by viewer-static.min.js
    GraphViewer.useResizeSensor = false;
    GraphViewer.prototype.checkVisibleState = false;

    // Set responsive option.
    // refs: https://github.com/jgraph/drawio/blob/v13.9.1/src/main/webapp/js/diagramly/GraphViewer.js#L89-L95
    // GraphViewer.prototype.responsive = true;

    // Set z-index ($zindex-dropdown + 200) for lightbox.
    // 'lightbox' is like a modal dialog that appears when click on a drawio diagram.
    // z-index refs: https://github.com/twbs/bootstrap/blob/v4.6.2/scss/_variables.scss#L681
    GraphViewer.prototype.lightboxZIndex = 1200;
    GraphViewer.prototype.toolbarZIndex = 1200;

    GraphViewer.processElements();
  }, []);

  return (
    <Head>
      <script
        type="text/javascript"
        async
        src={viewerMinJsSrc}
        onLoad={loadedHandler}
      />
    </Head>
  );
};
