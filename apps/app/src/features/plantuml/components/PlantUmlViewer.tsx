import React, {
  type JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { useTranslation } from 'next-i18next';

import type { RendererConfig } from '~/interfaces/services/renderer';
import { useRendererConfig } from '~/states/server-configurations';
import loggerFactory from '~/utils/logger';

import {
  fetchPlantumlSvg,
  type PlantumlSvgResult,
} from '../client/services/fetch-plantuml-svg';
import { PLANTUML_GET_URL_LIKELY_TOO_LONG } from '../interfaces/http-method';

const logger = loggerFactory('growi:features:plantuml:PlantUmlViewer');

type PlantUmlErrorReason =
  | 'url-too-long'
  | Extract<PlantumlSvgResult, { ok: false }>['reason'];

// Literal keys so the i18n audit can see they are used.
const ERROR_MESSAGE_KEYS = {
  'url-too-long': 'plantuml.url-too-long',
  'post-unavailable': 'plantuml.post-unavailable',
  'render-failed': 'plantuml.render-failed',
} as const satisfies Record<PlantUmlErrorReason, string>;

const WARN_MESSAGE = 'Failed to render PlantUML diagram';

type DiagramProps = {
  onSettled: () => void;
};

const DiagramError = ({
  reason,
}: {
  reason: PlantUmlErrorReason;
}): JSX.Element => {
  const { t } = useTranslation();
  return <div className="text-danger">{t(ERROR_MESSAGE_KEYS[reason])}</div>;
};

// Keyed by src so a new src on the same instance (e.g. editor preview) is tried again.
type GetFailure = {
  src: string;
  reason: PlantUmlErrorReason;
};

const GetDiagram = ({
  src,
  onSettled,
}: DiagramProps & { src: string }): JSX.Element => {
  const [failure, setFailure] = useState<GetFailure | null>(null);

  const handleError = useCallback(() => {
    // Length only picks the message (see design.md "GET の失敗は onError で検知する").
    const reason: PlantUmlErrorReason =
      src.length >= PLANTUML_GET_URL_LIKELY_TOO_LONG
        ? 'url-too-long'
        : 'render-failed';
    logger.warn({ reason, method: 'get', urlLength: src.length }, WARN_MESSAGE);
    setFailure({ src, reason });
    onSettled();
  }, [src, onSettled]);

  if (failure?.src === src) {
    return <DiagramError reason={failure.reason} />;
  }
  // biome-ignore lint/a11y/useAltText: PlantUML diagrams are purely visual
  return <img src={src} onLoad={onSettled} onError={handleError} />;
};

type PostOutcome = { dataUrl: string } | { reason: PlantUmlErrorReason };

// The last outcome that arrived, with the request it belongs to.
type SettledPost = {
  plantumlUri: string;
  source: string;
  outcome: PostOutcome;
};

const usePostOutcome = (
  plantumlUri: string,
  source: string,
  onSettled: () => void,
): PostOutcome | null => {
  const [settled, setSettled] = useState<SettledPost | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchPlantumlSvg(plantumlUri, source).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setSettled({
          plantumlUri,
          source,
          outcome: { dataUrl: result.dataUrl },
        });
        return;
      }
      const { reason, status } = result;
      logger.warn(
        { reason, method: 'post', sourceLength: source.length, status },
        WARN_MESSAGE,
      );
      setSettled({ plantumlUri, source, outcome: { reason } });
      // No <img> is created, so onLoad/onError will never settle the status.
      onSettled();
    });

    return () => {
      cancelled = true;
    };
  }, [plantumlUri, source, onSettled]);

  if (settled == null) {
    return null;
  }
  if (settled.plantumlUri === plantumlUri && settled.source === source) {
    return settled.outcome;
  }
  // While a new source loads, keep the previous diagram on screen like GET's
  // <img> does, but never a fetch failure that belongs to another source.
  return 'dataUrl' in settled.outcome ? settled.outcome : null;
};

const PostDiagram = ({
  plantumlUri,
  source,
  onSettled,
}: DiagramProps & {
  plantumlUri: string;
  source: string;
}): JSX.Element | null => {
  const outcome = usePostOutcome(plantumlUri, source, onSettled);
  const [failedDataUrl, setFailedDataUrl] = useState<string | null>(null);

  if (outcome == null) {
    return null;
  }
  if ('reason' in outcome) {
    return <DiagramError reason={outcome.reason} />;
  }
  const { dataUrl } = outcome;
  if (failedDataUrl === dataUrl) {
    return <DiagramError reason="render-failed" />;
  }

  const handleError = () => {
    logger.warn(
      { reason: 'render-failed', method: 'post', sourceLength: source.length },
      WARN_MESSAGE,
    );
    setFailedDataUrl(dataUrl);
    onSettled();
  };

  // biome-ignore lint/a11y/useAltText: PlantUML diagrams are purely visual
  return <img src={dataUrl} onLoad={onSettled} onError={handleError} />;
};

type PlantUmlViewerProps = {
  src?: string;
  source?: string;
};

type DiagramSelection = PlantUmlViewerProps &
  Pick<RendererConfig, 'plantumlUri' | 'plantumlHttpMethod'>;

// Method and destination come only from the renderer config, never from the
// element: page authors can hand-write its attributes (design.md "PlantUmlViewer — 変更").
const selectDiagram = (
  { src, source, plantumlUri, plantumlHttpMethod }: DiagramSelection,
  onSettled: () => void,
): JSX.Element | null => {
  if (plantumlHttpMethod === 'post' && plantumlUri !== '' && source != null) {
    return (
      <PostDiagram
        plantumlUri={plantumlUri}
        source={source}
        onSettled={onSettled}
      />
    );
  }
  if (src != null) {
    return <GetDiagram src={src} onSettled={onSettled} />;
  }
  return null;
};

export const PlantUmlViewer = React.memo(
  ({ src, source }: PlantUmlViewerProps): JSX.Element | null => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { plantumlUri, plantumlHttpMethod } = useRendererConfig();

    const markRendered = useCallback(() => {
      containerRef.current?.setAttribute(
        GROWI_IS_CONTENT_RENDERING_ATTR,
        'false',
      );
    }, []);

    const diagram = selectDiagram(
      { src, source, plantumlUri, plantumlHttpMethod },
      markRendered,
    );
    if (diagram == null) {
      return null;
    }

    return (
      <div
        ref={containerRef}
        {...{ [GROWI_IS_CONTENT_RENDERING_ATTR]: 'true' }}
      >
        {diagram}
      </div>
    );
  },
);

PlantUmlViewer.displayName = 'PlantUmlViewer';
