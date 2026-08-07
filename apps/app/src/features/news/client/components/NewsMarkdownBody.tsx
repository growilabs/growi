import type { JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import ReactMarkdown from 'react-markdown';

import { newsMarkdownOptions } from '../services/news-markdown-options';

import styles from './NewsMarkdownBody.module.scss';

type Props = {
  /** Locale-resolved Markdown string for the news body */
  body: string;
};

/**
 * Renders a news body as restricted Markdown on /_news.
 *
 * Uses the news-only pipeline (basic formatting + same-origin images, no raw
 * HTML) via `newsMarkdownOptions`. The wrapper class scopes the minimal
 * table/link styling (see NewsMarkdownBody.module.scss) since the Wiki `.wiki`
 * style surface is intentionally not reused. Wrapped in an ErrorBoundary so a
 * rendering failure degrades to nothing instead of taking down the feed page.
 * Client-only (the /_news page loads NewsFeed with ssr:false).
 */
export const NewsMarkdownBody = ({ body }: Props): JSX.Element => {
  return (
    <ErrorBoundary fallback={null}>
      <div className={styles['news-markdown-body']}>
        <ReactMarkdown {...newsMarkdownOptions}>{body}</ReactMarkdown>
      </div>
    </ErrorBoundary>
  );
};
