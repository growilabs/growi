// next/link runtime self-patches `module.exports` to the Link component.

import type { LinkProps as OrigLinkProps } from 'next/dist/client/link.js';
import OrigLink from 'next/dist/client/link.js';

declare const Link: typeof OrigLink;
declare namespace Link {
  type LinkProps<RouteInferType = any> = OrigLinkProps<RouteInferType>;
}
export = Link;
