import mermaid from 'mermaid';
import React, { type JSX, useEffect, useRef } from 'react';
import { v7 as uuidV7 } from 'uuid';

import { useNextThemes } from '~/stores-universal/use-next-themes';
import loggerFactory from '~/utils/logger';

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
      (async () => {
        if (ref.current != null && value != null) {
          mermaid.initialize({
            theme: isDarkMode ? 'dark' : undefined,
          });
          try {
            // Attempting to render multiple Mermaid diagrams using `mermaid.run` can cause duplicate SVG IDs.
            // This is because it uses `Date.now()` for ID generation.
            // ID generation logic: https://github.com/mermaid-js/mermaid/blob/5b241bbb97f81d37df8a84da523dfa53ac13bfd1/packages/mermaid/src/utils.ts#L755-L764
            // Related issue: https://github.com/mermaid-js/mermaid/issues/4650
            // Instead of `mermaid.run`, we use `mermaid.render` which allows us to assign a unique ID.
            const id = `mermaid-${uuidV7()}`;
            const { svg } = await mermaid.render(id, value, ref.current);
            ref.current.innerHTML = svg;
          } catch (err) {
            logger.error(err);
          }
        }
      })();
    }, [isDarkMode, value]);

    return value ? (
      <div ref={ref} key={value}>
        {value}
      </div>
    ) : (
      <div key={value}></div>
    );
  },
);

MermaidViewer.displayName = 'MermaidViewer';
