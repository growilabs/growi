/**
 * Unit tests for the shared comment box component (`CommentCard`).
 *
 * Per design.md 決定2, `CommentCard` owns only the box and the header row; the
 * varying parts arrive through the `headerEnd` / `beforeBody` / `children` /
 * `footer` slots. These tests therefore assert *where* each slot lands in the
 * DOM (container chain + sibling order), mirroring the technique already used
 * by the sibling `Comment.spec.tsx` baseline, rather than asserting rendered
 * text — text-only assertions would still pass if the box were rebuilt into a
 * different shape.
 */

import type { JSX, ReactNode } from 'react';
import type { IUser, IUserHasId, Ref } from '@growi/core';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
//
// Keep the unit boundary at CommentCard: the user picture, the username link
// and the distance-date formatter are collaborators whose internals are not
// part of this component's contract.
// ---------------------------------------------------------------------------

vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: () => <span data-testid="user-picture" />,
}));

vi.mock('~/components/User/Username', () => ({
  Username: () => <span data-testid="username" />,
}));

/**
 * Captures the props `FormattedDistanceDate` receives, so the test can assert
 * that `createdAt` is forwarded untransformed (identity), which is invisible
 * from the rendered text.
 */
const formattedDistanceDateProps: { id?: string; date?: Date | string } = {};

