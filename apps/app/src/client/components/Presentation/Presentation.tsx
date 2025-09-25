import type { JSX } from 'react';

import { Presentation as PresentationSubstance, type PresentationProps } from '@growi/presentation/dist/client';

import '@growi/presentation/dist/style.css';

export const Presentation = (props: PresentationProps): JSX.Element => {
  return <PresentationSubstance {...props} />;
};
