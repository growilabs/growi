import type { JSX } from 'react';

import { Slides as SlidesSubstance, type SlidesProps } from '@growi/presentation/dist/client';

import '@growi/presentation/dist/style.css';

export const Slides = (props: SlidesProps): JSX.Element => {
  return <SlidesSubstance {...props} />;
};
