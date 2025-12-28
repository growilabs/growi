import type React from 'react';
import type { DetailedHTMLProps, ImgHTMLAttributes, JSX } from 'react';
import { useMemo, useState } from 'react';
import FsLightbox from 'fslightbox-react';
import { createPortal } from 'react-dom';

type Props = DetailedHTMLProps<
  ImgHTMLAttributes<HTMLImageElement>,
  HTMLImageElement
>;

export const LightBox = (props: Props): JSX.Element => {
  const [toggler, setToggler] = useState(false);
  const { alt, onClick: onImageClick, ...rest } = props;

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
      <button
        type="button"
        className="border-0 bg-transparent p-0"
        aria-label={alt ?? 'Open image'}
        onClick={(event) => {
          onImageClick?.(
            event as unknown as React.MouseEvent<HTMLImageElement>,
          );
          setToggler((prev) => !prev);
        }}
      >
        <img alt={alt} {...rest} />
      </button>

      {lightboxPortal}
    </>
  );
};
