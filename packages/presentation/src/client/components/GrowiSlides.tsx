import Head from 'next/head';
import type { JSX } from 'react';
import ReactMarkdown from 'react-markdown';

import type { PresentationOptions } from '../consts';
import {
  MARP_CONTAINER_CLASS_NAME,
  presentationMarpit,
  slideMarpit,
} from '../services/growi-marpit';
import * as extractSections from '../services/renderer/extract-sections';

import {
  PresentationRichSlideSection,
  RichSlideSection,
} from './RichSlideSection';

type Props = {
  options: PresentationOptions;
  children?: string;
  presentation?: boolean;
};

export const GrowiSlides = (props: Props): JSX.Element => {
  const { options, children, presentation } = props;
  const { rendererOptions, isDarkMode, disableSeparationByHeader } = options;

  if (
    rendererOptions == null ||
    rendererOptions.remarkPlugins == null ||
    rendererOptions.components == null
  ) {
    return;
  }

  rendererOptions.remarkPlugins.push([
    extractSections.remarkPlugin,
    {
      isDarkMode,
      disableSeparationByHeader,
    },
  ]);
  rendererOptions.components.section = presentation
    ? PresentationRichSlideSection
    : RichSlideSection;

  const marpit = presentation ? presentationMarpit : slideMarpit;
  const { css } = marpit.render('');
  return (
    <>
      <Head>
        <style>{css}</style>
      </Head>
      <div className={`slides ${MARP_CONTAINER_CLASS_NAME}`}>
        <ReactMarkdown {...rendererOptions}>
          {children ?? '## No Contents'}
        </ReactMarkdown>
      </div>
    </>
  );
};
