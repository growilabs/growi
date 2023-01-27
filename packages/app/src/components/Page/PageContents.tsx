import React, { useEffect } from 'react';

import { pagePathUtils } from '@growi/core';
import { useTranslation } from 'next-i18next';
import type { HtmlElementNode } from 'rehype-toc';

import { useDrawioModalLauncherForView } from '~/client/services/side-effects/drawio-modal-launcher-for-view';
import { useHandsontableModalLauncherForView } from '~/client/services/side-effects/handsontable-modal-launcher-for-view';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useCurrentPathname } from '~/stores/context';
import { useEditingMarkdown } from '~/stores/editor';
import { useSWRxCurrentPage } from '~/stores/page';
import { useViewOptions } from '~/stores/renderer';
import { useCurrentPageTocNode } from '~/stores/ui';
import { registerGrowiFacade } from '~/utils/growi-facade';
import loggerFactory from '~/utils/logger';

import RevisionRenderer from './RevisionRenderer';


const logger = loggerFactory('growi:Page');


export const PageContents = (): JSX.Element => {
  const { t } = useTranslation();

  const { data: currentPathname } = useCurrentPathname();
  const isSharedPage = pagePathUtils.isSharedPage(currentPathname ?? '');

  const { data: currentPage, mutate: mutateCurrentPage } = useSWRxCurrentPage();
  const { mutate: mutateEditingMarkdown } = useEditingMarkdown();
  const { mutate: mutateCurrentPageTocNode } = useCurrentPageTocNode();

  const { data: rendererOptions, mutate: mutateRendererOptions } = useViewOptions((toc: HtmlElementNode) => {
    mutateCurrentPageTocNode(toc);
  });

  // register to facade
  useEffect(() => {
    registerGrowiFacade({
      markdownRenderer: {
        optionsMutators: {
          viewOptionsMutator: mutateRendererOptions,
        },
      },
    });
  }, [mutateRendererOptions]);

  useHandsontableModalLauncherForView({
    onSaveSuccess: (newMarkdown) => {
      toastSuccess(t('toaster.save_succeeded'));

      // rerender
      if (!isSharedPage) {
        mutateCurrentPage();
      }
      mutateEditingMarkdown(newMarkdown);
    },
    onSaveError: (error) => {
      toastError(error);
    },
  });

  useDrawioModalLauncherForView({
    onSaveSuccess: (newMarkdown) => {
      toastSuccess(t('toaster.save_succeeded'));

      // rerender
      if (!isSharedPage) {
        mutateCurrentPage();
      }
      mutateEditingMarkdown(newMarkdown);
    },
    onSaveError: (error) => {
      toastError(error);
    },
  });


  if (currentPage == null || rendererOptions == null) {
    const entries = Object.entries({
      currentPage, rendererOptions,
    })
      .map(([key, value]) => [key, value == null ? 'null' : undefined])
      .filter(([, value]) => value != null);

    logger.warn('Some of materials are missing.', Object.fromEntries(entries));

    return <></>;
  }

  const { _id: revisionId, body: markdown } = currentPage.revision;

  return (
    <>
      { revisionId != null && (
        <RevisionRenderer rendererOptions={rendererOptions} markdown={markdown} />
      )}
    </>
  );

};