vi.mock('../../FormattedDistanceDate', () => ({
  FormattedDistanceDate: (props: { id?: string; date?: Date | string }) => {
    formattedDistanceDateProps.id = props.id;
    formattedDistanceDateProps.date = props.date;
    return <span data-testid="formatted-distance-date" />;
  },
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }): JSX.Element => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import type { CommentCardProps } from './CommentCard';
import { CommentCard } from './CommentCard';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const creator = {
  _id: 'user1',
  __v: 0,
  name: 'Alice',
  username: 'alice',
  email: 'alice@example.com',
  isEmailPublished: true,
} as unknown as IUserHasId;

const createdAt = new Date('2024-01-01T00:00:00.000Z');

/**
 * Type-level assertion (design.md 決定2 corrected): `creator` must accept a
 * bare, unpopulated ref shape — not just `IUserHasId` — so a caller can pass
 * a possibly-unpopulated creator ref straight through without narrowing it
 * first. This is checked by the compiler (`pnpm run lint:typecheck`); it has
 * no runtime effect.
 */
const unpopulatedCreatorRef: Ref<IUser> = 'user1';
void (unpopulatedCreatorRef satisfies CommentCardProps['creator']);

/**
 * Type-level assertion (design.md 決定2 corrected): `creator` must also
 * accept `undefined` — this is exactly what a normal comment's
 * `isPopulated(comment.creator) ? comment.creator : undefined` produces when
 * unpopulated (never `null`). Task 4.3 forwards that value as-is.
 */
const unpopulatedCreatorUndefined: undefined = undefined;
void (unpopulatedCreatorUndefined satisfies CommentCardProps['creator']);

const getMain = (container: HTMLElement) =>
  container.querySelector('.page-comment .page-comment-main');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommentCard', () => {
  describe('the box itself', () => {
    it('renders .page-comment containing .page-comment-main.bg-comment.rounded', () => {
      const { container } = render(
        <CommentCard id="comment1" creator={creator} createdAt={createdAt}>
          <div data-testid="body-content" />
        </CommentCard>,
      );

      const root = container.querySelector('#comment1.page-comment');
      expect(root).not.toBeNull();
      expect(root?.classList.contains('flex-column')).toBe(true);

      const main = root?.querySelector('.page-comment-main.bg-comment.rounded');
      expect(main).not.toBeNull();
      expect(main?.parentElement).toBe(root);
    });

    it('appends rootClassName to the root element without dropping page-comment', () => {
      const { container } = render(
        <CommentCard
          id="comment1"
          creator={creator}
          createdAt={createdAt}
          rootClassName="page-comment-me"
        >
          <div data-testid="body-content" />
        </CommentCard>,
      );

      const root = container.querySelector('#comment1');
      expect(root?.classList.contains('page-comment')).toBe(true);
      expect(root?.classList.contains('flex-column')).toBe(true);
      expect(root?.classList.contains('page-comment-me')).toBe(true);
    });

    it('keeps the root class list free of modifier classes when rootClassName is omitted', () => {
      const { container } = render(
        <CommentCard id="comment1" creator={creator} createdAt={createdAt}>
          <div data-testid="body-content" />
        </CommentCard>,
      );

      const root = container.querySelector('#comment1');
      expect(Array.from(root?.classList ?? [])).toEqual([
        'page-comment',
        'flex-column',
      ]);
    });
  });

  describe('the header row', () => {
    it('renders the user picture and the username when creator is given', () => {
      const { container } = render(
        <CommentCard id="comment1" creator={creator} createdAt={createdAt}>
          <div data-testid="body-content" />
        </CommentCard>,
      );

      const header = getMain(container)?.querySelector(
        '.d-flex.align-items-center',
      );
      expect(header).not.toBeNull();
      expect(
        header?.querySelector('[data-testid="user-picture"]'),
      ).not.toBeNull();
      expect(header?.querySelector('[data-testid="username"]')).not.toBeNull();
    });

    it('orders the user picture, the username wrapper and the posted-date link, in the box that carries the shared classes', () => {
      const { container } = render(
        <CommentCard id="comment1" creator={creator} createdAt={createdAt}>
          <div data-testid="body-content" />
        </CommentCard>,
      );

      // Req 13.3 / 13.4: the box and the header row must be identical to the
      // normal comment's, so pin the class set and the order of the three
      // header elements — not just their presence.
      const main = container.querySelector(
        '.page-comment .page-comment-main.bg-comment.rounded.mb-2',
      );
      expect(main).not.toBeNull();

      const header = main?.querySelector('.d-flex.align-items-center');
      const headerChildren = Array.from(header?.children ?? []);

      const picture = header?.querySelector('[data-testid="user-picture"]');
      const usernameWrapper = header?.querySelector('.small.fw-bold.me-3');
      const dateLink = header?.querySelector('a.small.page-comment-revision');

      expect(picture).not.toBeNull();
      expect(
        usernameWrapper?.querySelector('[data-testid="username"]'),
      ).not.toBeNull();
      expect(dateLink).not.toBeNull();

      const indexOf = (el: Element | null | undefined) =>
        headerChildren.indexOf(el as Element);

      expect(indexOf(picture)).toBe(0);
      expect(indexOf(picture)).toBeLessThan(indexOf(usernameWrapper));
      expect(indexOf(usernameWrapper)).toBeLessThan(indexOf(dateLink));
    });

    it('still renders the user picture and the username when creator is null (they own their own fallback display)', () => {
      // design.md 決定2 (corrected): UserPicture shows a default icon and
      // Username shows "(anyone)" on their own when creator is null/unpopulated.
      // CommentCard must not add a `creator != null` guard that hides them —
      // doing so would change the normal comment's current appearance
      // (Req 13.9) once Comment.tsx is switched to use CommentCard.
      const { container } = render(
        <CommentCard id="comment1" creator={null} createdAt={createdAt}>
          <div data-testid="body-content" />
        </CommentCard>,
      );

      expect(
        container.querySelector('[data-testid="user-picture"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-testid="username"]'),
      ).not.toBeNull();
      // the date link must still be there
      expect(
        container.querySelector('[data-testid="formatted-distance-date"]'),
      ).not.toBeNull();
    });

    it('links the posted date to the anchor of the given id', () => {
      const { container } = render(
        <CommentCard id="comment1" creator={creator} createdAt={createdAt}>
          <div data-testid="body-content" />
        </CommentCard>,
      );

      const link = getMain(container)?.querySelector('a[href="#comment1"]');
      expect(link).not.toBeNull();
      expect(
        link?.querySelector('[data-testid="formatted-distance-date"]'),
      ).not.toBeNull();
    });

    it('forwards a Date createdAt to FormattedDistanceDate untransformed', () => {
      render(
        <CommentCard id="comment1" creator={creator} createdAt={createdAt}>
          <div data-testid="body-content" />
        </CommentCard>,
      );

      // identity, not equality: a parseISO()/new Date() inside CommentCard
      // would render identically but must not happen (design.md 決定2/決定3)
      expect(formattedDistanceDateProps.date).toBe(createdAt);
      expect(formattedDistanceDateProps.id).toBe('comment1');
    });

    it('forwards a string createdAt to FormattedDistanceDate untransformed', () => {
      const createdAtString = '2024-01-01T00:00:00.000Z';

      render(
        <CommentCard
          id="comment1"
          creator={creator}
          createdAt={createdAtString}
        >
          <div data-testid="body-content" />
        </CommentCard>,
      );

      expect(formattedDistanceDateProps.date).toBe(createdAtString);
    });

    it('renders headerEnd directly at the end of the header row, without an imposed wrapper', () => {
      // design.md 決定2 (corrected): CommentCard must not wrap headerEnd in a
      // hardcoded `<span className="ms-auto">` — spacing is the caller's own
      // concern (normal comments use `ms-2`, InlineCommentItem uses
      // `ms-auto`), since a single fixed margin cannot satisfy both.
      const { container } = render(
        <CommentCard
          id="comment1"
          creator={creator}
          createdAt={createdAt}
          headerEnd={<div data-testid="header-end" />}
        >
          <div data-testid="body-content" />
        </CommentCard>,
      );

      // no CommentCard-imposed wrapper span
      expect(container.querySelector('span.ms-auto')).toBeNull();

      const header = getMain(container)?.querySelector(
        '.d-flex.align-items-center',
      );
      const headerEnd = header?.querySelector('[data-testid="header-end"]');
      expect(headerEnd).not.toBeNull();
      // headerEnd is a direct child of the header row, not wrapped
      expect(headerEnd?.parentElement).toBe(header);

      // it must be the last element of the header row
      const headerChildren = Array.from(header?.children ?? []);
      expect(headerChildren.at(-1)).toBe(headerEnd);
    });

    it('renders nothing extra in the header row when headerEnd is omitted', () => {
      const { container } = render(
        <CommentCard id="comment1" creator={creator} createdAt={createdAt}>
          <div data-testid="body-content" />
        </CommentCard>,
      );

      expect(container.querySelector('span.ms-auto')).toBeNull();

      const header = getMain(container)?.querySelector(
        '.d-flex.align-items-center',
      );
      const dateLink = header?.querySelector('a.small.page-comment-revision');
      const headerChildren = Array.from(header?.children ?? []);
      // the posted-date link stays the last element when headerEnd is absent
      expect(headerChildren.at(-1)).toBe(dateLink);
    });
  });

  describe('the body and the surrounding slots', () => {
    it('renders children inside .page-comment-body', () => {
      const { container } = render(
        <CommentCard id="comment1" creator={creator} createdAt={createdAt}>
          <div data-testid="body-content" />
        </CommentCard>,
      );

      const main = getMain(container);
      const body = main?.querySelector('.page-comment-body');
      expect(body).not.toBeNull();
      expect(body?.parentElement).toBe(main);
      expect(
        body?.querySelector('[data-testid="body-content"]'),
      ).not.toBeNull();
    });

    it('places headerEnd, beforeBody, the body and footer in that order', () => {
      const { container } = render(
        <CommentCard
          id="comment1"
          creator={creator}
          createdAt={createdAt}
          headerEnd={<div data-testid="header-end" />}
          beforeBody={<div data-testid="before-body" />}
          footer={<div data-testid="footer" />}
        >
          <div data-testid="body-content" />
        </CommentCard>,
      );

      const main = getMain(container);
      expect(main).not.toBeNull();

      const children = Array.from(main?.children ?? []);
      const header = main?.querySelector('.d-flex.align-items-center');
      const beforeBody = main?.querySelector('[data-testid="before-body"]');
      const body = main?.querySelector('.page-comment-body');
      const footer = main?.querySelector('[data-testid="footer"]');

      // every slot is a direct child of the comment box
      expect(beforeBody?.parentElement).toBe(main);
      expect(footer?.parentElement).toBe(main);

      const indexOf = (el: Element | null | undefined) =>
        children.indexOf(el as Element);

      expect(indexOf(header)).toBeGreaterThanOrEqual(0);
      expect(indexOf(header)).toBeLessThan(indexOf(beforeBody));
      expect(indexOf(beforeBody)).toBeLessThan(indexOf(body));
      expect(indexOf(body)).toBeLessThan(indexOf(footer));
    });

    it('renders nothing extra when beforeBody and footer are omitted', () => {
      const { container } = render(
        <CommentCard id="comment1" creator={creator} createdAt={createdAt}>
          <div data-testid="body-content" />
        </CommentCard>,
      );

      expect(container.querySelector('[data-testid="before-body"]')).toBeNull();
      expect(container.querySelector('[data-testid="footer"]')).toBeNull();

      const main = getMain(container);
      const children = Array.from(main?.children ?? []);
      expect(children).toHaveLength(2);
      expect(children[0]?.classList.contains('d-flex')).toBe(true);
      expect(children[1]?.classList.contains('page-comment-body')).toBe(true);
    });
  });
});
