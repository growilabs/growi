import React, { type JSX } from 'react';

import type { Props } from './RefsImg';
import { RefsImgSubstance } from './RefsImg';

const gridDefault = 'col-4';
const gridGapDefault = '1px';

export const Gallery = React.memo((props: Props): JSX.Element => {
  const grid = props.grid || gridDefault;
  const gridGap = props.gridGap || gridGapDefault;
  return <RefsImgSubstance grid={grid} gridGap={gridGap} {...props} />;
});

export const GalleryImmutable = React.memo(
  (props: Omit<Props, 'isImmutable'>): JSX.Element => {
    const grid = props.grid || gridDefault;
    const gridGap = props.gridGap || gridGapDefault;
    return (
      <RefsImgSubstance grid={grid} gridGap={gridGap} {...props} isImmutable />
    );
  },
);

Gallery.displayName = 'Gallery';
