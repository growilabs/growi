import { type JSX, lazy, Suspense } from 'react';

import type { PresentationOptions } from '../consts';
import { GrowiSlides } from './GrowiSlides';

import styles from './Slides.module.scss';

const MarpSlides = lazy(() =>
  import('./MarpSlides').then((mod) => ({ default: mod.MarpSlides })),
);

export type SlidesProps = {
  options: PresentationOptions;
  children?: string;
  hasMarpFlag?: boolean;
  presentation?: boolean;
};

export const Slides = (props: SlidesProps): JSX.Element => {
  const { options, children, hasMarpFlag, presentation } = props;

  return (
    <div className={`${styles['slides-styles']}`}>
      {hasMarpFlag ? (
        <Suspense fallback={<div>Loading...</div>}>
          <MarpSlides presentation={presentation}>{children}</MarpSlides>
        </Suspense>
      ) : (
        <GrowiSlides options={options} presentation={presentation}>
          {children}
        </GrowiSlides>
      )}
    </div>
  );
};
