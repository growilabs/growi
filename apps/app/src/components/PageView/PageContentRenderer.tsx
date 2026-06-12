import type { JSX } from 'react';

import type { RendererOptions } from '~/interfaces/renderer-options.js';
import type { RendererConfig } from '~/interfaces/services/renderer.js';
import { generateSSRViewOptions } from '~/services/renderer/renderer.js';

import RevisionRenderer from './RevisionRenderer.js';

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
