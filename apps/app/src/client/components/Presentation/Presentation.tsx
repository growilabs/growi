import type { JSX } from 'react';
import {
  type PresentationProps,
  Presentation as PresentationSubstance,
} from '@growi/presentation/dist/client';

import './Presentation.vendor-styles.prebuilt.js';

export const Presentation = (props: PresentationProps): JSX.Element => {
  return <PresentationSubstance {...props} />;
};
