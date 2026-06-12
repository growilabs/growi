import type { JSX } from 'react';

import { usePresentationViewOptions } from '~/stores/renderer.js';

import { Slides } from '../Presentation/Slides.js';

type SlideRendererProps = {
  markdown: string;
  marp?: boolean;
};

export const SlideRenderer = (props: SlideRendererProps): JSX.Element => {
  const { markdown, marp = false } = props;

  const { data: rendererOptions } = usePresentationViewOptions();

  return (
    <Slides hasMarpFlag={marp} options={{ rendererOptions }}>
      {markdown}
    </Slides>
  );
};
