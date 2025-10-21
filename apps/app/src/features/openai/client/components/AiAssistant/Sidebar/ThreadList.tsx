import type React from 'react';
import { useCallback } from 'react';
import { getIdStringForRef } from '@growi/core';
import { useTranslation } from 'react-i18next';

import InfiniteScroll from '~/client/components/InfiniteScroll';
import { toastError, toastSuccess } from '~/client/util/toastr';
import {
  useSWRINFxRecentThreads,
  useSWRMUTxThreads,
} from '~/features/openai/client/stores/thread';
import loggerFactory from '~/utils/logger';

import { deleteThread } from '../../../services/thread';
import { useAiAssistantSidebar } from '../../../stores/ai-assistant';

const logger = loggerFactory('growi:openai:client:components:ThreadList');

export const ThreadList: React.FC = () => {
  const swrInifiniteThreads = useSWRINFxRecentThreads();
  const { t } = useTranslation();
  const { data, mutate: mutateRecentThreads } = swrInifiniteThreads;
  const {
    openChat,
    data: aiAssistantSidebarData,
    close: closeAiAssistantSidebar,
  } = useAiAssistantSidebar();
  const { trigger: mutateAssistantThreadData } = useSWRMUTxThreads(
    aiAssistantSidebarData?.aiAssistantData?._id,
  );

  const isEmpty = data?.[0]?.paginateResult.totalDocs === 0;
  const isReachingEnd =
    isEmpty ||
    (data != null &&
      data[data.length - 1].paginateResult.hasNextPage === false);

  const deleteThreadHandler = useCallback(
    async (aiAssistantId: string, threadRelationId: string) => {
      try {
        await deleteThread({ aiAssistantId, threadRelationId });
        toastSuccess(
          t('ai_assistant_substance.toaster.thread_deleted_success'),
        );

        await Promise.all([mutateAssistantThreadData(), mutateRecentThreads()]);

        // Close if the thread to be deleted is open in right sidebar
        if (
          aiAssistantSidebarData?.isOpened &&
          aiAssistantSidebarData?.threadData?._id === threadRelationId
        ) {
          closeAiAssistantSidebar();
        }
      } catch (err) {
        logger.error(err);
        toastError(t('ai_assistant_substance.toaster.thread_deleted_failed'));
      }
    },
    [
      aiAssistantSidebarData?.isOpened,
      aiAssistantSidebarData?.threadData?._id,
      closeAiAssistantSidebar,
      mutateAssistantThreadData,
      mutateRecentThreads,
      t,
    ],
  );

  return (
    <>
      <ul className="list-group">
        <InfiniteScroll
          swrInifiniteResponse={swrInifiniteThreads}
          isReachingEnd={isReachingEnd}
        >
          {data
            ?.flatMap((thread) => thread.paginateResult.docs)
            .map((thread) => (
              <li key={thread._id} className="list-group-item border-0 p-0">
                <button
                  type="button"
                  className="btn btn-link list-group-item-action border-0 d-flex align-items-center rounded-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    openChat(thread.aiAssistant, thread);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                >
                  <div>
                    <span className="material-symbols-outlined fs-5">chat</span>
                  </div>

                  <div className="grw-item-title ps-1">
                    <p className="text-truncate m-auto">
                      {thread.title ?? 'Untitled thread'}
                    </p>
                  </div>

                  <div className="grw-btn-actions opacity-0 d-flex justify-content-center">
                    <button
                      type="button"
                      className="btn btn-link text-secondary p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteThreadHandler(
                          getIdStringForRef(thread.aiAssistant),
                          thread._id,
                        );
                      }}
                    >
                      <span className="material-symbols-outlined fs-5">
                        delete
                      </span>
                    </button>
                  </div>
                </button>
              </li>
            ))}
        </InfiniteScroll>
      </ul>
    </>
  );
};
