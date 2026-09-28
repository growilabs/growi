import type { JSX, ReactNode } from 'react';
import Link from 'next/link';
import type { IUser, IUserHasId, Ref } from '@growi/core';
import type { IUserSerializedSecurely } from '@growi/core/dist/models/serializers';
import { UserPicture } from '@growi/ui/dist/components';

import { Username } from '~/components/User/Username';

import { FormattedDistanceDate } from '../../FormattedDistanceDate';

export type CommentCardProps = {
  /** The id an anchor link points at (the normal comment passes comment._id) */
  id: string;
  /**
   * The author, forwarded as-is to UserPicture / Username (both already fall
   * back for a missing/unpopulated creator), so CommentCard never decides to
   * hide them itself. A normal comment passes `undefined` or an unpopulated
   * `Ref<IUser>`; an inline comment passes an already-serialized
   * `IUserSerializedSecurely<IUserHasId>` (or `null`), since its
   * `listByPageId()` response already ran the row through
   * `serializeUserSecurely` server-side.
   */
  creator:
    | IUserHasId
    | Ref<IUser>
    | IUserSerializedSecurely<IUserHasId>
    | null
    | undefined;
  /**
   * Declared as Date but actually arrives as an ISO string. Forwarded to
   * FormattedDistanceDate as-is; this component never parses or converts it.
   */
  createdAt: Date | string;
  /** Modifier classes for .page-comment (page-comment-me / -newer / -older ...) */
  rootClassName?: string;
  /**
   * End of the header row: the revision link for a normal comment, the
   * resolve toggle for an inline one. Rendered as-is — CommentCard does not
   * wrap it in any spacing container. The two callers need different spacing
   * (a normal comment's revision link uses `ms-2`, InlineCommentItem's toggle
   * uses `ms-auto`), so each caller wraps its own `headerEnd` content with
   * the margin it needs.
   */
  headerEnd?: ReactNode;
  /** Before the body: the quoted range of an inline comment goes here */
  beforeBody?: ReactNode;
  /** The body */
  children: ReactNode;
  /** After the body: the normal comment's "(edited)" mark and control buttons */
  footer?: ReactNode;
};

/**
 * The comment box shared by normal comments and inline comments.
 *
 * It owns only the box and the header row; everything that differs between the
 * two kinds arrives through the slots. It deliberately has no CSS module of its
 * own — the styling rules of each caller's module are written as nested
 * `:global(.page-comment)` selectors, so the caller supplies the module
 * container and this component contributes only global class names.
 */
export const CommentCard = (props: CommentCardProps): JSX.Element => {
  const {
    id,
    creator,
    createdAt,
    rootClassName,
    headerEnd,
    beforeBody,
    children,
    footer,
  } = props;

  const className =
    rootClassName != null
      ? `page-comment flex-column ${rootClassName}`
      : 'page-comment flex-column';

  return (
    <div id={id} className={className}>
      <div className="page-comment-main bg-comment rounded mb-2">
        <div className="d-flex align-items-center">
          <UserPicture user={creator} size="md" className="me-2" />
          <div className="small fw-bold me-3">
            {/*
             * Username's prop type doesn't include `null` (only `IUserHasId
             * | Ref<IUser> | undefined`), but treats null/undefined/unpopulated
             * identically at runtime (falls back to "(anyone)"), so normalizing
             * null to undefined here changes nothing observable.
             */}
            <Username user={creator ?? undefined} />
          </div>
          <Link
            href={`#${id}`}
            prefetch={false}
            className="small page-comment-revision"
          >
            <FormattedDistanceDate id={id} date={createdAt} />
          </Link>
          {headerEnd}
        </div>
        {beforeBody}
        <div className="page-comment-body">{children}</div>
        {footer}
      </div>
    </div>
  );
};
