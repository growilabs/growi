import { useCallback, useEffect } from 'react';

import type EventEmitter from 'events';

import { Origin } from '@growi/core';
import type { DrawioEditByViewerProps } from '@growi/remark-drawio';

import { replaceDrawioInMarkdown } from '~/client/components/Page/markdown-drawio-util-for-view';
import { extractRemoteRevisionDataFromErrorObj, updatePage as _updatePage } from '~/client/services/update-page';
import { useShareLinkId } from '~/stores-universal/context';
import { useConflictDiffModal, useDrawioModal } from '~/stores/modal';
import { useSWRxCurrentPage } from '~/stores/page';
import { type RemoteRevisionData, useSetRemoteLatestPageData } from '~/stores/remote-latest-page';
import loggerFactory from '~/utils/logger';


const logger = loggerFactory('growi:cli:side-effects:useDrawioModalLauncherForView');


declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}


export const useDrawioModalLauncherForView = (opts?: {
  onSaveSuccess?: () => void,
  onSaveError?: (error: any) => void,
}): void => {

  const { data: shareLinkId } = useShareLinkId();

  const { data: currentPage } = useSWRxCurrentPage();

  const { open: openDrawioModal } = useDrawioModal();

  const { open: openConflictDiffModal, close: closeConflictDiffModal } = useConflictDiffModal();

  const { setRemoteLatestPageData } = useSetRemoteLatestPageData();

  // eslint-disable-next-line max-len
  const updatePage = useCallback(async(revisionId:string, newMarkdown: string, onConflict: (conflictData: RemoteRevisionData, newMarkdown: string) => void) => {
    if (currentPage == null || currentPage.revision == null || shareLinkId != null) {
      return;
    }

    try {
      await _updatePage({
        pageId: currentPage._id,
        revisionId,
        body: newMarkdown,
        origin: Origin.View,
      });

      closeConflictDiffModal();
      opts?.onSaveSuccess?.();
    }
    catch (error) {
      const remoteRevidsionData = extractRemoteRevisionDataFromErrorObj(error);
      if (remoteRevidsionData != null) {
        onConflict(remoteRevidsionData, newMarkdown);
      }

      logger.error('failed to save', error);
      opts?.onSaveError?.(error);
    }
  }, [closeConflictDiffModal, currentPage, opts, shareLinkId]);

  // eslint-disable-next-line max-len
  const generateResolveConflictHandler = useCallback((revisionId: string, onConflict: (conflictData: RemoteRevisionData, newMarkdown: string) => void) => {
    return async(newMarkdown: string) => {
      await updatePage(revisionId, newMarkdown, onConflict);
    };
  }, [updatePage]);

  const onConflictHandler = useCallback((remoteRevidsionData: RemoteRevisionData, newMarkdown: string) => {
    setRemoteLatestPageData(remoteRevidsionData);

    const resolveConflictHandler = generateResolveConflictHandler(remoteRevidsionData.remoteRevisionId, onConflictHandler);
    if (resolveConflictHandler == null) {
      return;
    }

    openConflictDiffModal(newMarkdown, resolveConflictHandler);
  }, [generateResolveConflictHandler, openConflictDiffModal, setRemoteLatestPageData]);

  const saveByDrawioModal = useCallback(async(drawioMxFile: string, bol: number, eol: number) => {
    if (currentPage == null || currentPage.revision == null) {
      return;
    }

    const currentRevisionId = currentPage.revision._id;
    const currentMarkdown = currentPage.revision.body;
    const newMarkdown = replaceDrawioInMarkdown(drawioMxFile, currentMarkdown, bol, eol);

    await updatePage(currentRevisionId, newMarkdown, onConflictHandler);
  }, [currentPage, onConflictHandler, updatePage]);

  // set handler to open DrawioModal
  useEffect(() => {
    // disable if share link
    if (shareLinkId != null) {
      return;
    }

    const handler = (data: DrawioEditByViewerProps) => {
      openDrawioModal(data.drawioMxFile, drawioMxFile => saveByDrawioModal(drawioMxFile, data.bol, data.eol));
    };
    globalEmitter.on('launchDrawioModal', handler);

    return function cleanup() {
      globalEmitter.removeListener('launchDrawioModal', handler);
    };
  }, [openDrawioModal, saveByDrawioModal, shareLinkId]);
};
