import { type JSX, useMemo } from 'react';
import Head from 'next/head';
import ReactMarkdown from 'react-markdown';
import type { PluggableList } from 'unified';

import {
  MARP_CONTAINER_CLASS_NAME,
  type PresentationOptions,
} from '../consts/index.js';
import {
  PRESENTATION_MARPIT_CSS,
  SLIDE_MARPIT_CSS,
} from '../consts/marpit-base-css.vendor-styles.prebuilt.js';
import * as extractSections from '../services/renderer/extract-sections.js';
import {
  PresentationRichSlideSection,
  RichSlideSection,
} from './RichSlideSection.js';

type Props = {
  options: PresentationOptions;
  children?: string;
  presentation?: boolean;
};

export const GrowiSlides = (props: Props): JSX.Element => {
  const { options, children, presentation } = props;
  const { rendererOptions, isDarkMode, disableSeparationByHeader } = options;

  // Derive a new options object instead of mutating `rendererOptions`:
  // it is a shared SWR cache reference also consumed by PagePresentationModal,
  // so mutation here would leak into other components and accumulate on re-render.
  const slideRendererOptions = useMemo(() => {
    if (
      rendererOptions == null ||
      rendererOptions.remarkPlugins == null ||
      rendererOptions.components == null
    ) {
      return null;
    }
    const remarkPlugins: PluggableList = [
      ...rendererOptions.remarkPlugins,
      [extractSections.remarkPlugin, { isDarkMode, disableSeparationByHeader }],
    ];
    return {
      ...rendererOptions,
      remarkPlugins,
      components: {
        ...rendererOptions.components,
        section: presentation ? PresentationRichSlideSection : RichSlideSection,
      },
    };
  }, [rendererOptions, isDarkMode, disableSeparationByHeader, presentation]);

  if (slideRendererOptions == null) {
    // biome-ignore lint/complexity/noUselessFragments: early return when rendererOptions is null
    return <></>;
  }

  const css = presentation ? PRESENTATION_MARPIT_CSS : SLIDE_MARPIT_CSS;
  return (
    <>
      <Head>
        <style>{css}</style>
      </Head>
      <div className={`slides ${MARP_CONTAINER_CLASS_NAME}`}>
        <ReactMarkdown {...slideRendererOptions}>
          {children ?? '## No Contents'}
        </ReactMarkdown>
      </div>
    </>
  );
};
