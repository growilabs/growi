import type { JSX } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { format } from 'date-fns';
import { useTranslation } from 'next-i18next';

import unreadDotStyles from '~/client/components/InAppNotification/UnreadDot.module.scss';
import PaginationWrapper from '~/client/components/PaginationWrapper';
import { getLocale } from '~/utils/locale-utils';

import { NEWS_PER_PAGE, newsItemAnchorId } from '../consts';
import { useSWRxNewsPage } from '../hooks/use-news';
import { isSafeHttpUrl } from '../utils/is-safe-http-url';
import { parsePageQuery } from '../utils/parse-page-query';
import { resolveLocaleText } from '../utils/resolve-locale-text';
import { NewsImage } from './NewsImage';

import styles from './NewsFeed.module.scss';

const DEFAULT_EMOJI = '📢';

/**
 * Full-page news feed with pagination. Sidebar's infinite-scroll variant walks
 * pages sequentially; here we fetch a single page directly so that an anchor
 * near the bottom of a long feed does not require loading every prior page.
 *
 * Anchor handling: after the requested page loads, if the URL has a
 * `#news-<id>` hash and that element is present on the current page, scroll
 * to it. `scroll-margin-top` on the `<section>` (see `NewsFeed.module.scss`)
 * offsets it below the sticky header.
 */
export const NewsFeed = (): JSX.Element => {
  const { t, i18n } = useTranslation('commons');
  const locale = i18n.language;
  const router = useRouter();

  const currentPage = parsePageQuery(router.query.page);
  const { data, isValidating } = useSWRxNewsPage(currentPage, NEWS_PER_PAGE);

  const items = data?.docs ?? [];
  const totalItemsCount = data?.totalDocs ?? 0;

  const changePage = useCallback(
    (nextPage: number) => {
      // Preserve the current hash so a page change from a browser bookmark
      // still lands on its anchor if the target item happens to be on the new
      // page. `scroll: false` prevents Next.js from resetting scroll; anchor
      // scroll is handled by the effect below.
      router.push(
        {
          pathname: router.pathname,
          query: { ...router.query, page: nextPage },
          hash: router.asPath.includes('#')
            ? router.asPath.slice(router.asPath.indexOf('#') + 1)
            : undefined,
        },
        undefined,
        { scroll: false },
      );
    },
    [router],
  );

  // Anchor scroll: focus the hash target once per navigation (asPath).
  // With `keepPreviousData` the previous page's DOM is still shown when
  // asPath changes, so the first run may not find the target; `data` in the
  // dependency array re-fires the effect when the new page arrives. The ref
  // guards against re-scrolling on background revalidations (which also
  // change the `data` reference) after the target has been focused.
  const scrolledForPathRef = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `data` is an intentional trigger — re-check the anchor when the page contents arrive
  useEffect(() => {
    if (scrolledForPathRef.current === router.asPath) return;
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (hash === '') return;
    const el = document.getElementById(hash);
    if (el != null) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      scrolledForPathRef.current = router.asPath;
    }
  }, [data, router.asPath]);

  if (isValidating && items.length === 0) {
    return (
      <div className="text-muted text-center py-5">
        <LoadingSpinner className="fs-3" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-muted text-center py-5">
        {t('in_app_notification.no_news')}
      </div>
    );
  }

  return (
    <>
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
              className={`${styles['news-item']} list-group-item py-4`}
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

              {item.image != null && (
                <div className="ms-5 mt-3">
                  {/* key={url} remounts NewsImage when the URL changes so a
                      previous load-error state cannot hide a new image */}
                  <NewsImage
                    key={item.image.url}
                    url={item.image.url}
                    alt={item.image.alt}
                  />
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

      {totalItemsCount > NEWS_PER_PAGE && (
        <div className="mt-4">
          <PaginationWrapper
            activePage={currentPage}
            changePage={changePage}
            totalItemsCount={totalItemsCount}
            pagingLimit={NEWS_PER_PAGE}
            align="center"
            size="sm"
          />
        </div>
      )}
    </>
  );
};
