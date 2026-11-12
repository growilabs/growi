import React, { type JSX, useCallback, useRef, useState } from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { useTranslation } from 'next-i18next';

import loggerFactory from '~/utils/logger';

import { PLANTUML_GET_URL_LIKELY_TOO_LONG } from '../interfaces/http-method';

const logger = loggerFactory('growi:features:plantuml:PlantUmlViewer');

type PlantUmlErrorReason = 'url-too-long' | 'render-failed';

// Literal keys so the i18n audit can see they are used.
const ERROR_MESSAGE_KEYS = {
  'url-too-long': 'plantuml.url-too-long',
  'render-failed': 'plantuml.render-failed',
} as const satisfies Record<PlantUmlErrorReason, string>;

// Keyed by src so a new src on the same instance (e.g. editor preview) is tried again.
type Failure = {
  src: string;
  reason: PlantUmlErrorReason;
};

type PlantUmlViewerProps = {
  src: string;
};

export const PlantUmlViewer = React.memo(
  ({ src }: PlantUmlViewerProps): JSX.Element => {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const [failure, setFailure] = useState<Failure | null>(null);

    const markRendered = useCallback(() => {
      containerRef.current?.setAttribute(
        GROWI_IS_CONTENT_RENDERING_ATTR,
        'false',
      );
    }, []);

    const handleError = useCallback(() => {
      // Length only picks the message (see design.md "GET の失敗は onError で検知する").
      const reason: PlantUmlErrorReason =
        src.length >= PLANTUML_GET_URL_LIKELY_TOO_LONG
          ? 'url-too-long'
          : 'render-failed';
      logger.warn(
        { reason, method: 'get', urlLength: src.length },
        'Failed to render PlantUML diagram',
      );
      setFailure({ src, reason });
      markRendered();
    }, [src, markRendered]);

    const errorReason = failure?.src === src ? failure.reason : null;

    return (
      <div
        ref={containerRef}
        {...{ [GROWI_IS_CONTENT_RENDERING_ATTR]: 'true' }}
      >
        {errorReason != null ? (
          <div className="text-danger">
            {t(ERROR_MESSAGE_KEYS[errorReason])}
          </div>
        ) : (
          // biome-ignore lint/a11y/useAltText: PlantUML diagrams are purely visual
          <img src={src} onLoad={markRendered} onError={handleError} />
        )}
      </div>
    );
  },
);

PlantUmlViewer.displayName = 'PlantUmlViewer';
