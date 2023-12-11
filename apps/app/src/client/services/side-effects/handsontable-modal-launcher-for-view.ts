import { useCallback, useEffect } from 'react';

import EventEmitter from 'events';

import MarkdownTable from '~/client/models/MarkdownTable';
import { useSaveOrUpdate } from '~/client/services/page-operation';
import { getMarkdownTableFromLine, replaceMarkdownTableInMarkdown } from '~/components/PageEditor/markdown-table-util-for-view';
import type { OptionsToSave } from '~/interfaces/page-operation';
import { useShareLinkId } from '~/stores/context';
import { useHandsontableModal } from '~/stores/modal';
import { useSWRxCurrentPage, useSWRxTagsInfo } from '~/stores/page';
import loggerFactory from '~/utils/logger';


const logger = loggerFactory('growi:cli:side-effects:useHandsontableModalLauncherForView');


declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}


export const useHandsontableModalLauncherForView = (opts?: {
  onSaveSuccess?: () => void,
  onSaveError?: (error: any) => void,
}): void => {

  const { data: shareLinkId } = useShareLinkId();

  const { data: currentPage } = useSWRxCurrentPage();

  const { open: openHandsontableModal } = useHandsontableModal();

  const saveOrUpdate = useSaveOrUpdate();

  const saveByHandsontableModal = useCallback(async(table: MarkdownTable, bol: number, eol: number) => {
    if (currentPage == null || shareLinkId != null) {
      return;
    }

    const currentMarkdown = currentPage.revision.body;
    const newMarkdown = replaceMarkdownTableInMarkdown(table, currentMarkdown, bol, eol);

    const grantUserGroupIds = currentPage.grantedGroups.map((g) => {
      return {
        type: g.type,
        item: g.item._id,
      };
    });

    const optionsToSave: OptionsToSave = {
      isSlackEnabled: false,
      slackChannels: '',
      grant: currentPage.grant,
      // grantUserGroupIds,
      // pageTags: tagsInfo.tags,
    };

    try {
      const currentRevisionId = currentPage.revision._id;
      await saveOrUpdate(
        newMarkdown,
        { pageId: currentPage._id, path: currentPage.path, revisionId: currentRevisionId },
        optionsToSave,
      );

      opts?.onSaveSuccess?.();
    }
    catch (error) {
      logger.error('failed to save', error);
      opts?.onSaveError?.(error);
    }
  }, [currentPage, opts, saveOrUpdate, shareLinkId]);


  // set handler to open HandsonTableModal
  useEffect(() => {
    if (currentPage == null || shareLinkId != null) {
      return;
    }

    const handler = (bol: number, eol: number) => {
      const markdown = currentPage.revision.body;
      const currentMarkdownTable = getMarkdownTableFromLine(markdown, bol, eol);
      openHandsontableModal(currentMarkdownTable, false, table => saveByHandsontableModal(table, bol, eol));
    };
    globalEmitter.on('launchHandsonTableModal', handler);

    return function cleanup() {
      globalEmitter.removeListener('launchHandsonTableModal', handler);
    };
  }, [currentPage, openHandsontableModal, saveByHandsontableModal, shareLinkId]);
};
