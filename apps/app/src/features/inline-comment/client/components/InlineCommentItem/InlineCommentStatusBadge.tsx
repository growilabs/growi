import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './InlineCommentItem.module.scss';

type InlineCommentStatusBadgeProps = {
  isResolved: boolean;
};

export const InlineCommentStatusBadge = (
  props: InlineCommentStatusBadgeProps,
): JSX.Element => {
  const { isResolved } = props;
  const { t } = useTranslation();

  return (
    <span
      data-testid="inline-comment-status"
      className={`badge rounded-pill ${styles['inline-comment-status-badge']} ${
        isResolved
          ? 'bg-success-subtle text-success-emphasis'
          : 'bg-warning-subtle text-warning-emphasis'
      }`}
    >
      {isResolved
        ? t('inline_comment.resolved')
        : t('inline_comment.unresolved')}
    </span>
  );
};
