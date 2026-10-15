import React, { type JSX, useEffect, useRef } from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';

import { useNextThemes } from '~/stores-universal/use-next-themes';
import loggerFactory from '~/utils/logger';

import { scheduleMermaidRender } from '../client/services';

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
      const cancel = scheduleMermaidRender({
        source: value,
        isDarkMode,
        container,
        onRendered: () => {
          if (!current) return;
          // Let the browser compute SVG layout before the auto-scroll notification.
          rafId = requestAnimationFrame(() => {
            if (current) {
              container.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
            }
          });
        },
        onError: (error) => {
          if (!current) return;
          logger.error(error);
          container.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
        },
      });

      return () => {
        current = false;
        cancel();
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
