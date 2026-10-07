import React, { type JSX, useCallback, useRef } from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';

type PlantUmlViewerProps = {
  src: string;
};

export const PlantUmlViewer = React.memo(
  ({ src }: PlantUmlViewerProps): JSX.Element => {
    const containerRef = useRef<HTMLDivElement>(null);

    const handleLoaded = useCallback(() => {
      containerRef.current?.setAttribute(
        GROWI_IS_CONTENT_RENDERING_ATTR,
        'false',
      );
    }, []);

    return (
      <div
        ref={containerRef}
        {...{ [GROWI_IS_CONTENT_RENDERING_ATTR]: 'true' }}
      >
        {/* biome-ignore lint/a11y/useAltText: PlantUML diagrams are purely visual */}
        <img src={src} onLoad={handleLoaded} onError={handleLoaded} />
      </div>
    );
  },
);

PlantUmlViewer.displayName = 'PlantUmlViewer';
