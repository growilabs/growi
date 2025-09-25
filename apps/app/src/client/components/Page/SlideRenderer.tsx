import type { JSX } from 'react';

import type { Options as ReactMarkdownOptions } from 'react-markdown';

import { usePresentationViewOptions } from '~/stores/renderer';

import { Slides } from '../Presentation/Slides';


type SlideRendererProps = {
  markdown: string,
  marp?: boolean,
};

export const SlideRenderer = (props: SlideRendererProps): JSX.Element => {

  const { markdown, marp = false } = props;

  const { data: rendererOptions } = usePresentationViewOptions();

  return (
    <Slides
      hasMarpFlag={marp}
      options={{ rendererOptions: rendererOptions as ReactMarkdownOptions }}
    >
      {markdown}
    </Slides>
  );
};
