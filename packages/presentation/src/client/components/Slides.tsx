import type { JSX } from 'react';

import type { PresentationOptions } from '../consts';
import { GrowiSlides } from './GrowiSlides';
import { MarpSlides } from './MarpSlides';

import styles from './Slides.module.scss';

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
        <MarpSlides presentation={presentation}>{children}</MarpSlides>
      ) : (
        <GrowiSlides options={options} presentation={presentation}>
          {children}
        </GrowiSlides>
      )}
    </div>
  );
};
