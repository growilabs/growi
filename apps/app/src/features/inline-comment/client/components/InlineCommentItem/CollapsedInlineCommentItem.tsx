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
 * the (clamped) quote and the expand button only. Renders the same outer
 * wrapper as `InlineCommentItem`'s expanded display, so the module styles
 * that give the card its look still apply.
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
      className={`inline-comment-item mb-3 ${styles['inline-comment-item-styles']}`}
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
            {/* Same position and look as the expanded display's collapse
                button, and deliberately outside any read-only guard: it
                changes no data. */}
            <button
              type="button"
              data-testid="inline-comment-expand-button"
              className="btn btn-sm btn-link text-secondary text-decoration-none p-0"
              onClick={onExpand}
            >
              {t('inline_comment.expand')}
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
      >
        {null}
      </CommentCard>
    </div>
  );
};
