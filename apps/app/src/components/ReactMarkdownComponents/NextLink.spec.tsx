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

const mocks = vi.hoisted(() => ({
  siteUrl: 'https://wiki.example.com' as string | undefined,
}));

vi.mock('~/states/global', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/states/global')>()),
  useSiteUrl: () => mocks.siteUrl,
}));

beforeEach(() => {
  mocks.siteUrl = 'https://wiki.example.com';
});

const renderLink = (
  href: string,
  props: Record<string, unknown> = {},
): {
  isClientSideTransition: boolean;
  anchor: HTMLAnchorElement | null;
} => {
  const { container } = render(
    <NextLink href={href} {...props}>
      link text
    </NextLink>,
  );
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
      ${'/Sandbox/mail%40example'}                            | ${'percent-encoded reserved character'}
      ${'/Sandbox/a%2Fb'}                                     | ${'percent-encoded path separator'}
      ${'/user/admin'}                                        | ${'user homepage root'}
      ${'/tags'}                                              | ${'the tags page'}
      ${'/trash'}                                             | ${'the trash page'}
      ${'/_search'}                                           | ${'the search page'}
      ${'/share/abc'}                                         | ${'a shared-link page'}
      ${'/admin'}                                             | ${'the admin top page'}
      ${'/me'}                                                | ${'the user settings page'}
      ${'/user/%E6%97%A5%E6%9C%AC%E8%AA%9E'}                  | ${'user homepage root hidden behind percent-encoding'}
    `('routes $pathDescription through next/link', ({ href }) => {
      const { isClientSideTransition, anchor } = renderLink(href);
      expect(isClientSideTransition).toBe(true);
      // the destination must survive the branch untouched -- query and hash included
      expect(anchor?.getAttribute('href')).toBe(href);
    });
  });

  describe('links that must NOT transition client-side', () => {
    it.each`
      href                                 | reason
      ${'#heading'}                        | ${'in-page anchor'}
      ${'/attachment/653a1f1b'}            | ${'path served outside the page router'}
      ${'/vault.git/info/refs'}            | ${'GROWI Vault git gateway, served outside the page router'}
      ${'/passport/google'}                | ${'an OAuth entry point, served outside the page router'}
      ${'/ogp/653a1f1b'}                   | ${'OGP image rendering, served outside the page router'}
      ${'/download/653a1f1b'}              | ${'an attachment download, served outside the page router'}
      ${'/uploads/653a1f1b.png'}           | ${'a raw upload path, served outside the page router'}
      ${'/Sandbox/Bootstrap5/edit'}        | ${'path reserved by the editor'}
      ${'/Sandbox/Bootstrap5.md'}          | ${'path reserved for the markdown endpoint'}
      ${'/%E6%97%A5%E6%9C%AC%E8%AA%9E.md'} | ${'reserved suffix hidden behind percent-encoding'}
      ${'/%61ttachment/653a1f1b'}          | ${'reserved prefix hidden behind percent-encoding'}
      ${'/Sandbox/broken%ZZ'}              | ${'malformed percent-encoding'}
      ${'/Sandbox/50%25off'}               | ${'literal percent sign in the path'}
    `('keeps $reason on a plain anchor', ({ href }) => {
      const { isClientSideTransition, anchor } = renderLink(href);
      expect(isClientSideTransition).toBe(false);
      expect(anchor?.getAttribute('href')).toBe(href);
    });

    it('honours an explicit target on an otherwise routable path', () => {
      const { isClientSideTransition, anchor } = renderLink('/Sandbox/日本語', {
        target: '_self',
      });
      expect(isClientSideTransition).toBe(false);
      expect(anchor?.getAttribute('target')).toBe('_self');
    });
  });

  describe('attributes carried across the branch boundary', () => {
    // The routable/non-routable branches render different elements, so a link
    // must not lose attributes just because its path became routable.
    it.each`
      href                    | branch
      ${'/Sandbox/日本語'}    | ${'client-side transition'}
      ${'/Sandbox/日本語.md'} | ${'plain anchor'}
    `('keeps id and data-* on the $branch branch', ({ href }) => {
      const { anchor } = renderLink(href, {
        id: 'my-anchor',
        'data-tracking': 'x',
      });
      expect(anchor?.getAttribute('id')).toBe('my-anchor');
      expect(anchor?.getAttribute('data-tracking')).toBe('x');
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

    it('treats an absolute URL on the site host as an internal link', () => {
      const { isClientSideTransition } = renderLink(
        'https://wiki.example.com/Sandbox/日本語',
      );
      expect(isClientSideTransition).toBe(true);
    });

    it('falls back to a new tab for an absolute URL when the site url is unset', () => {
      mocks.siteUrl = undefined;
      const { isClientSideTransition, anchor } = renderLink(
        'https://wiki.example.com/Sandbox/日本語',
      );
      expect(isClientSideTransition).toBe(false);
      expect(anchor?.getAttribute('target')).toBe('_blank');
    });

    it('still routes a root-relative path when the site url is unset', () => {
      mocks.siteUrl = undefined;
      expect(renderLink('/Sandbox/日本語').isClientSideTransition).toBe(true);
    });
  });
});
