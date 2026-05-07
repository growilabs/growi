import type React from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import InfiniteScroll from '~/client/components/InfiniteScroll';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useSWRxAiAssistants } from '~/features/openai/client/stores/ai-assistant';
import loggerFactory from '~/utils/logger';

import { deleteThread } from '../../services/thread';
import {
  useChatSidebarActions,
  useChatSidebarStatus,
} from '../../status/chat-sidebar';
import { useSWRINFxRecentThreads } from '../../stores/thread';

const logger = loggerFactory('growi:openai:client:components:ThreadList');

export const ThreadList: React.FC = () => {
  const swrInfiniteThreads = useSWRINFxRecentThreads();
  const { t } = useTranslation();
  const { data, mutate: mutateRecentThreads } = swrInfiniteThreads;
  const { openChat, close: closeChatSidebar } = useChatSidebarActions();
  const chatSidebarStatus = useChatSidebarStatus();
  const { data: aiAssistants } = useSWRxAiAssistants();

  const isEmpty = data?.[0]?.total === 0;
  const isReachingEnd =
    isEmpty || (data != null && data[data.length - 1]?.hasMore === false);

  const deleteThreadHandler = useCallback(
    async (threadId: string) => {
      try {
        await deleteThread({ threadId });
        toastSuccess(
          t('ai_assistant_substance.toaster.thread_deleted_success'),
        );

        // TODO:　After moving useAiAssistantSidebarStatus to the features/mastra directory, we plan to address this.
        // Promise.all([mutateAssistantThreadData(), mutateRecentThreads()]);
        mutateRecentThreads();

        // Close if the thread to be deleted is open in right sidebars
        if (
          chatSidebarStatus?.isOpened &&
          chatSidebarStatus?.threadId === threadId
        ) {
          closeChatSidebar();
        }
      } catch (err) {
        logger.error(err);
        toastError(t('ai_assistant_substance.toaster.thread_deleted_failed'));
      }
    },
    [
      mutateRecentThreads,
      t,
      chatSidebarStatus?.isOpened,
      chatSidebarStatus?.threadId,
      closeChatSidebar,
      chatSidebarStatus,
    ],
  );

  const findAiAssistantById = useCallback(
    (aiAssistantId: string) => {
      if (aiAssistants == null) return;

      const allAssistants = [
        ...aiAssistants.myAiAssistants,
        ...aiAssistants.teamAiAssistants,
      ];
      return allAssistants.find((assistant) => assistant._id === aiAssistantId);
    },
    [aiAssistants],
  );

  const handleOpenChat = useCallback(
    (aiAssistantId: string, threadId: string) => {
      const aiAssistant = findAiAssistantById(aiAssistantId);
      if (aiAssistant != null) {
        openChat(aiAssistant, threadId);
      }
    },
    [findAiAssistantById, openChat],
  );

  return (
    <ul className="list-group">
      <InfiniteScroll
        swrInifiniteResponse={swrInfiniteThreads}
        isReachingEnd={isReachingEnd}
      >
        {data
          ?.flatMap((threadData) => threadData.threads)
          .map((thread) => (
            <li key={thread.id} className="list-group-item border-0 p-0">
              <button
                type="button"
                className="btn btn-link list-group-item-action border-0 d-flex align-items-center rounded-1"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenChat(thread.metadata.aiAssistantId, thread.id);
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
                      deleteThreadHandler(thread.id);
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
  );
};
