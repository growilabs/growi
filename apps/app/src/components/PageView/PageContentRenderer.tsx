import type { JSX } from 'react';

import type { RendererOptions } from '~/interfaces/renderer-options';
import type { RendererConfig } from '~/interfaces/services/renderer';
import { generateSSRViewOptions } from '~/services/renderer/renderer';

import RevisionRenderer from './RevisionRenderer';

type Props = {
  rendererOptions?: RendererOptions;
  rendererConfig: RendererConfig;
  pagePath: string;
  markdown: string | null;
};

export const PageContentRenderer = ({
  rendererOptions,
  rendererConfig,
  pagePath,
  markdown,
}: Props): JSX.Element | null => {
  if (markdown == null) {
    return null;
  }

  const options =
    rendererOptions ?? generateSSRViewOptions(rendererConfig, pagePath);

  return <RevisionRenderer rendererOptions={options} markdown={markdown} />;
};
