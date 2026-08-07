import type { JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import ReactMarkdown from 'react-markdown';

import { newsMarkdownOptions } from '../services/news-markdown-options';

type Props = {
  /** Locale-resolved Markdown string for the news body */
  body: string;
};

/**
 * Renders a news body as restricted Markdown on /_news.
 *
 * Uses the news-only pipeline (basic formatting + same-origin images, no raw
 * HTML) via `newsMarkdownOptions`. Wrapped in an ErrorBoundary so a rendering
 * failure degrades to nothing instead of taking down the feed page. Client-only
 * (the /_news page loads NewsFeed with ssr:false).
 */
export const NewsMarkdownBody = ({ body }: Props): JSX.Element => {
  return (
    <ErrorBoundary fallback={null}>
      <ReactMarkdown {...newsMarkdownOptions}>{body}</ReactMarkdown>
    </ErrorBoundary>
  );
};
