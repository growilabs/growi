import type {
  ComponentType,
  DetailedHTMLProps,
  ImgHTMLAttributes,
  JSX,
} from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = DetailedHTMLProps<
  ImgHTMLAttributes<HTMLImageElement>,
  HTMLImageElement
>;

type FsLightboxProps = {
  toggler: boolean;
  sources: (string | undefined)[];
  alt: string | undefined;
  type: string;
  exitFullscreenOnClose: boolean;
};

export const LightBox = (props: Props): JSX.Element => {
  const [toggler, setToggler] = useState(false);
  // Dynamically import fslightbox-react so it stays out of the SSR bundle
  const [FsLightbox, setFsLightbox] =
    useState<ComponentType<FsLightboxProps> | null>(null);
  const { alt, ...rest } = props;

  useEffect(() => {
    import('fslightbox-react').then((m) => setFsLightbox(() => m.default));
  }, []);

  return (
    <>
      <button
        type="button"
        className="border-0 bg-transparent p-0"
        aria-label={alt ?? 'Open image'}
        onClick={() => setToggler((prev) => !prev)}
      >
        <img alt={alt} {...rest} />
      </button>

      {FsLightbox != null &&
        createPortal(
          <FsLightbox
            toggler={toggler}
            sources={[props.src]}
            alt={alt}
            type="image"
            exitFullscreenOnClose
          />,
          document.body,
        )}
    </>
  );
};
