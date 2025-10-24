// eslint-disable-next-line camelcase
import type { Experimental_GeneratedImage } from 'ai';

import { cn } from '~/lib/utils';

// eslint-disable-next-line camelcase
export type ImageProps = Experimental_GeneratedImage & {
  className?: string;
  alt?: string;
};

export const Image = ({
  base64,
  uint8Array,
  mediaType,
  ...props
}: ImageProps) => (
  <img
    {...props}
    alt={props.alt}
    className={cn(
      'tw:h-auto tw:max-w-full tw:overflow-hidden tw:rounded-md',
      props.className,
    )}
    src={`data:${mediaType};base64,${base64}`}
  />
);
