import type { AnchorHTMLAttributes, JSX } from 'react';
import type { LinkProps } from 'next/link';
import Link from 'next/link';
import { pagePathUtils } from '@growi/core/dist/utils';

import { useSiteUrl } from '~/states/global';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:components:NextLink');

const hasAnchorLink = (href: string): boolean => {
  return href.toString().length > 0 && href[0] === '#';
};

const isExternalLink = (href: string, siteUrl: string | undefined): boolean => {
  try {
    const baseUrl = new URL(siteUrl ?? 'https://example.com');
    const hrefUrl = new URL(href, baseUrl);
    return baseUrl.host !== hrefUrl.host;
  } catch (err) {
    logger.debug(err);
    return false;
  }
};

const isCreatablePage = (href: string) => {
  try {
    const url = new URL(href, 'http://example.com');
    const pathName = url.pathname;
    return pagePathUtils.isCreatablePage(pathName);
  } catch (err) {
    logger.debug(err);
    return false;
  }
};

type Props = AnchorHTMLAttributes<HTMLAnchorElement> &
  Omit<LinkProps, 'href'> & {
    children: React.ReactNode;
    id?: string;
    href?: string;
    className?: string;
  };

export const NextLink = (props: Props): JSX.Element => {
  const { id, href, children, className, target, onClick, ...rest } = props;

  const siteUrl = useSiteUrl();

  if (href == null) {
    // biome-ignore lint/a11y/useValidAnchor: ignore
    return <a className={className}>{children}</a>;
  }

  // extract 'data-*' props
  const dataAttributes = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key.startsWith('data-')),
  );

  if (isExternalLink(href, siteUrl) || target === '_blank') {
    return (
      <a
        id={id}
        href={href}
        className={className}
        target="_blank"
        onClick={onClick}
        rel="noopener noreferrer"
        {...dataAttributes}
      >
        {children}
        {target === '_blank' && (
          <span style={{ userSelect: 'none' }}>
            &nbsp;
            <span className="growi-custom-icons">external_link</span>
          </span>
        )}
      </a>
    );
  }

  // when href is an anchor link or not-creatable path
  if (hasAnchorLink(href) || !isCreatablePage(href) || target != null) {
    return (
      <a
        id={id}
        href={href}
        className={className}
        target={target}
        onClick={onClick}
        {...dataAttributes}
      >
        {children}
      </a>
    );
  }

  return (
    <Link {...rest} href={href} prefetch={false} legacyBehavior>
      <a
        href={href}
        className={className}
        {...dataAttributes}
        onClick={onClick}
      >
        {children}
      </a>
    </Link>
  );
};
