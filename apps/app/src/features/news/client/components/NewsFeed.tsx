import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { format } from 'date-fns';
import { useTranslation } from 'next-i18next';

import unreadDotStyles from '~/client/components/InAppNotification/UnreadDot.module.scss';
import InfiniteScroll from '~/client/components/InfiniteScroll';
import { getLocale } from '~/utils/locale-utils';

import { newsItemAnchorId } from '../consts';
import { useSWRINFxNews } from '../hooks/use-news';
import { resolveLocaleText } from '../utils/resolve-locale-text';

const NEWS_PER_PAGE = 10;
const DEFAULT_EMOJI = '📢';

/**
 * Maximum number of additional pages to pull while searching for an anchor
 * target. Caps the worst-case workload when the URL hash points at a deleted
 * or otherwise unreachable news item — without this guard the lookup walks
 * the entire history before giving up.
 */
const MAX_ANCHOR_SCAN_PAGES = 5;

/**
 * Defense-in-depth: even though `feed-parser` rejects non-http(s) URLs at
 * ingest time, the rendered href is exposed to whatever happens to be in the
 * DB (e.g. a row inserted before the validator existed). Re-check at render
 * to block `javascript:`, `data:`, and similar XSS vectors.
 */
const isSafeHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url);

/**
 * Full-page news feed. Reuses the same SWRInfinite stream as the notification
 * panel and renders each item with its body as plain text (React escapes the
 * string, so external feed content cannot inject markup).
 *
 * Anchor handling: the browser cannot jump to `#news-<id>` when the target is
 * on a not-yet-loaded page. So on mount we read the hash and keep advancing the
 * infinite stream until the element exists, then scroll to it.
 */
export const NewsFeed = (): JSX.Element => {
  const { t, i18n } = useTranslation('commons');
  const locale = i18n.language;
  const router = useRouter();

  const swrResponse = useSWRINFxNews(NEWS_PER_PAGE);
  const { data, setSize, isValidating } = swrResponse;

  const items = (data ?? []).flatMap((page) => page.docs);
  const lastPage = data != null ? data[data.length - 1] : undefined;
  const isReachingEnd = lastPage != null && lastPage.hasNextPage === false;

  // Pending anchor to scroll to. Empty string means "nothing to do".
  // Captures the initial hash at mount; subsequent hash changes (e.g. when the
  // user clicks another news item while /_news is already open) refresh it.
  const [scrollTargetHash, setScrollTargetHash] = useState<string>(() =>
    typeof window === 'undefined'
      ? ''
      : decodeURIComponent(window.location.hash.replace(/^#/, '')),
  );
  const scanAttemptsRef = useRef(0);

  // Reset the scroll target whenever the URL hash changes while the page is
  // already mounted. Without this the second click from the sidebar would not
  // scroll because the component is not remounted.
  useEffect(() => {
    const handleHashChange = (url: string) => {
      const hashIndex = url.indexOf('#');
      const hash =
        hashIndex >= 0 ? decodeURIComponent(url.slice(hashIndex + 1)) : '';
      scanAttemptsRef.current = 0;
      setScrollTargetHash(hash);
    };
    router.events.on('hashChangeComplete', handleHashChange);
    return () => router.events.off('hashChangeComplete', handleHashChange);
  }, [router.events]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items.length is an intentional trigger — re-run to re-check the anchor element each time a new page loads
  useEffect(() => {
    if (scrollTargetHash === '') return;

    const el = document.getElementById(scrollTargetHash);
    if (el != null) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setScrollTargetHash('');
      return;
    }

    // Give up if there are no more pages, we've already scanned the maximum,
    // or a fetch is in flight (next render will retry).
    if (isReachingEnd || scanAttemptsRef.current >= MAX_ANCHOR_SCAN_PAGES) {
      setScrollTargetHash('');
      return;
    }
    if (!isValidating) {
      scanAttemptsRef.current += 1;
      setSize((size) => size + 1);
    }
  }, [scrollTargetHash, items.length, isReachingEnd, isValidating, setSize]);

  if (items.length === 0 && !isValidating) {
    return (
      <div className="text-muted text-center py-5">
        {t('in_app_notification.no_news')}
      </div>
    );
  }

  return (
    <InfiniteScroll
      swrInifiniteResponse={swrResponse}
      isReachingEnd={isReachingEnd}
    >
      <div className="list-group list-group-flush">
        {items.map((item) => {
          const id = item._id.toString();
          const title = resolveLocaleText(item.title, locale);
          const body =
            item.body != null ? resolveLocaleText(item.body, locale) : '';
          const emoji = item.emoji ?? DEFAULT_EMOJI;
          const publishedDate =
            item.publishedAt instanceof Date
              ? item.publishedAt
              : new Date(item.publishedAt);
          const formattedDate = format(publishedDate, 'PP', {
            locale: getLocale(locale),
          });

          return (
            <section
              key={id}
              id={newsItemAnchorId(id)}
              className="list-group-item py-4"
            >
              <div className="d-flex align-items-center mb-1">
                <span
                  className={`${item.isRead ? '' : 'bg-primary'} rounded-circle me-3 ${unreadDotStyles['unread-dot']}`}
                />
                <span className="me-2 fs-4 lh-1">{emoji}</span>
                <h2
                  className={`h5 mb-0 ${item.isRead ? 'fw-normal' : 'fw-bold'}`}
                >
                  {title}
                </h2>
              </div>

              <div className="text-muted small mb-2 ms-5">{formattedDate}</div>

              {body !== '' && (
                <div className="ms-5" style={{ whiteSpace: 'pre-wrap' }}>
                  {body}
                </div>
              )}

              {item.url != null && isSafeHttpUrl(item.url) && (
                <div className="ms-5 mt-3">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline-secondary btn-sm"
                  >
                    {t('in_app_notification.view_detail')}
                    <span className="growi-custom-icons ms-1 small">
                      external_link
                    </span>
                  </a>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </InfiniteScroll>
  );
};
