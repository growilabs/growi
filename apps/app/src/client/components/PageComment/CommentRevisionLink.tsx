import type { JSX } from 'react';
import Link from 'next/link';
import * as pathUtils from '@growi/core/dist/utils/path-utils';
import { useTranslation } from 'next-i18next';
import { UncontrolledTooltip } from 'reactstrap';
import urljoin from 'url-join';

import styles from './CommentEditDeleteButtons.module.scss';

type CommentRevisionLinkProps = {
  /**
   * The comment's own id, used both as this instance's tooltip target
   * (`page-comment-revision-${id}`) and as a React key for callers rendering
   * more than one -- each caller already has this value (the normal
   * comment's `_id`, an inline comment's `id`), so it is required rather
   * than generated here.
   */
  id: string;
  pagePath: string;
  pageId: string;
  /** The revision this comment/anchor was posted against. */
  revisionId: string;
};

/**
 * Links to the page as it looked when this comment was posted, shared by the
 * normal comment (`Comment.tsx`) and the inline comment origin
 * (`InlineCommentItem.tsx`) -- previously only `Comment.tsx` had this
 * control; extracted verbatim (not reimplemented) when it was added to the
 * inline comment item too, so the two stay identical rather than drifting
 * (2026-09-11, user request).
 *
 * Shares `CommentEditDeleteButtons.module.scss`'s `.icon-button` class so
 * its hover interaction can't drift from edit/delete's. Box-hover reveal is
 * each caller's own wrapper, same as it already places
 * `CommentEditDeleteButtons`.
 */
export const CommentRevisionLink = (
  props: CommentRevisionLinkProps,
): JSX.Element => {
  const { id, pagePath, pageId, revisionId } = props;
  const { t } = useTranslation();
  const { returnPathForURL } = pathUtils;

  const revHref = `?revisionId=${revisionId}`;
  const tooltipTargetId = `page-comment-revision-${id}`;

  return (
    <>
      <Link
        id={tooltipTargetId}
        href={urljoin(returnPathForURL(pagePath, pageId), revHref)}
        className={`btn btn-link page-comment-revision ${styles['icon-button']}`}
        prefetch={false}
      >
        <span className="material-symbols-outlined">history</span>
      </Link>
      <UncontrolledTooltip
        placement="bottom"
        fade={false}
        target={tooltipTargetId}
      >
        {t('page_comment.display_the_page_when_posting_this_comment')}
      </UncontrolledTooltip>
    </>
  );
};
