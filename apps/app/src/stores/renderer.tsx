import { useCallback, useEffect } from 'react';

import type { HtmlElementNode } from 'rehype-toc';
import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr';

import { getGrowiFacade } from '~/features/growi-plugin/client/utils/growi-facade-utils';
import type { RendererOptions } from '~/interfaces/renderer-options';
import type { RendererConfigExt } from '~/interfaces/services/renderer';
import { useCurrentPagePath } from '~/states/page';
import { useRendererConfig } from '~/states/server-configurations';
import { useSetTocNode } from '~/states/ui/toc';
import { useNextThemes } from '~/stores-universal/use-next-themes';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:cli:services:renderer');

const useRendererConfigExt = (): RendererConfigExt | null => {
  const rendererConfig = useRendererConfig();
  const { isDarkMode } = useNextThemes();

  return rendererConfig == null ? null : {
    ...rendererConfig,
    isDarkMode,
  } satisfies RendererConfigExt;
};


export const useViewOptions = (): SWRResponse<RendererOptions, Error> => {
  const currentPagePath = useCurrentPagePath();
  const rendererConfig = useRendererConfigExt();
  const setTocNode = useSetTocNode();

  const storeTocNodeHandler = useCallback((toc: HtmlElementNode) => {
    setTocNode(toc);
  }, [setTocNode]);

  const isAllDataValid = currentPagePath != null && rendererConfig != null;
  const customGenerater = getGrowiFacade().markdownRenderer?.optionsGenerators?.customGenerateViewOptions;

  return useSWR(
    isAllDataValid
      ? ['viewOptions', currentPagePath, rendererConfig, customGenerater]
      : null,
    async ([, currentPagePath, rendererConfig]) => {
      if (customGenerater != null) {
        return customGenerater(currentPagePath, rendererConfig, storeTocNodeHandler);
      }

      const { generateViewOptions } = await import('~/client/services/renderer/renderer');
      return generateViewOptions(currentPagePath, rendererConfig, storeTocNodeHandler);
    },
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};

export const usePreviewOptions = (): SWRResponse<RendererOptions, Error> => {
  const currentPagePath = useCurrentPagePath();
  const rendererConfig = useRendererConfigExt();

  const isAllDataValid = currentPagePath != null && rendererConfig != null;
  const customGenerater = getGrowiFacade().markdownRenderer?.optionsGenerators?.customGeneratePreviewOptions;

  return useSWR(
    isAllDataValid
      ? ['previewOptions', rendererConfig, currentPagePath, customGenerater]
      : null,
    async ([, rendererConfig, pagePath]) => {
      if (customGenerater != null) {
        return customGenerater(rendererConfig, pagePath);
      }

      const { generatePreviewOptions } = await import('~/client/services/renderer/renderer');
      return generatePreviewOptions(rendererConfig, pagePath);
    },
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};

export const useCommentForCurrentPageOptions = (): SWRResponse<RendererOptions, Error> => {
  const currentPagePath = useCurrentPagePath();
  const rendererConfig = useRendererConfigExt();

  const isAllDataValid = currentPagePath != null && rendererConfig != null;

  return useSWR(
    isAllDataValid
      ? ['commentPreviewOptions', rendererConfig, currentPagePath]
      : null,
    async ([, rendererConfig, currentPagePath]) => {
      const { generateSimpleViewOptions } = await import('~/client/services/renderer/renderer');
      return generateSimpleViewOptions(
        rendererConfig,
        currentPagePath,
        undefined,
        rendererConfig.isEnabledLinebreaksInComments,
      );
    },
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};
export const useCommentPreviewOptions = useCommentForCurrentPageOptions;

export const useSelectedPagePreviewOptions = (pagePath: string, highlightKeywords?: string | string[]): SWRResponse<RendererOptions, Error> => {
  const rendererConfig = useRendererConfigExt();

  const isAllDataValid = rendererConfig != null;

  return useSWR(
    isAllDataValid
      ? ['selectedPagePreviewOptions', rendererConfig, pagePath, highlightKeywords]
      : null,
    async ([, rendererConfig, pagePath, highlightKeywords]) => {
      const { generateSimpleViewOptions } = await import('~/client/services/renderer/renderer');
      return generateSimpleViewOptions(rendererConfig, pagePath, highlightKeywords);
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};
export const useSearchResultOptions = useSelectedPagePreviewOptions;

export const useTimelineOptions = useSelectedPagePreviewOptions;

export const useCustomSidebarOptions = (config?: SWRConfiguration): SWRResponse<RendererOptions, Error> => {
  const rendererConfig = useRendererConfigExt();

  const isAllDataValid = rendererConfig != null;

  return useSWR(
    isAllDataValid
      ? ['customSidebarOptions', rendererConfig]
      : null,
    async ([, rendererConfig]) => {
      const { generateSimpleViewOptions } = await import('~/client/services/renderer/renderer');
      return generateSimpleViewOptions(rendererConfig, '/');
    },
    {
      ...config,
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};

export const usePresentationViewOptions = (): SWRResponse<RendererOptions, Error> => {
  const currentPagePath = useCurrentPagePath();
  const rendererConfig = useRendererConfigExt();

  const isAllDataValid = currentPagePath != null && rendererConfig != null;

  useEffect(() => {
    if (rendererConfig == null) {
      logger.warn('RendererConfig is undefined or missing.');
    }
  }, [rendererConfig]);

  return useSWR(
    isAllDataValid
      ? ['presentationViewOptions', currentPagePath, rendererConfig]
      : null,
    async ([, currentPagePath, rendererConfig]) => {
      const { generatePresentationViewOptions } = await import('~/client/services/renderer/renderer');
      return generatePresentationViewOptions(rendererConfig, currentPagePath);
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};
