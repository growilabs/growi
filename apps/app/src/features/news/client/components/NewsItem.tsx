import type { FC } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'next-i18next';

import unreadDotStyles from '~/client/components/InAppNotification/UnreadDot.module.scss';
import { apiv3Post } from '~/client/util/apiv3-client';
import { getLocale } from '~/server/util/locale-utils';

import type { INewsItemWithReadStatus } from '../../interfaces/news-item';

const DEFAULT_EMOJI = '📢';

/**
 * Resolve the title for the given locale with fallback chain:
 * browserLocale → ja_JP → en_US → first available key
 */
const resolveTitle = (
  title: Record<string, string>,
  locale: string,
): string => {
  if (title[locale]) return title[locale];
  if (title.ja_JP) return title.ja_JP;
  if (title.en_US) return title.en_US;
  const keys = Object.keys(title);
  return keys.length > 0 ? title[keys[0]] : '';
};

type Props = {
  item: INewsItemWithReadStatus;
  onReadMutate: () => void;
};

export const NewsItem: FC<Props> = ({ item, onReadMutate }) => {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const title = resolveTitle(item.title, locale);
  const emoji = item.emoji ?? DEFAULT_EMOJI;

  const publishedDate =
    item.publishedAt instanceof Date
      ? item.publishedAt
      : new Date(item.publishedAt);
  const formattedDate = format(publishedDate, 'PP', {
    locale: getLocale(locale),
  });

  const handleClick = async () => {
    try {
      await apiv3Post('/news/mark-read', { newsItemId: item._id.toString() });
      onReadMutate();
    } catch {
      // silently ignore mark-read failures
    }

    if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <button
      type="button"
      className="list-group-item list-group-item-action w-100 text-start bg-transparent"
      onClick={handleClick}
    >
      <div className="d-flex align-items-center">
        <span
          className={`${item.isRead ? '' : 'bg-primary'} rounded-circle me-3 ${unreadDotStyles['unread-dot']}`}
        />

        <span className="me-2 fs-5 lh-1">{emoji}</span>

        <div>
          <span className={item.isRead ? 'fw-normal' : 'fw-bold'}>{title}</span>
          <div className="text-muted small">{formattedDate}</div>
        </div>
      </div>
    </button>
  );
};
