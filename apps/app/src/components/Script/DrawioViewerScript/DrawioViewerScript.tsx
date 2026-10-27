import { type JSX, useCallback } from 'react';
import Script from 'next/script';
import type { IGraphViewerGlobal } from '@growi/remark-drawio';

// biome-ignore-start lint/style/noRestrictedImports: both entry points only touch browser globals and no-op during server rendering
import {
  adoptSelfHostedDrawio,
  prepareSelfHostedDrawio,
} from '~/features/drawio/client/self-hosted';

// biome-ignore-end lint/style/noRestrictedImports: both entry points only touch browser globals and no-op during server rendering

import { generateViewerMinJsUrl } from './use-viewer-min-js-url';

declare global {
  var GraphViewer: IGraphViewerGlobal;
}

type Props = {
  drawioUri: string;
};

export const DrawioViewerScript = ({ drawioUri }: Props): JSX.Element => {
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

    // Must precede processElements(): this re-runs Editor.initMath(), which is also what
    // installs the listeners that ask for typesetting, so a diagram rendered before it
    // would never get any.
    adoptSelfHostedDrawio(drawioUri);

    GraphViewer.processElements();
  }, [drawioUri]);

  // Return empty element if drawioUri is not provided to avoid Invalid URL error
  if (!drawioUri) {
    return <></>;
  }

  // Deliberately during render rather than in an effect: the globals this writes are read
  // by viewer-static.min.js while it evaluates, and <Script> inserts it as soon as this
  // renders. Writing the same values again is harmless, so repeated renders are fine.
  prepareSelfHostedDrawio(drawioUri);

  const viewerMinJsSrc = generateViewerMinJsUrl(drawioUri);

  return (
    <Script
      src={viewerMinJsSrc}
      strategy="afterInteractive"
      onLoad={loadedHandler}
    />
  );
};
