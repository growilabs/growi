import type { DetailedHTMLProps, ImgHTMLAttributes, JSX } from 'react';
import React, { useMemo, useState } from 'react';

import FsLightbox from 'fslightbox-react';
import { createPortal } from 'react-dom';

type Props = DetailedHTMLProps<ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement>

export const LightBox = (props: Props): JSX.Element => {
  const [toggler, setToggler] = useState(false);
  const { alt, ...rest } = props;

  const lightboxPortal = useMemo(() => {
    return createPortal(
      <FsLightbox
        toggler={toggler}
        sources={[props.src]}
        alt={alt}
        type="image"
        exitFullscreenOnClose
      />,
      document.body,
    );
  }, [alt, props.src, toggler]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={alt} {...rest} onClick={() => setToggler(!toggler)} />

      {lightboxPortal}
    </>
  );
};
