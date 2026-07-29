import type { FC } from 'react';
import { memo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { format } from 'date-fns';
import { useTranslation } from 'next-i18next';

import unreadDotStyles from '~/client/components/InAppNotification/UnreadDot.module.scss';
import { apiv3Post } from '~/client/util/apiv3-client';
import { getLocale } from '~/utils/locale-utils';

import type { INewsItemWithReadStatus } from '../../interfaces/news-item';
import { NEWS_FEED_PATH, newsItemAnchorId } from '../consts';
import { resolveLocaleText } from '../utils/resolve-locale-text';

const DEFAULT_EMOJI = '📢';

type Props = {
  item: INewsItemWithReadStatus;
  /**
   * 0-based index of the full-feed (/_news) page this item appears on,
   * derived from the sidebar SWRInfinite pages. Used to construct the
   * `/_news?page=N` query so that clicking a news item lands on the
   * corresponding page without loading N-1 prior pages.
   *
   * `undefined` when no valid mapping exists (e.g. the unread-only filter is
   * active — its page boundaries do not match the full feed); navigation
   * then omits the `?page` query and lands on the first page.
   */
  pageIndex?: number;
  onReadMutate: (newsItemId: string) => void;
};

const NewsItemInner: FC<Props> = ({ item, pageIndex, onReadMutate }) => {
  const { i18n } = useTranslation();
  const router = useRouter();
  const locale = i18n.language;
  const title = resolveLocaleText(item.title, locale);
  const emoji = item.emoji ?? DEFAULT_EMOJI;

  const publishedDate =
    item.publishedAt instanceof Date
      ? item.publishedAt
      : new Date(item.publishedAt);
  const formattedDate = format(publishedDate, 'PP', {
    locale: getLocale(locale),
  });

  // Clicking a news item always navigates to the news feed page, anchored to
  // the clicked item. Marking it read first keeps the unread badge in sync.
  const handleClick = useCallback(async () => {
    const id = item._id.toString();
    try {
      await apiv3Post('/news/mark-read', { newsItemId: id });
      onReadMutate(id);
    } catch {
      // silently ignore mark-read failures
    }
    // `?page=N` sends the caller to the specific page of the full feed so
    // /_news doesn't need to walk N-1 pages to reach the anchored item.
    // When the mapping is unknown (pageIndex undefined), omit the query
    // rather than point at a possibly wrong page.
    // `scroll: false` prevents Next.js from resetting scroll on navigation;
    // NewsFeed handles anchor scroll itself in a useEffect.
    const pageQuery = pageIndex != null ? `?page=${pageIndex + 1}` : '';
    router.push(
      `${NEWS_FEED_PATH}${pageQuery}#${newsItemAnchorId(id)}`,
      undefined,
      { scroll: false },
    );
  }, [item._id, pageIndex, onReadMutate, router]);

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

export const NewsItem = memo(NewsItemInner);
