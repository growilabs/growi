import { useCallback, useEffect } from 'react';
import { Origin } from '@growi/core';
import { globalEventTarget } from '@growi/core/dist/utils';
import type { DrawioEditByViewerProps } from '@growi/remark-drawio';

import { replaceDrawioInMarkdown } from '~/client/components/Page/markdown-drawio-util-for-view';
import {
  extractRemoteRevisionDataFromErrorObj,
  useUpdatePage,
} from '~/client/services/update-page';
import type { RemoteRevisionData } from '~/states/page';
import { useCurrentPageData, useSetRemoteLatestPageData } from '~/states/page';
import { useShareLinkId } from '~/states/page/hooks';
import { useConflictDiffModalActions } from '~/states/ui/modal/conflict-diff';
import { useDrawioModalActions } from '~/states/ui/modal/drawio';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:cli:side-effects:useDrawioModalLauncherForView',
);

export const useDrawioModalLauncherForView = (opts?: {
  onSaveSuccess?: () => void;
  onSaveError?: (error: any) => void;
}): void => {
  const shareLinkId = useShareLinkId();

  const currentPage = useCurrentPageData();

  const { open: openDrawioModal } = useDrawioModalActions();

  const { open: openConflictDiffModal, close: closeConflictDiffModal } =
    useConflictDiffModalActions();

  const _updatePage = useUpdatePage();

  const setRemoteLatestPageData = useSetRemoteLatestPageData();

  // eslint-disable-next-line max-len
  const updatePage = useCallback(
    async (
      revisionId: string,
      newMarkdown: string,
      onConflict: (
        conflictData: RemoteRevisionData,
        newMarkdown: string,
      ) => void,
    ) => {
      if (
        currentPage == null ||
        currentPage.revision == null ||
        shareLinkId != null
      ) {
        return;
      }

      // There are cases where "revisionId" is not required for revision updates
      // See: https://dev.growi.org/651a6f4a008fee2f99187431#origin-%E3%81%AE%E5%BC%B7%E5%BC%B1
      try {
        await _updatePage({
          pageId: currentPage._id,
          revisionId,
          body: newMarkdown,
          origin: Origin.View,
        });

        closeConflictDiffModal();
        opts?.onSaveSuccess?.();
      } catch (error) {
        const remoteRevidsionData =
          extractRemoteRevisionDataFromErrorObj(error);
        if (remoteRevidsionData != null) {
          onConflict(remoteRevidsionData, newMarkdown);
        }

        logger.error('failed to save', error);
        opts?.onSaveError?.(error);
      }
    },
    [_updatePage, closeConflictDiffModal, currentPage, opts, shareLinkId],
  );

  // eslint-disable-next-line max-len
  const generateResolveConflictHandler = useCallback(
    (
      revisionId: string,
      onConflict: (
        conflictData: RemoteRevisionData,
        newMarkdown: string,
      ) => void,
    ) => {
      return async (newMarkdown: string) => {
        await updatePage(revisionId, newMarkdown, onConflict);
      };
    },
    [updatePage],
  );

  const onConflictHandler = useCallback(
    (remoteRevidsionData: RemoteRevisionData, newMarkdown: string) => {
      setRemoteLatestPageData(remoteRevidsionData);

      const resolveConflictHandler = generateResolveConflictHandler(
        remoteRevidsionData.remoteRevisionId,
        onConflictHandler,
      );
      if (resolveConflictHandler == null) {
        return;
      }

      openConflictDiffModal(newMarkdown, resolveConflictHandler);
    },
    [
      generateResolveConflictHandler,
      openConflictDiffModal,
      setRemoteLatestPageData,
    ],
  );

  const saveByDrawioModal = useCallback(
    async (drawioMxFile: string, bol: number, eol: number) => {
      if (currentPage == null || currentPage.revision == null) {
        return;
      }

      const currentRevisionId = currentPage.revision._id;
      const currentMarkdown = currentPage.revision.body;
      const newMarkdown = replaceDrawioInMarkdown(
        drawioMxFile,
        currentMarkdown,
        bol,
        eol,
      );

      await updatePage(currentRevisionId, newMarkdown, onConflictHandler);
    },
    [currentPage, onConflictHandler, updatePage],
  );

  // set handler to open DrawioModal
  useEffect(() => {
    // disable if share link
    if (shareLinkId != null) {
      return;
    }

    const handler = (evt: CustomEvent<DrawioEditByViewerProps>) => {
      const data = evt.detail;
      openDrawioModal(data.drawioMxFile, (drawioMxFile) =>
        saveByDrawioModal(drawioMxFile, data.bol, data.eol),
      );
    };
    globalEventTarget.addEventListener('launchDrawioModal', handler);

    return function cleanup() {
      globalEventTarget.removeEventListener('launchDrawioModal', handler);
    };
  }, [openDrawioModal, saveByDrawioModal, shareLinkId]);
};
