import type { JSX } from 'react';
import {
  type SlidesProps,
  Slides as SlidesSubstance,
} from '@growi/presentation/dist/client';

import './Presentation.vendor-styles.prebuilt';

export const Slides = (props: SlidesProps): JSX.Element => {
  return <SlidesSubstance {...props} />;
};
