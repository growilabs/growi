import type React from 'react';
import type { LinkProps } from 'next/link';

import { NextLink } from '~/components/ReactMarkdownComponents/NextLink.js';

export const NextLinkWrapper = (
  props: LinkProps & { children: React.ReactNode; href: string },
): JSX.Element => {
  return (
    <NextLink href={props.href} className="link-primary">
      {props.children}
    </NextLink>
  );
};
