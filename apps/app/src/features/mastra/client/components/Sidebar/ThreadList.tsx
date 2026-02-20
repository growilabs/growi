import type React from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import InfiniteScroll from '~/client/components/InfiniteScroll';
import { toastError, toastSuccess } from '~/client/util/toastr';
import {
  useAiAssistantSidebarActions,
  useAiAssistantSidebarStatus,
} from '~/features/openai/client/states';
import { useSWRMUTxThreads } from '~/features/openai/client/stores/thread';
import loggerFactory from '~/utils/logger';

import { deleteThread } from '../../services/thread';
import { useSWRINFxRecentThreads } from '../../stores/thread';

const logger = loggerFactory('growi:openai:client:components:ThreadList');

export const ThreadList: React.FC = () => {
  const swrInfiniteThreads = useSWRINFxRecentThreads();
  const { t } = useTranslation();
  const { data, mutate: mutateRecentThreads } = swrInfiniteThreads;
  const aiAssistantSidebarData = useAiAssistantSidebarStatus();
  const { openChat, close: closeAiAssistantSidebar } =
    useAiAssistantSidebarActions();
  const { trigger: mutateAssistantThreadData } = useSWRMUTxThreads(
    aiAssistantSidebarData?.aiAssistantData?._id,
  );

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

        mutateRecentThreads();

        // TODO:　After moving useAiAssistantSidebarStatus to the features/mastra directory, we plan to address this.
        // Promise.all([mutateAssistantThreadData(), mutateRecentThreads()]);
        // // Close if the thread to be deleted is open in right sidebar
        // if (
        //   aiAssistantSidebarData?.isOpened &&
        //   aiAssistantSidebarData?.threadData?._id === threadRelationId
        // ) {
        //   closeAiAssistantSidebar();
        // }
      } catch (err) {
        logger.error(err);
        toastError(t('ai_assistant_substance.toaster.thread_deleted_failed'));
      }
    },
    [mutateRecentThreads, t],
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
                // onClick={(e) => {
                //   e.stopPropagation();
                //   openChat(thread.aiAssistant, thread);
                // }}
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
