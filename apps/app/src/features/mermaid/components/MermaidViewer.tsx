import React, { type JSX, useEffect, useRef } from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import mermaid from 'mermaid';
import { v7 as uuidV7 } from 'uuid';

import { useNextThemes } from '~/stores-universal/use-next-themes';
import loggerFactory from '~/utils/logger';

import { prepareMermaidSource } from '../client/services';

// initialize() bypasses Mermaid's render queue; configure themes per diagram.
mermaid.initialize({});

const logger = loggerFactory('growi:features:mermaid:MermaidViewer');

type MermaidViewerProps = {
  value: string;
};

export const MermaidViewer = React.memo(
  (props: MermaidViewerProps): JSX.Element => {
    const { value } = props;

    const { isDarkMode } = useNextThemes();

    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const container = ref.current;
      if (container == null || !value) return;

      let current = true;
      let rafId: number | undefined;
      container.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
      const renderDiagram = async (): Promise<void> => {
        try {
          // `mermaid.run` generates SVG IDs from `Date.now()`, so rendering multiple diagrams can produce duplicate IDs.
          // Instead, use `mermaid.render` with a unique ID.
          // ID generation logic: https://github.com/mermaid-js/mermaid/blob/5b241bbb97f81d37df8a84da523dfa53ac13bfd1/packages/mermaid/src/utils.ts#L755-L764
          // Related issue: https://github.com/mermaid-js/mermaid/issues/4650
          const { svg } = await mermaid.render(
            `mermaid-${uuidV7()}`,
            prepareMermaidSource(value, isDarkMode),
            container,
          );
          // A newer queued render can already be using this container.
          if (!current) return;
          if (!container.isConnected) {
            container.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
            return;
          }
          container.innerHTML = svg;
          // Let the browser compute SVG layout before the auto-scroll notification.
          rafId = requestAnimationFrame(() => {
            if (current) {
              container.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
            }
          });
        } catch (error) {
          if (!current) return;
          if (container.isConnected) logger.error(error);
          container.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
        }
      };
      void renderDiagram();

      return () => {
        current = false;
        if (rafId != null) {
          cancelAnimationFrame(rafId);
        }
      };
    }, [isDarkMode, value]);

    return value ? (
      <div
        ref={ref}
        key={value}
        {...{ [GROWI_IS_CONTENT_RENDERING_ATTR]: 'true' }}
      >
        {value}
      </div>
    ) : (
      <div key={value}></div>
    );
  },
);

MermaidViewer.displayName = 'MermaidViewer';
