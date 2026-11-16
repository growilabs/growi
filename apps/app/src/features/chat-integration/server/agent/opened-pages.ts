import type { AnswerSource } from '@growi/chat';
import { returnPathForURL } from '@growi/core/dist/utils/path-utils';
import urljoin from 'url-join';

import { titleFromPath } from '../content/title-from-path';

export interface OpenedPage {
  readonly pageId: string;
  readonly path: string;
}

/**
 * The part of a Mastra `generate` result the extraction reads, declared
 * structurally so this module stays free of Mastra imports.
 */
export interface ToolResultsView {
  readonly toolResults: ReadonlyArray<{
    readonly payload: { readonly toolName: string; readonly result?: unknown };
  }>;
}

// The registration KEY in growiAgent's `tools` record, which is what Mastra
// reports as `toolName` (not the tool's `id`, 'get-page-content-tool').
const PAGE_TOOL_KEY = 'getPageContentTool';

const isOpenedPageOutput = (
  value: unknown,
): value is { result: 'ok'; page: OpenedPage } => {
  if (typeof value !== 'object' || value == null) return false;
  if (!('result' in value) || value.result !== 'ok') return false;
  if (!('page' in value)) return false;
  const { page } = value;
  return (
    typeof page === 'object' &&
    page != null &&
    'pageId' in page &&
    typeof page.pageId === 'string' &&
    'path' in page &&
    typeof page.path === 'string'
  );
};

/**
 * The pages the page-content tool read during one run, in first-opened order
 * and once each. Same rules as the browser's `extractPageSources`
 * (research.md "インストール済みの Mastra の generate の結果と打ち切り").
 */
export const extractOpenedPages = (result: ToolResultsView): OpenedPage[] => {
  const seen = new Set<string>();
  const pages: OpenedPage[] = [];
  for (const { payload } of result.toolResults) {
    if (payload.toolName !== PAGE_TOOL_KEY) continue;
    if (!isOpenedPageOutput(payload.result)) continue;
    const { pageId, path } = payload.result.page;
    if (seen.has(pageId)) continue;
    seen.add(pageId);
    pages.push({ pageId, path });
  }
  return pages;
};

export const toAnswerSources = (
  pages: ReadonlyArray<OpenedPage>,
  siteUrl: string,
): AnswerSource[] =>
  pages.map(({ pageId, path }) => ({
    title: titleFromPath(path),
    url: urljoin(siteUrl, returnPathForURL(path, pageId)),
  }));
