import type { FC } from 'react';

import { apiv3Post } from '~/client/util/apiv3-client';

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
  browserLanguage?: string;
};

export const NewsItem: FC<Props> = ({
  item,
  onReadMutate,
  browserLanguage,
}) => {
  const locale =
    browserLanguage ??
    (typeof navigator !== 'undefined'
      ? navigator.language.replace('-', '_')
      : 'ja_JP');
  const title = resolveTitle(item.title, locale);
  const emoji = item.emoji ?? DEFAULT_EMOJI;

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
      className="list-group-item list-group-item-action"
      style={{
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        background: 'none',
      }}
      onClick={handleClick}
    >
      <div className="d-flex align-items-center">
        {/* Unread indicator dot or transparent spacer */}
        <span
          className={`${item.isRead ? '' : 'bg-primary'} rounded-circle me-3`}
          style={{ width: 8, height: 8, minWidth: 8, display: 'inline-block' }}
        />

        {/* Avatar position: emoji */}
        <span className="me-2" style={{ fontSize: '1.2rem', lineHeight: 1 }}>
          {emoji}
        </span>

        {/* Content column */}
        <div>
          <span className={item.isRead ? 'fw-normal' : 'fw-bold'}>{title}</span>
          <div className="text-muted small">
            {item.publishedAt instanceof Date
              ? item.publishedAt.toLocaleDateString(locale.replace('_', '-'))
              : new Date(item.publishedAt).toLocaleDateString(
                  locale.replace('_', '-'),
                )}
          </div>
        </div>
      </div>
    </button>
  );
};
