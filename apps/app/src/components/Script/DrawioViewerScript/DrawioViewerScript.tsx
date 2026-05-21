import { type JSX, useCallback } from 'react';
import Script from 'next/script';
import type { IGraphViewerGlobal } from '@growi/remark-drawio';

import { generateViewerMinJsUrl } from './use-viewer-min-js-url';

declare global {
  var GraphViewer: IGraphViewerGlobal;
  var mxStencilRegistry: { libraries: Record<string, string[]> } | undefined;
}

type Props = {
  drawioUri: string;
};

// viewer-static.min.js defaults all resource paths to viewer.diagrams.net.
// For local draw.io instances the default is unreachable, so we replace those
// URLs in mxStencilRegistry.libraries (which are fetched lazily on first use)
// with paths on the configured local origin before any diagram is rendered.
// refs: https://github.com/growilabs/growi/issues/10726
const DEFAULT_DRAWIO_ORIGIN = 'https://embed.diagrams.net';
const VIEWER_DIAGRAMS_NET_ORIGIN = 'https://viewer.diagrams.net';

const patchStencilRegistryUrls = (localOrigin: string): void => {
  const libs = mxStencilRegistry?.libraries;
  if (libs == null) return;
  for (const key of Object.keys(libs)) {
    libs[key] = libs[key].map((url) =>
      typeof url === 'string'
        ? url.replace(VIEWER_DIAGRAMS_NET_ORIGIN, localOrigin)
        : url,
    );
  }
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

    try {
      const origin = new URL(drawioUri).origin;
      if (origin !== DEFAULT_DRAWIO_ORIGIN) {
        patchStencilRegistryUrls(origin);
      }
    } catch {
      // skip patching if drawioUri cannot be parsed
    }

    GraphViewer.processElements();
  }, [drawioUri]);

  // Return empty element if drawioUri is not provided to avoid Invalid URL error
  if (!drawioUri) {
    return <></>;
  }

  const viewerMinJsSrc = generateViewerMinJsUrl(drawioUri);

  return (
    <Script
      src={viewerMinJsSrc}
      strategy="afterInteractive"
      onLoad={loadedHandler}
    />
  );
};
