import type { ReactNode } from 'react';
import { render } from '@testing-library/react';

import { NextLink } from './NextLink';

// next/link reaches for the Pages-Router context, which is absent under test.
// Render a marked anchor instead: whether a link goes through next/link is
// exactly the contract under test (client-side transition vs. browser reload).
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    ...props
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
  }) => (
    <a data-testid="next-link" href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('~/states/global', () => ({
  useSiteUrl: () => 'https://wiki.example.com',
}));

const renderLink = (href: string) => {
  const { container } = render(<NextLink href={href}>link text</NextLink>);
  const anchor = container.querySelector('a');
  return {
    /** true when the link performs a client-side transition */
    isClientSideTransition: anchor?.dataset.testid === 'next-link',
    anchor,
  };
};

describe('NextLink', () => {
  describe('links that must transition client-side', () => {
    it.each`
      href                                                    | pathDescription
      ${'/Sandbox/Bootstrap5'}                                | ${'ASCII page path'}
      ${'/Sandbox/%E6%97%A5%E6%9C%AC%E8%AA%9E'}               | ${'percent-encoded non-ASCII page path'}
      ${'/Sandbox/%E3%83%9A%E3%83%BC%E3%82%B8%20%E5%90%8D'}   | ${'percent-encoded path containing a space'}
      ${'/Sandbox/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=foo#heading'} | ${'percent-encoded path with query and hash'}
      ${'/Sandbox/日本語'}                                    | ${'non-ASCII page path written literally'}
    `('routes $pathDescription through next/link', ({ href }) => {
      expect(renderLink(href).isClientSideTransition).toBe(true);
    });
  });

  describe('links that must NOT transition client-side', () => {
    it.each`
      href                                   | reason
      ${'#heading'}                          | ${'in-page anchor'}
      ${'/attachment/653a1f1b'}              | ${'path served outside the page router'}
      ${'/user/admin'}                       | ${'user homepage root'}
      ${'/Sandbox/Bootstrap5/edit'}          | ${'path reserved by the editor'}
      ${'/Sandbox/Bootstrap5.md'}            | ${'path reserved for the markdown endpoint'}
      ${'/%E6%97%A5%E6%9C%AC%E8%AA%9E.md'}   | ${'reserved suffix hidden behind percent-encoding'}
      ${'/user/%E6%97%A5%E6%9C%AC%E8%AA%9E'} | ${'user homepage root hidden behind percent-encoding'}
      ${'/Sandbox/broken%ZZ'}                | ${'malformed percent-encoding'}
      ${'/Sandbox/50%25off'}                 | ${'literal percent sign in the path'}
    `('keeps $reason on a plain anchor', ({ href }) => {
      const { isClientSideTransition, anchor } = renderLink(href);
      expect(isClientSideTransition).toBe(false);
      expect(anchor?.getAttribute('href')).toBe(href);
    });
  });

  describe('external links', () => {
    it('opens a link to another host in a new tab', () => {
      const { isClientSideTransition, anchor } = renderLink(
        'https://example.com/foo',
      );
      expect(isClientSideTransition).toBe(false);
      expect(anchor?.getAttribute('target')).toBe('_blank');
      expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    });
  });
});
