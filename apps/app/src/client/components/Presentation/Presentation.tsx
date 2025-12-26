import type { JSX } from 'react';
import {
  type PresentationProps,
  Presentation as PresentationSubstance,
} from '@growi/presentation/dist/client';

import '@growi/presentation/dist/style.css';

export const Presentation = (props: PresentationProps): JSX.Element => {
  return <PresentationSubstance {...props} />;
};
