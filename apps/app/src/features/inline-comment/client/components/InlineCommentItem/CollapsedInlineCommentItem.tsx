import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { CommentCard } from '~/client/components/PageComment/CommentCard';

import type { InlineCommentWithReplies } from '../../../interfaces';
import { InlineCommentQuote } from './InlineCommentQuote';
import { InlineCommentStatusBadge } from './InlineCommentStatusBadge';

import styles from './InlineCommentItem.module.scss';

type CollapsedInlineCommentItemProps = {
  comment: InlineCommentWithReplies;
  onExpand: () => void;
  onQuoteClick: () => void;
};

/**
 * The collapsed display of a resolved inline comment: author, date, badge,
 * the (clamped) quote, a faded peek of the body, the header expand chevron,
 * and a bottom-edge "More" expand control.
 * Renders the same outer wrapper as `InlineCommentItem`'s expanded display,
 * so the module styles that give the card its look still apply.
 */
export const CollapsedInlineCommentItem = (
  props: CollapsedInlineCommentItemProps,
): JSX.Element => {
  const { comment, onExpand, onQuoteClick } = props;
  const { t } = useTranslation();
  const isResolved = comment.resolvedAt != null;

  return (
    <div
      data-testid="inline-comment-item"
      data-resolved={isResolved}
      className={`inline-comment-item mb-2 ${styles['inline-comment-item-styles']} ${styles['inline-comment-item-collapsed']}`}
    >
      <CommentCard
        id={comment.id}
        creator={comment.creator}
        createdAt={comment.createdAt}
        rootClassName={
          isResolved ? 'inline-comment-item-resolved opacity-75' : undefined
        }
        headerEnd={
          <span className="ms-auto d-flex align-items-center gap-2">
            {/* Same position as the expanded display's collapse button, and
                deliberately outside any read-only guard: it changes no data.
                Icon-only disclosure (expand_more) — label stays in aria-label. */}
            <button
              type="button"
              data-testid="inline-comment-expand-button"
              className="btn btn-sm btn-link text-secondary text-decoration-none p-0 d-inline-flex align-items-center lh-1"
              aria-label={t('inline_comment.expand')}
              onClick={onExpand}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                expand_more
              </span>
            </button>
            <InlineCommentStatusBadge isResolved={isResolved} />
          </span>
        }
        beforeBody={
          <InlineCommentQuote
            quote={comment.anchor.quote}
            onClick={onQuoteClick}
            clamped
          />
        }
        footer={
          // Second expand affordance at the bottom edge: makes "there is more
          // below" obvious, and shares the same handler as the header chevron.
          <div className="d-flex justify-content-center mt-1">
            <button
              type="button"
              data-testid="inline-comment-expand-more-button"
              className={`btn btn-sm btn-outline-secondary rounded-pill border-0 d-inline-flex align-items-center justify-content-center gap-1 py-0 px-2 small ${styles['inline-comment-collapsed-more']}`}
              onClick={onExpand}
            >
              <span
                className="material-symbols-outlined fs-6"
                aria-hidden="true"
              >
                expand_more
              </span>
              {t('inline_comment.more')}
            </button>
          </div>
        }
      >
        {/* Plain-text peek (not RevisionRenderer): enough to show there is a
            body without mounting the full markdown tree while collapsed. */}
        <div data-testid="inline-comment-collapsed-peek" className="mt-1">
          <div
            className={`small text-body-secondary ${styles['inline-comment-collapsed-peek-text']}`}
          >
            {comment.comment}
          </div>
        </div>
      </CommentCard>
    </div>
  );
};
